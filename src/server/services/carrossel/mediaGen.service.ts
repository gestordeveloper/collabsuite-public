/**
 * Geração de imagens por IA para os slots de imagem dos slides e para as páginas das mini-novelas HQ.
 *
 * Provedores: OpenRouter (Nano Banana / Gemini Flash Image, aceita imagens de referência), OpenAI (gpt-image-1,
 * endpoint de edição quando há referências) e Google AI Studio direto (GEMINI_API_KEY no ambiente).
 * As chaves de OpenRouter e OpenAI vêm de Configurações > Integrações.
 */
import { AIGenerationError } from "./aiClient";
import { resolveApiKey } from "../ai-credential.service";
import { createHash } from "crypto";
import * as flowBridge from "./flowBridge.service";

export type ImageProvider = "openrouter" | "openai" | "gemini" | "flow";

export interface ImageRef {
  label: string;
  data: Buffer;
  mime: string;
}

export const IMAGE_MODELS = {
  openrouter: "google/gemini-2.5-flash-image",
  openai: "gpt-image-1",
  gemini: "gemini-2.5-flash-image",
};

export class MediaGenError extends AIGenerationError {}

async function fetchJson(url: string, init: RequestInit, provider: string, timeoutMs = 180000): Promise<{ status: number; data: any; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const msg = (e as Error).message || "";
    if ((e as Error).name === "TimeoutError" || msg.includes("timed out")) throw new MediaGenError(`O provedor '${provider}' demorou demais para responder. Tente novamente.`, 504);
    throw new MediaGenError(`Falha de rede ao chamar '${provider}': ${msg}`, 502);
  }
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* resposta não-JSON */ }
  return { status: res.status, data, text };
}

function friendly(status: number, msg: string, provider: string): MediaGenError {
  const low = msg.toLowerCase();
  if (status === 401 || low.includes("invalid api key") || low.includes("incorrect api key")) {
    return new MediaGenError(`A chave de API do provedor '${provider}' foi recusada. Confira em Configurações > Integrações.`, 401);
  }
  if (status === 402) return new MediaGenError(`Sem créditos em '${provider}' para gerar a imagem.`, 402);
  if (status === 429 || low.includes("rate limit")) return new MediaGenError(`O provedor '${provider}' atingiu o limite de requisições. Aguarde um pouco e tente de novo.`, 429);
  if (status === 400 && (low.includes("content_policy") || low.includes("safety") || low.includes("moderation"))) {
    return new MediaGenError("O pedido foi recusado pelos filtros de segurança do provedor. Ajuste a descrição e tente de novo.", 400);
  }
  return new MediaGenError(`Falha ao gerar imagem (${provider}): ${msg.slice(0, 300)}`, 502);
}

const b64 = (buf: Buffer) => buf.toString("base64");

async function viaOpenRouter(apiKey: string, prompt: string, refs: ImageRef[], aspect: string, model?: string): Promise<Buffer> {
  const content: any[] = [];
  for (const r of refs.slice(0, 8)) { // cada imagem vem logo depois do seu rótulo; o pedido vai por último
    content.push({ type: "text", text: `Character reference sheet — ${r.label}:` });
    content.push({ type: "image_url", image_url: { url: `data:${r.mime};base64,${b64(r.data)}` } });
  }
  content.push({ type: "text", text: prompt });
  const { status, data, text } = await fetchJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_URL || "https://collabsuite.local", "X-Title": "CollabSuite" },
    body: JSON.stringify({ model: model || IMAGE_MODELS.openrouter, messages: [{ role: "user", content }], modalities: ["image", "text"], image_config: { aspect_ratio: aspect } }),
  }, "openrouter");
  if (status !== 200 || data?.error) {
    const err = data?.error;
    throw friendly(status, (typeof err === "object" ? err?.message : err) || text, "openrouter");
  }
  for (const img of data?.choices?.[0]?.message?.images || []) {
    const url: string = img?.image_url?.url || "";
    if (url.startsWith("data:") && url.includes(",")) return Buffer.from(url.split(",", 2)[1], "base64");
    if (url.startsWith("http")) return Buffer.from(await (await fetch(url)).arrayBuffer());
  }
  throw new MediaGenError("A OpenRouter não devolveu imagem. Tente de novo ou ajuste a descrição.", 502);
}

async function viaGemini(apiKey: string, prompt: string, refs: ImageRef[], aspect: string): Promise<Buffer> {
  const parts: any[] = [];
  for (const r of refs.slice(0, 8)) {
    parts.push({ text: `Character reference sheet — ${r.label}:` });
    parts.push({ inline_data: { mime_type: r.mime, data: b64(r.data) } });
  }
  parts.push({ text: prompt });
  const { status, data, text } = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODELS.gemini}:generateContent`,
    {
      method: "POST", headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }),
    }, "gemini",
  );
  if (status !== 200) throw friendly(status, data?.error?.message || text, "gemini");
  for (const cand of data?.candidates || []) {
    for (const part of cand?.content?.parts || []) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) return Buffer.from(inline.data, "base64");
    }
  }
  const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "sem imagem";
  throw new MediaGenError(`O Gemini não devolveu imagem (${reason}). Ajuste a cena e tente de novo.`, 502);
}

async function viaOpenAi(apiKey: string, prompt: string, refs: ImageRef[]): Promise<Buffer> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  let res: { status: number; data: any; text: string };
  if (refs.length) {
    const form = new FormData();
    form.append("model", IMAGE_MODELS.openai);
    form.append("prompt", prompt);
    form.append("size", "1024x1536");
    form.append("n", "1");
    for (const r of refs.slice(0, 10)) form.append("image[]", new Blob([new Uint8Array(r.data)], { type: r.mime }), r.label);
    res = await fetchJson("https://api.openai.com/v1/images/edits", { method: "POST", headers, body: form }, "openai");
  } else {
    res = await fetchJson("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: IMAGE_MODELS.openai, prompt, n: 1, size: "1024x1536", quality: "high" }),
    }, "openai");
  }
  if (res.status !== 200) throw friendly(res.status, res.data?.error?.message || res.text, "openai");
  const item = res.data?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
  throw new MediaGenError("O provedor não devolveu nem imagem nem URL.", 502);
}

/** Provedores com chave disponível (para a UI oferecer só o que funciona). */
export async function availableImageProviders(userId: number, companyId: number | null): Promise<ImageProvider[]> {
  const out: ImageProvider[] = [];
  if (flowBridge.isConnected(userId)) out.push("flow"); // usa os créditos do plano do Google, pela extensão do navegador
  for (const p of ["openrouter", "openai"] as const) {
    try { await resolveApiKey(p, userId, companyId); out.push(p); } catch { /* sem chave */ }
  }
  if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith("MY_")) out.push("gemini");
  return out;
}

export async function generateImage(
  actor: { userId: number; companyId: number | null },
  prompt: string,
  opts: { provider?: ImageProvider | null; references?: ImageRef[]; aspect?: string; flow?: { project_key: string; title: string } } = {},
): Promise<Buffer> {
  const refs = opts.references || [];
  const aspect = opts.aspect || "4:5";
  const available = await availableImageProviders(actor.userId, actor.companyId);
  // com referências o OpenRouter (Nano Banana) é o melhor para manter o rosto; sem preferência usa o que houver
  const provider = opts.provider && available.includes(opts.provider) ? opts.provider : (["openrouter", "gemini", "openai"] as const).find((p) => available.includes(p));
  if (!provider) {
    throw new MediaGenError("Nenhuma chave para gerar imagens. Cadastre OpenRouter ou OpenAI em Configurações > Integrações.", 400);
  }
  if (provider === "flow") {
    const png = await flowBridge.requestImage(actor.userId, {
      prompt, project_key: opts.flow?.project_key || "default", title: opts.flow?.title || "CollabSuite",
      refs: refs.map((r) => ({ name: `ref_${createHash("sha1").update(r.data).digest("hex").slice(0, 10)}.jpg`, mime: r.mime, data_base64: r.data.toString("base64") })),
    });
    return png;
  }
  if (provider === "gemini") return viaGemini(process.env.GEMINI_API_KEY!, prompt, refs, aspect);
  const key = await resolveApiKey(provider, actor.userId, actor.companyId);
  return provider === "openai" ? viaOpenAi(key, prompt, refs) : viaOpenRouter(key, prompt, refs, aspect);
}
