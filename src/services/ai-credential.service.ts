import api from "./api";

export type AiProvider = "groq" | "openai" | "anthropic" | "openrouter";

export interface AiCredentialScopeStatus {
  configured: boolean;
  label: string | null;
  updated_at: string;
}

export interface AiCredentialStatus {
  provider: AiProvider;
  company: AiCredentialScopeStatus | null;
  personal: AiCredentialScopeStatus | null;
}

export async function fetchAiCredentialStatus() {
  const { data } = await api.get("/ai-credentials");
  return data as AiCredentialStatus[];
}

export async function savePersonalAiCredential(provider: AiProvider, apiKey: string, label?: string) {
  await api.put(`/ai-credentials/personal/${provider}`, { api_key: apiKey, label: label || undefined });
}

export async function deletePersonalAiCredential(provider: AiProvider) {
  await api.delete(`/ai-credentials/personal/${provider}`);
}

export async function saveCompanyAiCredential(provider: AiProvider, apiKey: string, label?: string) {
  await api.put(`/ai-credentials/company/${provider}`, { api_key: apiKey, label: label || undefined });
}

export async function deleteCompanyAiCredential(provider: AiProvider) {
  await api.delete(`/ai-credentials/company/${provider}`);
}
