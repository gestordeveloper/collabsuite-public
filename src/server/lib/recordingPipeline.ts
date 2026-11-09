import fsp from "fs/promises";
import path from "path";
import { splitForTranscription, cleanupDir } from "./ffmpeg";
import { getAdapter, type AiProvider } from "./ai-providers/registry";
import { resolveApiKey } from "../services/ai-credential.service";

const CHUNK_SECONDS = 600;
const WHISPER_MAX_DIRECT_BYTES = 20 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Transcrição ───────────────────────────────────────────────────────────────

interface WhisperTarget {
  provider: "groq" | "openai";
  apiKey: string;
  url: string;
  models: string[];
}

async function resolveWhisperTarget(userId: number, companyId: number | null): Promise<WhisperTarget> {
  try {
    const apiKey = await resolveApiKey("groq", userId, companyId);
    return { provider: "groq", apiKey, url: "https://api.groq.com/openai/v1/audio/transcriptions", models: ["whisper-large-v3", "whisper-large-v3-turbo"] };
  } catch {
    try {
      const apiKey = await resolveApiKey("openai", userId, companyId);
      return { provider: "openai", apiKey, url: "https://api.openai.com/v1/audio/transcriptions", models: ["whisper-1"] };
    } catch {
      throw new Error("Nenhuma credencial de transcrição (Groq ou OpenAI) configurada. Cadastre em Configurações > Integrações.");
    }
  }
}

interface RawSegment {
  start: number;
  text: string;
}

async function whisperRequest(target: WhisperTarget, file: string): Promise<{ text: string; segments: RawSegment[] }> {
  const buffer = await fsp.readFile(file);
  let lastError: Error | null = null;

  for (const model of target.models) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: "audio/mpeg" }), path.basename(file));
      form.append("model", model);
      form.append("language", "pt");
      form.append("response_format", "verbose_json");

      const res = await fetch(target.url, { method: "POST", headers: { Authorization: `Bearer ${target.apiKey}` }, body: form });
      if (res.ok) {
        const data: any = await res.json();
        const segments: RawSegment[] = Array.isArray(data.segments)
          ? data.segments.map((s: any) => ({ start: Number(s.start) || 0, text: String(s.text || "").trim() })).filter((s: RawSegment) => s.text)
          : [];
        return { text: String(data.text || "").trim(), segments };
      }

      const body = await res.text().catch(() => "");
      lastError = new Error(`${target.provider} (${model}) respondeu ${res.status}: ${body.slice(0, 200)}`);
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** (attempt + 1)) * 1000);
        continue;
      }
      break; // erro de requisição (ex.: modelo indisponível): tenta o próximo modelo
    }
  }
  throw lastError ?? new Error("Falha desconhecida na transcrição.");
}

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Transcreve o arquivo inteiro (convertendo e fatiando com FFmpeg) e devolve linhas "[mm:ss] texto". */
export async function transcribeFile(
  file: string,
  userId: number,
  companyId: number | null,
  onProgress: (label: string) => void
): Promise<{ text: string; provider: string }> {
  const target = await resolveWhisperTarget(userId, companyId);

  let chunks;
  try {
    onProgress("Preparando áudio…");
    chunks = await splitForTranscription(file, CHUNK_SECONDS);
  } catch (err) {
    // Sem FFmpeg só dá para transcrever arquivos pequenos, enviados como estão.
    const { size } = await fsp.stat(file);
    if (size > WHISPER_MAX_DIRECT_BYTES) throw err;
    const single = await whisperRequest(target, file);
    return { text: formatSegments(single, 0), provider: target.provider };
  }

  try {
    const parts: string[] = [];
    for (let i = 0; i < chunks.files.length; i++) {
      onProgress(`Transcrevendo trecho ${i + 1} de ${chunks.files.length}…`);
      const result = await whisperRequest(target, chunks.files[i]);
      parts.push(formatSegments(result, i * CHUNK_SECONDS));
    }
    return { text: parts.filter(Boolean).join("\n"), provider: target.provider };
  } finally {
    await cleanupDir(chunks.dir);
  }
}

function formatSegments(result: { text: string; segments: RawSegment[] }, offsetSeconds: number): string {
  if (!result.segments.length) return result.text ? `[${clock(offsetSeconds)}] ${result.text}` : "";
  return result.segments.map((s) => `[${clock(offsetSeconds + s.start)}] ${s.text}`).join("\n");
}

// ─── Análise ───────────────────────────────────────────────────────────────────

export interface RecordingAnalysis {
  title: string;
  tipo: string;
  categoria: string;
  participantes: string[];
  resumo: string;
  temas: string[];
  decisoes: { texto: string; tomada: boolean; responsavel?: string }[];
  acoes: { acao: string; prioridade: "P1" | "P2" | "P3"; dono?: string; prazo?: string }[];
  riscos: { descricao: string; impacto: string }[];
  proximos_passos: string[];
  notas: string[];
}

const ANALYSIS_SYSTEM_PROMPT = `Você é um analista executivo sênior que estrutura análises completas de transcrições de áudio (entrevistas, reuniões, chamadas, apresentações, alinhamentos).
NUNCA invente informações que não estejam na transcrição. Seja conciso, cirúrgico e focado em valor executivo. Responda em português do Brasil.

Responda SOMENTE com um objeto JSON válido (sem markdown, sem comentários, sem texto fora do JSON) neste formato:
{
  "title": "título curto e descritivo da gravação (máx. 80 caracteres)",
  "tipo": "Entrevista | Reunião | Chamada | Apresentação | Alinhamento",
  "categoria": "área/empresa/assunto (ex.: Comercial, RH, Produto…)",
  "participantes": ["nomes identificados na conversa"],
  "resumo": "3 a 5 frases: qual foi o objetivo e quais os pontos principais",
  "temas": ["3 a 7 temas, cada um com sua natureza: Operacional, Estratégico, Comercial, RH, Técnico ou Geral"],
  "decisoes": [{ "texto": "decisão", "tomada": true, "responsavel": "nome ou omitir" }],
  "acoes": [{ "acao": "descrição clara e acionável, começando com verbo", "prioridade": "P1 | P2 | P3", "dono": "nome ou omitir", "prazo": "prazo citado (ex.: 25/10, sexta-feira) ou omitir" }],
  "riscos": [{ "descricao": "risco ou bloqueador", "impacto": "Alto | Médio | Baixo" }],
  "proximos_passos": ["ação imediata pós-sessão"],
  "notas": ["observações relevantes e citações importantes entre aspas"]
}

Regras:
- JSON estrito: dentro de qualquer texto use aspas simples (') para citações, nunca aspas duplas sem escape, e sem quebras de linha dentro das strings.
- "decisoes[].tomada": true se a decisão foi efetivamente tomada, false se ficou pendente.
- Prioridade: P1 = crítica (bloqueadora, urgente, alto impacto); P2 = alta (próximos passos lógicos); P3 = média (desejável, pode esperar).
- Em "acoes" inclua TUDO que alguém se comprometeu a fazer ou ficou combinado de fazer — é a lista que será enviada para o backlog do projeto.
- Se uma lista não tiver itens, use [].`;

const MAP_SYSTEM_PROMPT =
  "Você sintetiza trechos de transcrições com precisão executiva, sem inventar nada. Responda em português do Brasil, em tópicos.";

const SINGLE_PASS_LIMIT = 30000;
const MAP_BLOCK_SIZE = 14000;

interface LlmCandidate {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

const ANALYSIS_MODELS: { provider: AiProvider; model: string }[] = [
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "anthropic", model: "claude-sonnet-5" },
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "openrouter", model: "anthropic/claude-sonnet-5" },
];

async function resolveLlmCandidates(userId: number, companyId: number | null): Promise<LlmCandidate[]> {
  const out: LlmCandidate[] = [];
  for (const c of ANALYSIS_MODELS) {
    try {
      out.push({ ...c, apiKey: await resolveApiKey(c.provider, userId, companyId) });
    } catch {
      /* provedor sem credencial */
    }
  }
  if (!out.length) throw new Error("Nenhuma credencial de IA (Groq, Anthropic, OpenAI ou OpenRouter) configurada. Cadastre em Configurações > Integrações.");
  return out;
}

async function chatWithFallback(candidates: LlmCandidate[], system: string, user: string, maxTokens: number): Promise<{ text: string; provider: AiProvider; model: string }> {
  let lastError: Error | null = null;
  for (const c of candidates) {
    try {
      const res = await getAdapter(c.provider).chat({
        apiKey: c.apiKey,
        model: c.model,
        systemPrompt: system,
        messages: [{ role: "user", content: user }],
        temperature: 0.2,
        maxTokens,
      });
      if (res.stopReason === "error" || !res.text) throw new Error(`${c.provider} não retornou texto.`);
      return { text: res.text, provider: c.provider, model: c.model };
    } catch (err: any) {
      lastError = err;
      console.warn(`[recording] análise com ${c.provider}/${c.model} falhou: ${err?.message}`);
    }
  }
  throw new Error(`Falha ao analisar a gravação com todos os provedores. Último erro: ${lastError?.message}`);
}

function splitBlocks(text: string, size: number): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const line of text.split("\n")) {
    if (len + line.length > size && cur.length) {
      blocks.push(cur.join("\n"));
      cur = [];
      len = 0;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}

function extractJson(raw: string): any {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("A IA não devolveu um JSON válido.");
  s = s.slice(first, last + 1);
  return JSON.parse(s);
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);

function normalize(raw: any): RecordingAnalysis {
  const prio = (p: unknown): "P1" | "P2" | "P3" => {
    const m = String(p ?? "").toUpperCase().match(/P([123])/);
    return (m ? `P${m[1]}` : "P2") as "P1" | "P2" | "P3";
  };
  const opt = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s && !/^(a definir|n\/a|-|nenhum)$/i.test(s) ? s : undefined;
  };
  return {
    title: String(raw.title ?? "").trim().slice(0, 120),
    tipo: String(raw.tipo ?? "Reunião").trim() || "Reunião",
    categoria: String(raw.categoria ?? "").trim(),
    participantes: asStrings(raw.participantes),
    resumo: String(raw.resumo ?? "").trim(),
    temas: asStrings(raw.temas),
    decisoes: (Array.isArray(raw.decisoes) ? raw.decisoes : [])
      .map((d: any) => ({ texto: String(d?.texto ?? "").trim(), tomada: d?.tomada !== false, responsavel: opt(d?.responsavel) }))
      .filter((d: { texto: string }) => d.texto),
    acoes: (Array.isArray(raw.acoes) ? raw.acoes : [])
      .map((a: any) => ({ acao: String(a?.acao ?? "").trim(), prioridade: prio(a?.prioridade), dono: opt(a?.dono), prazo: opt(a?.prazo) }))
      .filter((a: { acao: string }) => a.acao),
    riscos: (Array.isArray(raw.riscos) ? raw.riscos : [])
      .map((r: any) => ({ descricao: String(r?.descricao ?? "").trim(), impacto: String(r?.impacto ?? "Médio").trim() }))
      .filter((r: { descricao: string }) => r.descricao),
    proximos_passos: asStrings(raw.proximos_passos),
    notas: asStrings(raw.notas),
  };
}

export async function analyzeTranscript(
  transcript: string,
  context: { title: string; durationSeconds: number | null; recordedAt: Date },
  userId: number,
  companyId: number | null,
  onProgress: (label: string) => void
): Promise<{ analysis: RecordingAnalysis; provider: string; model: string }> {
  const candidates = await resolveLlmCandidates(userId, companyId);

  let material = transcript;
  if (transcript.length > SINGLE_PASS_LIMIT) {
    // Gravações longas: sintetiza por blocos (map) antes da análise final (reduce) para não estourar
    // o limite de tokens por requisição dos provedores.
    const blocks = splitBlocks(transcript, MAP_BLOCK_SIZE);
    const notes: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      onProgress(`Resumindo parte ${i + 1} de ${blocks.length}…`);
      const { text } = await chatWithFallback(
        candidates,
        MAP_SYSTEM_PROMPT,
        `Extraia deste trecho (${i + 1}/${blocks.length}) da gravação: 1) assuntos tratados; 2) decisões tomadas e pendentes; 3) tudo que alguém se comprometeu a fazer, com responsável e prazo; 4) riscos e bloqueadores; 5) nomes dos participantes.\n\nTrecho:\n---\n${blocks[i]}\n---`,
        1500
      );
      notes.push(`### Parte ${i + 1} de ${blocks.length}\n${text}`);
    }
    material = notes.join("\n\n");
  }

  onProgress("Gerando análise…");
  const duration = context.durationSeconds ? `~${Math.max(1, Math.round(context.durationSeconds / 60))} minutos` : "não informada";
  const userPrompt = `Título informado: ${context.title}
Data da gravação: ${context.recordedAt.toLocaleDateString("pt-BR")}
Duração: ${duration}

${transcript.length > SINGLE_PASS_LIMIT ? "Síntese da transcrição (por partes)" : "Transcrição"}:
---
${material}
---

Gere a análise completa no formato JSON solicitado.`;

  let lastError: Error | null = null;
  // Uma segunda tentativa cobre JSON malformado de modelos menores.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text, provider, model } = await chatWithFallback(candidates, ANALYSIS_SYSTEM_PROMPT, userPrompt, 4096);
    try {
      return { analysis: normalize(extractJson(text)), provider, model };
    } catch (err: any) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("Falha ao interpretar a análise da IA.");
}

/** Relatório em Markdown (o mesmo formato "[ANÁLISE]" do GravadorX) montado a partir do JSON. */
export function renderAnalysisMarkdown(a: RecordingAnalysis, meta: { title: string; recordedAt: Date; durationSeconds: number | null }): string {
  const date = meta.recordedAt.toLocaleDateString("pt-BR");
  const duration = meta.durationSeconds ? `~${Math.max(1, Math.round(meta.durationSeconds / 60))} minutos` : "—";
  const cell = (s?: string) => (s || "A definir").replace(/\|/g, "/").replace(/\n/g, " ");
  const lines: string[] = [
    `# Análise - [${a.tipo}] ${meta.title}`,
    "",
    "## Informações Básicas",
    `- **Data:** ${date}`,
    `- **Tipo:** ${a.tipo}`,
    `- **Categoria:** ${a.categoria || "Geral"}`,
    `- **Duração:** ${duration}`,
    `- **Participantes:** ${a.participantes.length ? a.participantes.join(", ") : "A identificar"}`,
    "",
    "## Resumo Executivo",
    a.resumo || "—",
    "",
    "## Temas Principais",
    ...(a.temas.length ? a.temas.map((t) => `- ${t}`) : ["- Nenhum identificado"]),
    "",
    "## Decisões Tomadas",
    ...(a.decisoes.length
      ? a.decisoes.map((d) => `- [${d.tomada ? "x" : " "}] ${d.texto}${d.responsavel ? ` — ${d.responsavel}` : ""}`)
      : ["- Nenhuma identificada"]),
    "",
    "## Ações Identificadas",
    "| Ação | Prioridade | Dono | Prazo |",
    "|------|-----------|------|-------|",
    ...(a.acoes.length ? a.acoes.map((x) => `| ${cell(x.acao)} | ${x.prioridade} | ${cell(x.dono)} | ${cell(x.prazo)} |`) : ["| Nenhuma identificada | — | — | — |"]),
    "",
    "## Riscos/Bloqueadores",
    ...(a.riscos.length ? a.riscos.map((r) => `- ${r.descricao} - impacto: ${r.impacto}`) : ["- Nenhum identificado"]),
    "",
    "## Próximos Passos",
    ...(a.proximos_passos.length ? a.proximos_passos.map((p) => `- [ ] ${p}`) : ["- Nenhum identificado"]),
    "",
    "## Notas Adicionais",
    ...(a.notas.length ? a.notas.map((n) => `- ${n}`) : ["- —"]),
    "",
    `*Análise gerada em ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}*`,
  ];
  return lines.join("\n");
}
