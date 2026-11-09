import { resolveApiKey } from "../ai-credential.service";

/** Transcreve o áudio recebido (Whisper). Prefere Groq (barato/rápido) e cai para OpenAI,
 *  como o pipeline de gravações; o modelo de referência usava whisper-1 da OpenAI. */
export async function transcribeVoiceNote(buffer: Buffer, userId: number, companyId: number | null): Promise<string> {
  const targets: { url: string; model: string; apiKey: string }[] = [];
  for (const t of [
    { provider: "groq" as const, url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
    { provider: "openai" as const, url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
  ]) {
    try {
      targets.push({ url: t.url, model: t.model, apiKey: await resolveApiKey(t.provider, userId, companyId) });
    } catch {
      /* provedor sem credencial */
    }
  }
  if (!targets.length) throw new Error("Nenhuma credencial de transcrição (Groq ou OpenAI) configurada.");

  let lastError = "";
  for (const t of targets) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/ogg" }), "audio.ogg");
    form.append("model", t.model);
    const res = await fetch(t.url, { method: "POST", headers: { Authorization: `Bearer ${t.apiKey}` }, body: form });
    if (res.ok) return String((await res.json()).text ?? "").trim();
    lastError = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
  }
  throw new Error(`Falha na transcrição (${lastError})`);
}
