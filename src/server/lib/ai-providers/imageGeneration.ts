// OpenRouter's image-capable models (e.g. Google's "Nano Banana" Gemini Flash Image) are
// generated through a dedicated endpoint, separate from the chat/completions shape used by
// openaiCompatible.ts — this is a different capability, not another chat adapter.
export const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

export interface GeneratedImageResult {
  buffer: Buffer;
  mimeType: string;
}

export async function generateImageOpenRouter(apiKey: string, prompt: string, model: string = DEFAULT_IMAGE_MODEL): Promise<GeneratedImageResult> {
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt, n: 1 }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Geração de imagem falhou (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const item = data.data?.[0];
  if (!item?.b64_json) {
    throw new Error("O provedor não retornou nenhuma imagem.");
  }

  return {
    buffer: Buffer.from(item.b64_json, "base64"),
    mimeType: item.media_type || "image/png",
  };
}
