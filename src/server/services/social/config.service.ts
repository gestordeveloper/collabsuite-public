/**
 * Credenciais dos apps do YouTube (Google Cloud) e do TikTok. Um app por rede para a plataforma toda;
 * as contas de cada cliente entram por OAuth. Banco (tela de Configuração) > .env.
 */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt, decrypt } from "../../lib/encryption";
import { getConfig as getMetaConfig } from "../instagram/config.service";

export type Platform = "youtube" | "tiktok";
export const PLATFORMS: Platform[] = ["youtube", "tiktok"];
export const PLATFORM_LABEL: Record<Platform, string> = { youtube: "YouTube", tiktok: "TikTok" };

export const isPlatform = (v: unknown): v is Platform => v === "youtube" || v === "tiktok";
export function assertPlatform(v: unknown): Platform {
  if (!isPlatform(v)) throw new HttpError("Rede social inválida.");
  return v;
}

export interface SocialConfig {
  platform: Platform;
  clientId: string;
  clientSecret: string;
  /** URL pública do app, sem barra final. */
  appUrl: string;
  source: "db" | "env" | "none";
}

const stripSlash = (u: string | null | undefined) => (u || "").trim().replace(/\/+$/, "");
const ENV_KEYS: Record<Platform, [string, string]> = {
  youtube: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
};

export const redirectUri = (platform: Platform, appUrl: string) => `${appUrl}/api/social/oauth/${platform}/callback`;

export async function getConfig(platform: Platform): Promise<SocialConfig> {
  const row = await prisma.socialAppConfig.findUnique({ where: { platform } });
  // O endereço público pode vir do card do Meta (já configurado para o Instagram) ou do .env.
  const metaUrl = stripSlash((await getMetaConfig().catch(() => null))?.appUrl) || stripSlash(process.env.APP_URL);
  if (row) return { platform, clientId: row.client_id, clientSecret: decrypt(row.client_secret), appUrl: stripSlash(row.public_url) || metaUrl, source: "db" };
  const [idKey, secretKey] = ENV_KEYS[platform];
  if (process.env[idKey] && process.env[secretKey]) return { platform, clientId: process.env[idKey]!, clientSecret: process.env[secretKey]!, appUrl: metaUrl, source: "env" };
  return { platform, clientId: "", clientSecret: "", appUrl: metaUrl, source: "none" };
}

export const isConfigured = (c: SocialConfig) => !!(c.clientId && c.clientSecret && c.appUrl);

export async function requireConfig(platform: Platform): Promise<SocialConfig> {
  const c = await getConfig(platform);
  if (!c.clientId || !c.clientSecret) throw new HttpError(`O app do ${PLATFORM_LABEL[platform]} ainda não foi configurado. Peça a um administrador para informar as credenciais na aba Contas.`, 400);
  if (!c.appUrl) throw new HttpError("Informe o endereço público do app na configuração.", 400);
  return c;
}

/** Sem o segredo: é o que qualquer usuário logado pode ver. */
export async function getPublicConfig(platform: Platform, userRole: string) {
  const c = await getConfig(platform);
  return {
    platform,
    configured: isConfigured(c),
    source: c.source,
    can_edit: userRole === "admin" || userRole === "super_admin",
    client_id: c.clientId,
    has_secret: !!c.clientSecret,
    public_url: c.appUrl,
    redirect_uri: c.appUrl ? redirectUri(platform, c.appUrl) : null,
  };
}

export async function getAllPublicConfigs(userRole: string) {
  const [youtube, tiktok] = await Promise.all([getPublicConfig("youtube", userRole), getPublicConfig("tiktok", userRole)]);
  return { youtube, tiktok };
}

export async function saveConfig(user: { id: number; role: string }, platform: Platform, input: { client_id?: string; client_secret?: string; public_url?: string }) {
  if (user.role !== "admin" && user.role !== "super_admin") throw new HttpError("Somente administradores configuram os apps das redes sociais.", 403);
  const current = await prisma.socialAppConfig.findUnique({ where: { platform } });
  const fallback = await getConfig(platform);

  const clientId = (input.client_id ?? current?.client_id ?? fallback.clientId).trim();
  if (!clientId) throw new HttpError(platform === "youtube" ? "Informe o ID do cliente OAuth (Google Cloud)." : "Informe a Client Key do app do TikTok.");
  const secret = input.client_secret?.trim();
  const encSecret = secret ? encrypt(secret) : current?.client_secret ?? (fallback.clientSecret ? encrypt(fallback.clientSecret) : null);
  if (!encSecret) throw new HttpError(platform === "youtube" ? "Informe a chave secreta do cliente OAuth." : "Informe o Client Secret do app do TikTok.");
  const url = stripSlash(input.public_url ?? current?.public_url ?? fallback.appUrl);
  if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new HttpError("Informe o endereço público do app, ex.: https://app.suaempresa.com");

  await prisma.socialAppConfig.upsert({
    where: { platform },
    create: { platform, client_id: clientId, client_secret: encSecret, public_url: url, updated_by: user.id },
    update: { client_id: clientId, client_secret: encSecret, public_url: url, updated_by: user.id },
  });
  return getPublicConfig(platform, user.role);
}
