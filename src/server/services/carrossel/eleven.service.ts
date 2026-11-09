/**
 * ElevenLabs: narração das mini-novelas em vídeo.
 *
 * A chave é pessoal (guardada criptografada em carousel_setting) com a variável ELEVENLABS_API_KEY como reserva.
 * Ela fica aqui, e não em Configurações > Integrações, porque aquela tela é só de provedores de LLM dos agentes.
 */
import { prisma } from "../../lib/prisma";
import { encrypt, decrypt } from "../../lib/encryption";
import { AIGenerationError } from "./aiClient";

const ELEVEN_URL = "https://api.elevenlabs.io/v1";
export const DEFAULT_ELEVEN_MODEL = "eleven_multilingual_v2";

export class VideoError extends AIGenerationError {}

interface Stored { api_key?: string; voice_id?: string; model?: string }

async function load(userId: number): Promise<Stored> {
  const row = await prisma.carouselSetting.findFirst({ where: { user_id: userId, key: "elevenlabs" } });
  if (!row) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}

export async function getSettings(userId: number) {
  const s = await load(userId);
  return {
    configured: !!(s.api_key || process.env.ELEVENLABS_API_KEY),
    from_env: !s.api_key && !!process.env.ELEVENLABS_API_KEY,
    voice_id: s.voice_id || "",
    model: s.model || DEFAULT_ELEVEN_MODEL,
  };
}

/** api_key vazia = mantém a atual; "-" remove a chave salva. */
export async function saveSettings(userId: number, input: { api_key?: string; voice_id?: string; model?: string }) {
  const cur = await load(userId);
  const next: Stored = { ...cur };
  if (input.api_key === "-") delete next.api_key;
  else if (input.api_key?.trim()) next.api_key = encrypt(input.api_key.trim());
  if (input.voice_id !== undefined) next.voice_id = input.voice_id.trim();
  if (input.model !== undefined) next.model = input.model.trim() || DEFAULT_ELEVEN_MODEL;
  const value = JSON.stringify(next);
  const existing = await prisma.carouselSetting.findFirst({ where: { user_id: userId, key: "elevenlabs" } });
  if (existing) await prisma.carouselSetting.update({ where: { id: existing.id }, data: { value } });
  else await prisma.carouselSetting.create({ data: { user_id: userId, key: "elevenlabs", value } });
  return getSettings(userId);
}

async function apiKey(userId: number): Promise<string> {
  const s = await load(userId);
  const key = (s.api_key ? decrypt(s.api_key) : process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key) throw new VideoError("Cadastre a chave do ElevenLabs (aba \"Prompts e estilos\") para gerar a narração.", 400);
  return key;
}

export async function listVoices(userId: number) {
  const key = await apiKey(userId);
  let res: Response;
  try {
    res = await fetch(`${ELEVEN_URL}/voices`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new VideoError(`Não foi possível falar com o ElevenLabs: ${(e as Error).message}`, 502);
  }
  if (res.status === 401) throw new VideoError("A chave do ElevenLabs foi recusada. Confira em \"Prompts e estilos\".", 401);
  if (!res.ok) throw new VideoError(`ElevenLabs respondeu ${res.status} ao listar as vozes.`, 502);
  const data = await res.json();
  return (data.voices || []).map((v: any) => ({ id: v.voice_id, name: v.name || v.voice_id, preview_url: v.preview_url || "" }));
}

// Estilos de narração. stability baixa = voz mais expressiva e variada; style alto = mais emoção e ênfase; speed < 1 = ritmo
// de quem conta uma história. `pause` é a pausa (s) entre frases; os slides-chave ganham mais intensidade.
export interface VoiceStyle { stability: number; similarity: number; style: number; speed: number; pause: number }

export const NARRATION_STYLES: Record<string, VoiceStyle & { label: string }> = {
  historiador: { label: "Historiador (emocionado, com ênfase)", stability: 0.35, similarity: 0.8, style: 0.45, speed: 0.95, pause: 0.45 },
  suspense: { label: "Suspense (misterioso, pausado)", stability: 0.3, similarity: 0.8, style: 0.6, speed: 0.92, pause: 0.65 },
  neutro: { label: "Neutro (leitura simples)", stability: 0.55, similarity: 0.8, style: 0, speed: 1, pause: 0 },
};
const PEAK_ELEMENTS = ["GANCHO", "VIRADA", "CLÍMAX", "CLIMAX"];

export const isV3 = (model: string) => (model || "").toLowerCase().includes("v3");

export function styleFor(element: string, style: string): VoiceStyle {
  const { label: _label, ...st } = NARRATION_STYLES[style] || NARRATION_STYLES.historiador;
  void _label;
  if (style !== "neutro" && PEAK_ELEMENTS.some((k) => (element || "").toUpperCase().includes(k))) {
    st.stability = Math.max(0.15, st.stability - 0.1); // momentos-chave: mais risco, mais drama
    st.style = Math.min(0.9, st.style + 0.15);
    st.pause += 0.15;
  }
  return st;
}

/** Fala de personagem: mais natural e menos "contada" que a do narrador. */
export const dialogueStyle = (st: VoiceStyle): VoiceStyle => ({
  ...st, speed: 1, style: Math.round(st.style * 0.7 * 100) / 100, stability: Math.min(0.55, st.stability + 0.1), pause: Math.round(st.pause * 0.5 * 100) / 100,
});

/** Pontua a fala como um contador de histórias (pausas SSML do ElevenLabs; o modelo v3 não as aceita). */
export function directText(text: string, st: VoiceStyle, model: string): string {
  if (st.pause <= 0 || isV3(model)) return text;
  const sentences = text.trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const out: string[] = [];
  sentences.forEach((sent, i) => {
    out.push(sent);
    if (i < sentences.length - 1 && i < 8) { // muitas pausas deixam a voz instável
      const pause = st.pause + (/(\.\.\.|…|:)$/.test(sent) ? 0.25 : 0);
      out.push(`<break time="${Math.min(pause, 2).toFixed(2)}s" />`);
    }
  });
  return out.join(" ");
}

export async function synthesize(
  userId: number, text: string, voiceId: string, st: VoiceStyle, ctx: { previous?: string; following?: string } = {},
): Promise<Buffer> {
  const key = await apiKey(userId);
  const model = (await getSettings(userId)).model;
  const body: any = {
    text, model_id: model,
    voice_settings: { stability: st.stability, similarity_boost: st.similarity, style: st.style, use_speaker_boost: true, speed: st.speed },
  };
  if (isV3(model)) body.voice_settings.stability = st.stability < 0.4 ? 0 : 0.5; // o v3 só aceita 0.0, 0.5 ou 1.0 e não usa contexto vizinho
  else {
    if (ctx.previous) body.previous_text = ctx.previous.slice(-400);
    if (ctx.following) body.next_text = ctx.following.slice(0, 400);
  }
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(`${ELEVEN_URL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      throw new VideoError(`Não foi possível falar com o ElevenLabs: ${(e as Error).message}`, 502);
    }
    if (res.status !== 429) break;
  }
  if (!res) throw new VideoError("Sem resposta do ElevenLabs.", 502);
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  const txt = await res.text().catch(() => "");
  if (res.status === 401) throw new VideoError("A chave do ElevenLabs foi recusada.", 401);
  if (res.status === 404 || (res.status === 422 && txt.toLowerCase().includes("voice"))) throw new VideoError("Voz do ElevenLabs não encontrada. Escolha outra voz no episódio.", 400);
  if (res.status === 429) throw new VideoError("Limite do ElevenLabs atingido (créditos ou requisições). Aguarde ou confira seu plano.", 429);
  throw new VideoError(`ElevenLabs recusou o pedido (${res.status}): ${txt.slice(0, 200)}`, 502);
}
