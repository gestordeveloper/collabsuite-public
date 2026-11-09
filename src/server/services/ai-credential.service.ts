import { prisma } from "../lib/prisma";
import { encrypt, decrypt } from "../lib/encryption";

export const AI_PROVIDERS = ["groq", "openai", "anthropic", "openrouter"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiCredentialInput {
  api_key: string;
  label?: string | null;
}

interface ScopeStatus {
  configured: boolean;
  label: string | null;
  updated_at: string;
}

export interface AiCredentialStatus {
  provider: AiProvider;
  company: ScopeStatus | null;
  personal: ScopeStatus | null;
}

function assertValidProvider(provider: string): asserts provider is AiProvider {
  if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error("Provedor de IA inválido.");
  }
}

function toScopeStatus(row: { label: string | null; updated_at: Date } | null | undefined): ScopeStatus | null {
  if (!row) return null;
  return { configured: true, label: row.label, updated_at: row.updated_at.toISOString() };
}

export async function listStatus(userId: number, companyId: number | null): Promise<AiCredentialStatus[]> {
  const [companyRows, personalRows] = await Promise.all([
    companyId != null
      ? prisma.aiProviderCredential.findMany({ where: { company_id: companyId, user_id: null, is_active: true } })
      : Promise.resolve([]),
    prisma.aiProviderCredential.findMany({ where: { user_id: userId, is_active: true } }),
  ]);

  return AI_PROVIDERS.map((provider) => ({
    provider,
    company: toScopeStatus(companyRows.find((r) => r.provider === provider)),
    personal: toScopeStatus(personalRows.find((r) => r.provider === provider)),
  }));
}

export async function upsertPersonalCredential(userId: number, provider: string, data: AiCredentialInput) {
  assertValidProvider(provider);
  const existing = await prisma.aiProviderCredential.findFirst({ where: { user_id: userId, provider } });
  const encrypted = encrypt(data.api_key);
  if (existing) {
    await prisma.aiProviderCredential.update({
      where: { id: existing.id },
      data: { api_key: encrypted, label: data.label ?? null, is_active: true },
    });
  } else {
    await prisma.aiProviderCredential.create({
      data: { user_id: userId, provider, api_key: encrypted, label: data.label ?? null },
    });
  }
  return { success: true };
}

export async function deletePersonalCredential(userId: number, provider: string) {
  assertValidProvider(provider);
  await prisma.aiProviderCredential.deleteMany({ where: { user_id: userId, provider } });
  return { success: true };
}

export async function upsertCompanyCredential(companyId: number | null, provider: string, data: AiCredentialInput) {
  assertValidProvider(provider);
  if (companyId == null) {
    throw new Error("Usuário sem empresa associada.");
  }
  const existing = await prisma.aiProviderCredential.findFirst({ where: { company_id: companyId, user_id: null, provider } });
  const encrypted = encrypt(data.api_key);
  if (existing) {
    await prisma.aiProviderCredential.update({
      where: { id: existing.id },
      data: { api_key: encrypted, label: data.label ?? null, is_active: true },
    });
  } else {
    await prisma.aiProviderCredential.create({
      data: { company_id: companyId, user_id: null, provider, api_key: encrypted, label: data.label ?? null },
    });
  }
  return { success: true };
}

export async function deleteCompanyCredential(companyId: number | null, provider: string) {
  assertValidProvider(provider);
  if (companyId == null) return { success: true };
  await prisma.aiProviderCredential.deleteMany({ where: { company_id: companyId, user_id: null, provider } });
  return { success: true };
}

/** Resolve a decrypted API key for a provider: personal override > company-wide > (Groq only) env fallback. */
export async function resolveApiKey(provider: AiProvider, userId: number, companyId: number | null): Promise<string> {
  const personal = await prisma.aiProviderCredential.findFirst({
    where: { user_id: userId, provider, is_active: true },
  });
  if (personal) return decrypt(personal.api_key);

  if (companyId != null) {
    const company = await prisma.aiProviderCredential.findFirst({
      where: { company_id: companyId, user_id: null, provider, is_active: true },
    });
    if (company) return decrypt(company.api_key);
  }

  if (provider === "groq" && process.env.GROQ_API_KEY) {
    return process.env.GROQ_API_KEY;
  }

  throw new Error(`Nenhuma credencial configurada para ${provider}. Configure em Configurações > Integrações.`);
}
