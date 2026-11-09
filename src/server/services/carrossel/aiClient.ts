/**
 * Cliente de IA do estúdio: usa os provedores e as chaves já configuradas na CollabSuite
 * (Configurações > Integrações) e acrescenta o que a geração de carrosséis precisa: JSON mode,
 * retentativa em rate limit, resposta cortada e mensagens de erro prontas para o usuário.
 */
import { getAdapter, type AiProvider } from "../../lib/ai-providers/registry";
import { resolveApiKey } from "../ai-credential.service";
import * as localCli from "../local-cli/local-cli.service";
import { composePrompt, runCli, LocalCliError } from "../local-cli/runner";
import * as cliBridge from "../local-cli/cliBridge.service";

export class AIGenerationError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** Provedor "cli" = CLI instalado na máquina do servidor (ids vindos do front como "cli:<id>"). */
export type StudioProvider = AiProvider | "cli";

export interface AiCfg {
  provider: StudioProvider;
  model: string;
  apiKey: string;
  /** só quando provider === "cli" */
  /** CLI que roda no PC do usuário, via agente (agent/cli-agent) */
  agent?: { userId: number; cli: string };
  cli?: { id: number; name: string; command: string; args: string; prompt_mode: string; timeout_sec: number };
}

export type ProgressFn = (stage: string, pct: number) => void;
export const report = (progress: ProgressFn | undefined, stage: string, pct: number) => progress?.(stage, pct);

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** Modelo padrão por provedor para texto estruturado (JSON). */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  groq: "openai/gpt-oss-120b",
  openrouter: "anthropic/claude-sonnet-5",
  anthropic: "claude-sonnet-5",
  openai: "gpt-4.1-mini",
};

/** Limite de caracteres de contexto enviados de uma vez, por provedor (planos gratuitos têm limite de tokens/min baixo). */
export const CONTEXT_LIMIT_CHARS: Record<StudioProvider, number> = { groq: 9000, openrouter: 40000, openai: 40000, anthropic: 60000, cli: 60000 };

const ORDER: AiProvider[] = ["groq", "openrouter", "anthropic", "openai"];

export async function providerHasKey(provider: AiProvider, userId: number, companyId: number | null): Promise<boolean> {
  try {
    await resolveApiKey(provider, userId, companyId);
    return true;
  } catch {
    return false;
  }
}

/** Provedor pedido (ou o primeiro com chave configurada). null = nenhuma chave de IA disponível. */
export async function resolveCfg(
  userId: number, companyId: number | null, provider?: string | null, model?: string | null,
): Promise<AiCfg | null> {
  if (provider && provider.startsWith("agent:")) {
    const name = provider.slice(6);
    const found = cliBridge.listClis(userId).find((c) => c.name === name);
    if (!found) throw new AIGenerationError("O agente de CLIs não está conectado ou não tem esse CLI. Abra o agente no seu computador ou escolha outra IA.", 400);
    return { provider: "cli", apiKey: "", model: model || found.models[0] || "", agent: { userId, cli: name } };
  }
  if (provider && provider.startsWith("cli:")) {
    const id = Number(provider.slice(4));
    const row = Number.isInteger(id) ? await localCli.get(companyId, id).catch(() => null) : null;
    if (!row) throw new AIGenerationError("O CLI local escolhido não existe mais ou foi desativado. Escolha outra IA.", 400);
    return {
      provider: "cli", apiKey: "", model: model || localCli.parseModels(row.models)[0] || "",
      cli: { id: row.id, name: row.name, command: row.command, args: row.args, prompt_mode: row.prompt_mode, timeout_sec: row.timeout_sec },
    };
  }
  const candidates = provider && (ORDER as string[]).includes(provider) ? [provider as AiProvider] : ORDER;
  for (const p of candidates) {
    try {
      const apiKey = await resolveApiKey(p, userId, companyId);
      return { provider: p, model: model || DEFAULT_MODELS[p], apiKey };
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

export async function requireCfg(userId: number, companyId: number | null, provider?: string | null, model?: string | null): Promise<AiCfg> {
  const cfg = await resolveCfg(userId, companyId, provider, model);
  if (!cfg) {
    throw new AIGenerationError(
      "Nenhuma chave de IA configurada. Cadastre uma em Configurações > Integrações (Groq, OpenRouter, Claude ou OpenAI).", 400,
    );
  }
  return cfg;
}

function friendlyError(err: Error, cfg: AiCfg): AIGenerationError {
  if (err instanceof LocalCliError || err instanceof cliBridge.CliBridgeError) return new AIGenerationError(err.message, err.status);
  const msg = err.message || "";
  const low = msg.toLowerCase();
  const status = Number(/\((\d{3})\)/.exec(msg)?.[1] || 0);
  const prov = cfg.provider;
  if (status === 401 || low.includes("invalid api key") || low.includes("incorrect api key")) {
    return new AIGenerationError(`A chave de API do provedor '${prov}' foi recusada. Confira em Configurações > Integrações.`, 401);
  }
  if (status === 413 || low.includes("too large") || low.includes("tokens per minute") || low.includes("context length") || low.includes("maximum context")) {
    return new AIGenerationError(
      `O texto é grande demais para o limite do modelo '${cfg.model}' no provedor '${prov}'. ` +
      "Reduza o conteúdo-base, troque de modelo/provedor ou aguarde 1 minuto e tente de novo.", 413);
  }
  if (status === 429 || low.includes("rate limit")) {
    return new AIGenerationError(`O provedor '${prov}' atingiu o limite de requisições. Aguarde um pouco e tente novamente.`, 429);
  }
  if (status === 404 || (low.includes("model") && (low.includes("not found") || low.includes("does not exist")))) {
    return new AIGenerationError(`O modelo '${cfg.model}' não foi encontrado no provedor '${prov}'. Escolha outro modelo.`, 404);
  }
  if (low.includes("timed out") || low.includes("timeout")) {
    return new AIGenerationError(`O provedor '${prov}' demorou demais para responder. Tente novamente.`, 504);
  }
  return new AIGenerationError(`Falha ao chamar a IA (${prov}): ${msg.slice(0, 300)}`, 502);
}

/** Lê 'try again in 1m3.5s' / '350ms' das mensagens de rate limit. Sem dica: 4s. */
function retryWaitSeconds(msg: string): number {
  const m = /try again in\s+((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?(?:[\d.]+ms)?)/.exec(msg);
  if (!m || !m[1]) return 4;
  let total = 0;
  for (const [, val, unit] of m[1].matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    total += parseFloat(val) * ({ h: 3600, m: 60, s: 1, ms: 0.001 } as Record<string, number>)[unit];
  }
  return total || 4;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uma chamada de chat. Retenta em 429 (respeitando o tempo sugerido) e sem JSON mode se o modelo recusar. */
export async function chat(
  cfg: AiCfg, system: string, messages: ChatMsg[], maxTokens: number, opts: { json?: boolean; effort?: "low" | "medium" } = {},
): Promise<{ text: string; finish: string }> {
  if (cfg.provider === "cli" && cfg.agent) {
    try {
      const text = await cliBridge.requestCompletion(cfg.agent.userId, { cli: cfg.agent.cli, model: cfg.model, prompt: composePrompt(system, messages) });
      return { text, finish: "end_turn" };
    } catch (e) {
      throw friendlyError(e as Error, cfg);
    }
  }
  if (cfg.provider === "cli" && cfg.cli) {
    try {
      const text = await runCli(cfg.cli, cfg.model, composePrompt(system, messages));
      return { text, finish: "end_turn" };
    } catch (e) {
      throw friendlyError(e as Error, cfg);
    }
  }
  const adapter = getAdapter(cfg.provider as AiProvider);
  let useJson = opts.json !== false && (cfg.provider === "groq" || cfg.provider === "openai");
  let useEffort = !!opts.effort && cfg.provider === "groq" && cfg.model.toLowerCase().includes("gpt-oss");
  let curMax = maxTokens;
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      const res = await adapter.chat({
        apiKey: cfg.apiKey, model: cfg.model, systemPrompt: system, messages, temperature: 0.6, maxTokens: curMax,
        jsonMode: useJson, reasoningEffort: useEffort ? opts.effort : undefined,
      });
      return { text: res.text || "", finish: res.stopReason };
    } catch (e) {
      const err = e as Error;
      const low = (err.message || "").toLowerCase();
      const status = Number(/\((\d{3})\)/.exec(err.message || "")?.[1] || 0);
      if (useJson && status === 400 && low.includes("response_format")) { useJson = false; continue; }
      if (useEffort && status === 400 && low.includes("reasoning")) { useEffort = false; continue; }
      // modelos com "raciocínio" gastam parte do limite pensando: se acabou antes do JSON, dá mais espaço
      if (status === 400 && (low.includes("max completion tokens") || low.includes("json_validate_failed")) && attempts <= 3) {
        if (curMax < 14000) curMax = Math.min(16000, Math.floor(curMax * 2));
        else useJson = false;
        continue;
      }
      if (status === 429 && attempts <= 3) {
        const wait = retryWaitSeconds(low);
        if (wait <= 25) { await sleep((wait + 0.5) * 1000); continue; }
      }
      throw friendlyError(err, cfg);
    }
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Utilidades de texto
// ----------------------------------------------------------------------------------------------------------------

const DASH_RE = /\s*[—–]\s*|\s+-\s+/g;

/** Texto seguro para o slide: sem HTML, sem travessão, sem espaços duplicados. */
export function cleanText(val: unknown, keepHighlight = true): string {
  if (val === null || val === undefined) return "";
  let text = String(val);
  text = text.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, "**$1**");
  text = text.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, "**$1**");
  text = text.replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/(?<=\d)\s*[—–]\s*(?=\d)/g, " a "); // 10–20 vira "10 a 20"
  text = text.replace(DASH_RE, ", ");
  text = text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (!keepHighlight) text = text.replace(/\*\*/g, "");
  return text;
}

/** Regra comum de marca: no máximo uma palavra/trecho em destaque por título. */
export function limitHighlights(text: string, maxHl = 1): string {
  let count = 0;
  return text.replace(/\*\*([\s\S]+?)\*\*/g, (m, g1) => (++count <= maxHl ? m : g1));
}

/** Extrai e valida o JSON devolvido pelo modelo (tolera cercas ```json e texto em volta). */
export function parseJsonResponse(text: string): any {
  let clean = (text || "").trim();
  if (clean.includes("```")) {
    const m = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(clean);
    if (m) clean = m[1].trim();
  }
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("Não foi possível extrair JSON válido da resposta da IA.");
  }
}

export function parseOrNull(raw: string): Record<string, any> | null {
  try {
    const data = parseJsonResponse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Divide o contexto em blocos de até maxChars, cortando em parágrafo/frase (nunca no meio de uma palavra). */
export function splitParagraphs(text: string, maxChars: number): string[] {
  let paras = text.split(/\n\s*\n|\r\n\s*\r\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 1) paras = text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (let p of paras) {
    while (p.length > maxChars) {
      let cut = p.lastIndexOf(" ", maxChars);
      cut = cut > maxChars * 0.5 ? cut : maxChars;
      if (cur) { chunks.push(cur); cur = ""; }
      chunks.push(p.slice(0, cut).trim());
      p = p.slice(cut).trim();
    }
    if (cur.length + p.length + 2 > maxChars && cur) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function shorten(text: string, n = 70): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}
