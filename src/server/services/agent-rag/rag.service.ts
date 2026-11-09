import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { classifyAttachment, extractTextFromDocument } from "../../lib/documentAnalysis";
import { embedTexts, utilityJson } from "./llm";
import { deleteFileChunks, searchChunks, upsertChunks, type QdrantHit } from "./qdrant";

const CHUNK_TYPES = ["resumo", "conteudo_principal", "detalhes", "referencias", "conclusao"];
const WINDOW_CHARS = 12000; // mesmo tamanho de janela do modelo de referência
const MAX_WINDOWS = 12;
const SUPPORTED = [".pdf", ".txt", ".docx", ".csv", ".md", ".html", ".xlsx"];

interface Chunk {
  text: string;
  metadata: Record<string, unknown>;
}

interface AgentOwner {
  id: number;
  user_id: number;
  company_id: number | null;
}

const stripHtml = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]{2,}/g, " ");

async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return stripHtml(buffer.toString("utf-8"));
  if (classifyAttachment(mimeType, filename) !== "text-document") throw new Error("Tipo de arquivo não suportado.");
  return extractTextFromDocument(buffer, mimeType, filename, { full: true });
}

/** Chunking por LLM (resumo / conteúdo / detalhes / referências / conclusão), como no modelo de referência,
 *  mas aplicado a cada janela do documento em vez de só aos primeiros 12 mil caracteres. */
async function chunkWithLlm(
  owner: AgentOwner,
  text: string,
  filename: string,
  fileId: string,
  uploadDate: string
): Promise<Chunk[]> {
  const windows: string[] = [];
  for (let i = 0; i < text.length && windows.length < MAX_WINDOWS; i += WINDOW_CHARS) windows.push(text.slice(i, i + WINDOW_CHARS));

  const chunks: Chunk[] = [];
  let title = "";
  for (const win of windows) {
    const prompt = `Você é um especialista em processamento de documentos.
Analise o texto abaixo e extraia:

1) Metadados:
- title: título ou assunto principal do documento (string curta)

2) Chunks (máximo de 5):
Divida o trecho em seções lógicas. Cada chunk deve ter:
- conteudo: texto literal e completo da seção
- tipo: um destes: ${CHUNK_TYPES.map((t) => `"${t}"`).join(", ")}

Retorne SOMENTE um JSON: {"metadados":{"title":"..."},"chunks":[{"tipo":"resumo","conteudo":"..."}]}

Texto do documento (${filename}):
${win}`;
    const data = await utilityJson(owner.user_id, owner.company_id, prompt);
    title = title || String(data?.metadados?.title ?? "");
    for (const c of data?.chunks ?? []) {
      const conteudo = String(c?.conteudo ?? "").trim();
      if (!conteudo) continue;
      chunks.push({
        text: conteudo,
        metadata: {
          title,
          source_file: filename,
          chunk_type: CHUNK_TYPES.includes(c.tipo) ? c.tipo : "conteudo_principal",
          chunk_index: chunks.length,
          upload_date: uploadDate,
          file_id: fileId,
        },
      });
    }
  }
  return chunks;
}

function simpleChunk(text: string, filename: string, fileId: string, uploadDate: string, words = 400): Chunk[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const chunks: Chunk[] = [];
  for (let i = 0; i < tokens.length; i += words) {
    chunks.push({
      text: tokens.slice(i, i + words).join(" "),
      metadata: {
        title: filename.replace(/\.[^.]+$/, ""),
        source_file: filename,
        chunk_type: "conteudo",
        chunk_index: i / words,
        upload_date: uploadDate,
        file_id: fileId,
      },
    });
  }
  return chunks;
}

export function listKnowledgeFiles(agentId: number) {
  return prisma.agentKnowledgeFile.findMany({ where: { agent_id: agentId }, orderBy: { created_at: "desc" } });
}

/** Cria o registro e processa em segundo plano (chunking por LLM + embeddings podem levar um tempo). */
export async function addKnowledgeFile(owner: AgentOwner, file: { buffer: Buffer; originalname: string; mimetype: string }) {
  const name = file.originalname;
  if (!SUPPORTED.some((ext) => name.toLowerCase().endsWith(ext))) {
    throw new HttpError(`Formato não suportado. Use: ${SUPPORTED.join(", ")}`);
  }
  const fileId = crypto.randomUUID().slice(0, 8);
  const row = await prisma.agentKnowledgeFile.create({ data: { agent_id: owner.id, file_id: fileId, filename: name, status: "processing" } });

  void (async () => {
    try {
      const text = await extractText(file.buffer, file.mimetype, name);
      if (!text.trim()) throw new Error("Nenhum texto pôde ser extraído do arquivo.");
      const uploadDate = new Date().toISOString();
      let chunks: Chunk[] = [];
      if (text.length > 200) {
        try {
          chunks = await chunkWithLlm(owner, text, name, fileId, uploadDate);
        } catch (err: any) {
          console.warn(`[agent-rag] Chunking por LLM falhou para ${name}, usando divisão simples:`, err?.message || err);
        }
      }
      if (!chunks.length) chunks = simpleChunk(text, name, fileId, uploadDate);

      const vectors = await embedTexts(owner.user_id, owner.company_id, chunks.map((c) => c.text));
      await upsertChunks(chunks.map((c, i) => ({ text: c.text, vector: vectors[i], metadata: { ...c.metadata, agent_id: String(owner.id) } })));
      await prisma.agentKnowledgeFile.update({ where: { id: row.id }, data: { status: "ready", chunks_count: chunks.length } });
    } catch (err: any) {
      console.error(`[agent-rag] Falha ao indexar ${name}:`, err?.message || err);
      await prisma.agentKnowledgeFile
        .update({ where: { id: row.id }, data: { status: "error", error: String(err?.message || err).slice(0, 500) } })
        .catch(() => {});
    }
  })();

  return row;
}

export async function removeKnowledgeFile(agentId: number, id: number) {
  const row = await prisma.agentKnowledgeFile.findFirst({ where: { id, agent_id: agentId } });
  if (!row) throw new HttpError("Arquivo não encontrado.", 404);
  await deleteFileChunks(agentId, row.file_id).catch((err) => console.warn("[agent-rag] Falha ao remover chunks:", err?.message || err));
  await prisma.agentKnowledgeFile.delete({ where: { id } });
}

/** Self-query: o LLM separa a busca semântica de filtros de metadados (tipo de trecho / arquivo). */
async function planQuery(owner: AgentOwner, query: string, files: string[]) {
  try {
    const data = await utilityJson(
      owner.user_id,
      owner.company_id,
      `Converta a pergunta do usuário em uma consulta para uma base vetorial de documentos.
Campos de metadado filtráveis: chunk_type (${CHUNK_TYPES.join(", ")}), source_file (um de: ${files.slice(0, 40).join(", ") || "nenhum"}).
Só preencha um filtro se a pergunta o pedir explicitamente (ex.: "no arquivo X", "o resumo de ..."); caso contrário use null.
Retorne SOMENTE JSON: {"query":"texto para busca semântica","chunk_type":null,"source_file":null}

Pergunta: ${query}`
    );
    return {
      query: String(data?.query || query),
      chunk_type: CHUNK_TYPES.includes(data?.chunk_type) ? (data.chunk_type as string) : undefined,
      source_file: files.includes(data?.source_file) ? (data.source_file as string) : undefined,
    };
  } catch {
    return { query, chunk_type: undefined, source_file: undefined };
  }
}

export async function retrieveContext(owner: AgentOwner, query: string, k = 5, selfQuery = true): Promise<QdrantHit[]> {
  const ready = await prisma.agentKnowledgeFile.findMany({ where: { agent_id: owner.id, status: "ready" }, select: { filename: true } });
  if (!ready.length) return [];

  const plan = selfQuery
    ? await planQuery(owner, query, ready.map((r) => r.filename))
    : { query, chunk_type: undefined, source_file: undefined };
  const [vector] = await embedTexts(owner.user_id, owner.company_id, [plan.query]);

  let hits = await searchChunks(owner.id, vector, k, { chunk_type: plan.chunk_type, source_file: plan.source_file });
  if (!hits.length && (plan.chunk_type || plan.source_file)) hits = await searchChunks(owner.id, vector, k);
  return hits;
}

export function formatContext(hits: QdrantHit[]): string {
  return hits
    .map((h) => `[${h.metadata.source_file ?? "?"} | ${h.metadata.chunk_type ?? "chunk"} | ${h.metadata.title ?? "N/A"}]\n${h.text}`)
    .join("\n\n");
}

const RAG_HEADER = "---\nContexto da base de conhecimento (use estas informações para responder, se relevante):\n";
const RAG_FOOTER =
  "\n---\nResponda com base no contexto acima quando pertinente. Se o contexto não contiver informação relevante, responda com seu conhecimento geral.";

/** Acrescenta ao system prompt os trechos relevantes; qualquer falha segue sem contexto (como no modelo de referência). */
export async function injectRagContext(owner: AgentOwner & { system_prompt: string }, query: string): Promise<string> {
  try {
    const hits = await retrieveContext(owner, query);
    if (!hits.length) return owner.system_prompt;
    return `${owner.system_prompt}\n\n${RAG_HEADER}\n${formatContext(hits)}\n${RAG_FOOTER}`;
  } catch (err: any) {
    console.warn("[agent-rag] Falha ao buscar contexto, seguindo sem ele:", err?.message || err);
    return owner.system_prompt;
  }
}
