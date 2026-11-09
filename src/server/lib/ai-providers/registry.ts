import type { AiProvider, AiProviderAdapter } from "./types";
import { createOpenAiCompatibleAdapter } from "./openaiCompatible";
import { createAnthropicAdapter } from "./anthropic";

const adapters: Record<AiProvider, AiProviderAdapter> = {
  groq: createOpenAiCompatibleAdapter({ id: "groq", baseUrl: "https://api.groq.com/openai/v1" }),
  openai: createOpenAiCompatibleAdapter({ id: "openai", baseUrl: "https://api.openai.com/v1" }),
  openrouter: createOpenAiCompatibleAdapter({
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    extraHeaders: {
      "HTTP-Referer": process.env.APP_URL || "https://collabsuite.local",
      "X-Title": "CollabSuite",
    },
  }),
  anthropic: createAnthropicAdapter(),
};

export function getAdapter(provider: AiProvider): AiProviderAdapter {
  return adapters[provider];
}

export * from "./types";
export * from "./models";
