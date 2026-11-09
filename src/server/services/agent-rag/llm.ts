import { resolveApiKey } from "../ai-credential.service";
import { getAdapter } from "../../lib/ai-providers/registry";
import type { AiProvider } from "../../lib/ai-providers/types";

export const EMBEDDING_MODEL = "text-embedding-3-large";

/** LLM "de serviço" (chunking e self-query). O modelo de referência usa gpt-4.1-mini; aqui cai para
 *  o que o usuário tiver configurado, na ordem OpenAI → Groq → Anthropic → OpenRouter. */
const CANDIDATES: { provider: AiProvider; model: string }[] = [
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "anthropic", model: "claude-haiku-4-5" },
  { provider: "openrouter", model: "openai/gpt-4.1" },
];

export async function utilityJson(userId: number, companyId: number | null, prompt: string): Promise<any> {
  let lastError: unknown = null;
  for (const c of CANDIDATES) {
    let apiKey: string;
    try {
      apiKey = await resolveApiKey(c.provider, userId, companyId);
    } catch {
      continue; // provedor sem credencial
    }
    try {
      const result = await getAdapter(c.provider).chat({
        apiKey,
        model: c.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxTokens: 4096,
        jsonMode: c.provider === "openai" || c.provider === "groq",
      });
      const raw = (result.text ?? "").replace(/```[\w-]*/g, "").replace(/```/g, "").trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      return JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw);
    } catch (err) {
      lastError = err; // chave inválida/modelo indisponível: tenta o próximo provedor configurado
    }
  }
  if (lastError) throw lastError;
  throw new Error("Nenhuma credencial de IA configurada para processar documentos. Cadastre em Configurações > Integrações.");
}

export async function embedTexts(userId: number, companyId: number | null, texts: string[]): Promise<number[][]> {
  let apiKey: string;
  try {
    apiKey = await resolveApiKey("openai", userId, companyId);
  } catch {
    throw new Error("A base de conhecimento precisa de uma credencial OpenAI (embeddings text-embedding-3-large). Cadastre em Configurações > Integrações.");
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.slice(i, i + 64).map((t) => t.slice(0, 24000)) }),
    });
    if (!res.ok) throw new Error(`Embeddings OpenAI falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const data = await res.json();
    out.push(...data.data.map((d: any) => d.embedding as number[]));
  }
  return out;
}
