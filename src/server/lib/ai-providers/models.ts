import type { AiProvider } from "./types";

export interface ModelOption {
  id: string;
  label: string;
}

export const PROVIDER_MODELS: Record<AiProvider, ModelOption[]> = {
  groq: [
    // Llama 3.1/3.3 require a Groq Enterprise contract ("Contact Sales") — a standard API
    // key gets a 404 model_not_found on these. Kept in the list (labeled) since some
    // accounts do have access; GPT-OSS below are the ones available self-serve.
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Enterprise)" },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Enterprise)" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  ],
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (via OpenRouter)" },
    { id: "openai/gpt-4.1", label: "GPT-4.1 (via OpenRouter)" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (via OpenRouter)" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OpenRouter)" },
  ],
};

export function isValidModel(provider: AiProvider, model: string): boolean {
  return PROVIDER_MODELS[provider].some((m) => m.id === model);
}
