import crypto from "crypto";

/** Cliente mínimo da API REST do Qdrant (sem dependência extra). Mesmo formato de payload do
 *  langchain-qdrant ({ page_content, metadata }) e vetor nomeado "text-dense", como no agent-davisantos. */
export const EMBEDDING_DIMENSIONS = 3072;
export const VECTOR_NAME = "text-dense";

export const qdrantCollection = () => process.env.QDRANT_COLLECTION || "collabsuite_knowledge";

function baseUrl(): string {
  const url = process.env.QDRANT_URL;
  if (!url) throw new Error("QDRANT_URL não configurada. Defina QDRANT_URL (e QDRANT_API_KEY, se houver) no .env para usar a base de conhecimento.");
  return url.replace(/\/+$/, "");
}

export async function qdrant(path: string, init: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.QDRANT_API_KEY) headers["api-key"] = process.env.QDRANT_API_KEY;
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 404 && init.method === undefined) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Qdrant ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

let ensured = false;
export async function ensureCollection(): Promise<void> {
  if (ensured) return;
  const name = qdrantCollection();
  const info = await qdrant(`/collections/${name}`);
  if (!info) {
    await qdrant(`/collections/${name}`, {
      method: "PUT",
      body: JSON.stringify({ vectors: { [VECTOR_NAME]: { size: EMBEDDING_DIMENSIONS, distance: "Cosine" } } }),
    });
  }
  for (const field of ["metadata.agent_id", "metadata.file_id"]) {
    await qdrant(`/collections/${name}/index`, {
      method: "PUT",
      body: JSON.stringify({ field_name: field, field_schema: "keyword" }),
    }).catch(() => {}); // já existe
  }
  ensured = true;
}

export async function isQdrantConnected(): Promise<boolean> {
  try {
    await qdrant("/collections");
    return true;
  } catch {
    return false;
  }
}

export interface QdrantChunk {
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export async function upsertChunks(chunks: QdrantChunk[]): Promise<void> {
  await ensureCollection();
  for (let i = 0; i < chunks.length; i += 64) {
    const batch = chunks.slice(i, i + 64).map((c) => ({
      id: crypto.randomUUID(),
      vector: { [VECTOR_NAME]: c.vector },
      payload: { page_content: c.text, metadata: c.metadata },
    }));
    await qdrant(`/collections/${qdrantCollection()}/points?wait=true`, { method: "PUT", body: JSON.stringify({ points: batch }) });
  }
}

const must = (agentId: number, extra: Record<string, string | undefined>) => ({
  must: [
    { key: "metadata.agent_id", match: { value: String(agentId) } },
    ...Object.entries(extra)
      .filter(([, v]) => !!v)
      .map(([k, v]) => ({ key: `metadata.${k}`, match: { value: v } })),
  ],
});

export interface QdrantHit {
  text: string;
  metadata: Record<string, any>;
  score: number;
}

export async function searchChunks(
  agentId: number,
  vector: number[],
  k: number,
  filters: Record<string, string | undefined> = {}
): Promise<QdrantHit[]> {
  await ensureCollection();
  const data = await qdrant(`/collections/${qdrantCollection()}/points/search`, {
    method: "POST",
    body: JSON.stringify({ vector: { name: VECTOR_NAME, vector }, limit: k, with_payload: true, filter: must(agentId, filters) }),
  });
  return (data?.result ?? []).map((r: any) => ({ text: r.payload?.page_content ?? "", metadata: r.payload?.metadata ?? {}, score: r.score }));
}

export async function deleteFileChunks(agentId: number, fileId: string): Promise<void> {
  await ensureCollection();
  await qdrant(`/collections/${qdrantCollection()}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter: must(agentId, { file_id: fileId }) }),
  });
}
