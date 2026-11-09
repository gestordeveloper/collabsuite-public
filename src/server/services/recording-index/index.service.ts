import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { embedTexts } from "../agent-rag/llm";
import { EMBEDDING_DIMENSIONS, VECTOR_NAME, isQdrantConnected, qdrant } from "../agent-rag/qdrant";

/**
 * Índice vetorial (Qdrant) das transcrições de gravações. Coleção própria, compartilhada por todos os
 * agentes: quem pode ver o quê é decidido no MySQL (dono ou membro do projeto) e só os ids permitidos
 * viram filtro da busca, então o índice nunca vaza uma gravação para quem não tem acesso a ela.
 */

export const recordingsCollection = () => process.env.QDRANT_RECORDINGS_COLLECTION || "collabsuite_recordings";
export const isIndexConfigured = () => !!process.env.QDRANT_URL;

const CHUNK_CHARS = 1800;
const OVERLAP_LINES = 2;

// ─── Coleção ────────────────────────────────────────────────────────────────────

let ensured = false;
async function ensureCollection() {
  if (ensured) return;
  const name = recordingsCollection();
  if (!(await qdrant(`/collections/${name}`))) {
    await qdrant(`/collections/${name}`, {
      method: "PUT",
      body: JSON.stringify({ vectors: { [VECTOR_NAME]: { size: EMBEDDING_DIMENSIONS, distance: "Cosine" } } }),
    });
  }
  await qdrant(`/collections/${name}/index`, { method: "PUT", body: JSON.stringify({ field_name: "metadata.recording_id", field_schema: "integer" }) }).catch(() => {});
  ensured = true;
}

// ─── Chunking ───────────────────────────────────────────────────────────────────

export interface RecordingChunk {
  text: string;
  chunkType: "resumo" | "transcricao";
  start: string | null; // "mm:ss" ou "h:mm:ss" da primeira fala do trecho
}

const TS_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;

/** A transcrição vem em linhas "[mm:ss] fala": agrupa por tamanho, repetindo as últimas linhas para não cortar o contexto. */
export function chunkTranscript(transcript: string): RecordingChunk[] {
  const lines = transcript.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const chunks: RecordingChunk[] = [];
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    chunks.push({ text: buf.join("\n"), chunkType: "transcricao", start: TS_RE.exec(buf[0])?.[1] ?? null });
  };
  for (const line of lines) {
    if (size + line.length > CHUNK_CHARS && buf.length) {
      flush();
      buf = buf.slice(-OVERLAP_LINES);
      size = buf.reduce((n, l) => n + l.length, 0);
    }
    buf.push(line);
    size += line.length;
  }
  // O último trecho só vale se trouxer algo além da sobreposição.
  if (buf.length && (!chunks.length || buf.some((l) => !chunks[chunks.length - 1].text.includes(l)))) flush();
  return chunks;
}

const parseJson = <T>(v: string | null, fb: T): T => {
  try {
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};

function summaryChunk(r: { title: string; tipo: string; summary: string | null; participants: string | null; topics: string | null; decisions: string | null; risks: string | null; next_steps: string | null }): RecordingChunk | null {
  const list = (label: string, items: string[]) => (items.length ? `${label}:\n${items.map((i) => `- ${i}`).join("\n")}` : "");
  const text = [
    r.summary ? `Resumo: ${r.summary}` : "",
    list("Participantes", parseJson<string[]>(r.participants, [])),
    list("Temas", parseJson<string[]>(r.topics, [])),
    list("Decisões", parseJson<{ text: string }[]>(r.decisions, []).map((d) => d.text)),
    list("Riscos", parseJson<string[]>(r.risks, [])),
    list("Próximos passos", parseJson<string[]>(r.next_steps, [])),
  ]
    .filter(Boolean)
    .join("\n\n");
  return text ? { text, chunkType: "resumo", start: null } : null;
}

const dateBr = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

// ─── Indexação ──────────────────────────────────────────────────────────────────

export async function removeRecordingIndex(recordingId: number) {
  if (!isIndexConfigured()) return;
  await ensureCollection();
  await qdrant(`/collections/${recordingsCollection()}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter: { must: [{ key: "metadata.recording_id", match: { value: recordingId } }] } }),
  });
}

/** Indexa (ou reindexa) uma gravação já transcrita. Nunca lança: registra o motivo em `index_error`. */
export async function indexRecording(recordingId: number): Promise<boolean> {
  if (!isIndexConfigured()) return false;
  const r = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!r || r.status !== "done" || !r.transcript?.trim()) return false;
  try {
    const header = `Gravação "${r.title}" (${r.tipo}, ${dateBr(r.recorded_at)})`;
    const chunks = [summaryChunk(r), ...chunkTranscript(r.transcript)].filter((c): c is RecordingChunk => !!c);
    const vectors = await embedTexts(r.user_id, r.company_id, chunks.map((c) => `${header}\n${c.text}`));

    await ensureCollection();
    await removeRecordingIndex(r.id);
    const points = chunks.map((c, i) => ({
      id: crypto.randomUUID(),
      vector: { [VECTOR_NAME]: vectors[i] },
      payload: {
        page_content: c.text,
        metadata: { recording_id: r.id, chunk_type: c.chunkType, chunk_index: i, start: c.start, title: r.title, recorded_at: r.recorded_at.toISOString() },
      },
    }));
    for (let i = 0; i < points.length; i += 64) {
      await qdrant(`/collections/${recordingsCollection()}/points?wait=true`, { method: "PUT", body: JSON.stringify({ points: points.slice(i, i + 64) }) });
    }
    await prisma.recording.update({ where: { id: r.id }, data: { indexed_at: new Date(), index_error: null } });
    return true;
  } catch (err: any) {
    console.error(`[recording-index] Falha ao indexar a gravação ${recordingId}:`, err?.message || err);
    await prisma.recording.update({ where: { id: recordingId }, data: { index_error: String(err?.message || err).slice(0, 300) } }).catch(() => {});
    return false;
  }
}

let queueTail: Promise<unknown> = Promise.resolve();
/** Fila em processo (uma por vez), como a de processamento das gravações. */
export function enqueueIndexing(recordingId: number) {
  if (!isIndexConfigured()) return;
  queueTail = queueTail.then(() => indexRecording(recordingId)).catch(() => {});
}

/** Enfileira as gravações do usuário; sem `force`, só as que ainda não foram indexadas. */
export async function enqueueReindex(userId: number, force: boolean) {
  const rows = await prisma.recording.findMany({
    where: { user_id: userId, status: "done", transcript: { not: null }, ...(force ? {} : { indexed_at: null }) },
    select: { id: true },
    orderBy: { recorded_at: "desc" },
  });
  rows.forEach((r) => enqueueIndexing(r.id));
  return rows.length;
}

export async function getIndexStatus(userId: number) {
  const base = { user_id: userId, status: "done" as const, transcript: { not: null } };
  const [total, indexed, failed] = await Promise.all([
    prisma.recording.count({ where: base }),
    prisma.recording.count({ where: { ...base, indexed_at: { not: null } } }),
    prisma.recording.count({ where: { ...base, index_error: { not: null } } }),
  ]);
  const configured = isIndexConfigured();
  return { qdrant_configured: configured, qdrant_connected: configured ? await isQdrantConnected() : false, collection: recordingsCollection(), total, indexed, pending: total - indexed, failed };
}

// ─── Busca ──────────────────────────────────────────────────────────────────────

export interface RecordingHit {
  recording_id: number;
  text: string;
  start: string | null;
  chunk_type: string;
  score: number;
}

/** Busca semântica restrita aos ids informados (já filtrados por acesso, período, projeto...). */
export async function searchRecordingChunks(userId: number, companyId: number | null, query: string, recordingIds: number[], k: number): Promise<RecordingHit[]> {
  if (!recordingIds.length) return [];
  await ensureCollection();
  const [vector] = await embedTexts(userId, companyId, [query]);
  const data = await qdrant(`/collections/${recordingsCollection()}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector: { name: VECTOR_NAME, vector },
      limit: k,
      with_payload: true,
      filter: { must: [{ key: "metadata.recording_id", match: { any: recordingIds } }] },
    }),
  });
  return (data?.result ?? []).map((x: any) => ({
    recording_id: Number(x.payload?.metadata?.recording_id),
    text: x.payload?.page_content ?? "",
    start: x.payload?.metadata?.start ?? null,
    chunk_type: x.payload?.metadata?.chunk_type ?? "transcricao",
    score: x.score,
  }));
}
