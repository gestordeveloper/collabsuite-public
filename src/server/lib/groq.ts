const GROQ_API_BASE = "https://api.groq.com/openai/v1";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
// llama-3.3-70b-versatile now requires a Groq Enterprise contract and 404s on a standard key.
const CHAT_MODEL = "openai/gpt-oss-120b";

function getApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY não configurada. Defina-a no .env para usar transcrição e chat com IA.");
  }
  return key;
}

export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ text: string; language?: string }> {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType || "audio/mpeg" }), filename);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");

  const res = await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq transcription failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return { text: data.text ?? "", language: data.language };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq chat failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
