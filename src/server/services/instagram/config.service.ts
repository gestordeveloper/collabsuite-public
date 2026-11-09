/**
 * Credenciais do app do Meta. É UM app para a plataforma toda — as contas de cada cliente entram por
 * OAuth (login do Facebook de quem administra a Página). Banco (tela de Configuração) > .env.
 */
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt, decrypt } from "../../lib/encryption";

export interface MetaConfig {
  appId: string;
  appSecret: string;
  verifyToken: string;
  /** URL pública do app, sem barra final. */
  appUrl: string;
  source: "db" | "env" | "none";
}

const stripSlash = (u: string | null | undefined) => (u || "").trim().replace(/\/+$/, "");

let cache: { value: MetaConfig; at: number } | null = null;
const TTL_MS = 30_000;

export function invalidateConfig() {
  cache = null;
}

export async function getConfig(): Promise<MetaConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await prisma.instagramAppConfig.findUnique({ where: { id: 1 } });
  let value: MetaConfig;
  if (row) {
    value = { appId: row.app_id, appSecret: decrypt(row.app_secret), verifyToken: row.verify_token, appUrl: stripSlash(row.public_url) || stripSlash(process.env.APP_URL), source: "db" };
  } else if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    value = { appId: process.env.FACEBOOK_APP_ID, appSecret: process.env.FACEBOOK_APP_SECRET, verifyToken: process.env.FACEBOOK_VERIFY_TOKEN || "collabsuite_ig_verify", appUrl: stripSlash(process.env.APP_URL), source: "env" };
  } else {
    value = { appId: "", appSecret: "", verifyToken: "", appUrl: stripSlash(process.env.APP_URL), source: "none" };
  }
  cache = { value, at: Date.now() };
  void warmUrl(value.appUrl);
  return value;
}

// URL pública usada de forma síncrona (ex.: transformar /uploads/x em link absoluto para o Instagram).
let syncUrl = stripSlash(process.env.APP_URL);
const warmUrl = async (u: string) => {
  syncUrl = u;
};
export const publicUrlSync = () => syncUrl;

export const isConfigured = (c: MetaConfig) => !!(c.appId && c.appSecret && c.appUrl);

export async function requireConfig(): Promise<MetaConfig> {
  const c = await getConfig();
  if (!c.appId || !c.appSecret) throw new HttpError("O app do Meta ainda não foi configurado. Peça a um administrador para informar o App ID e o App Secret na aba Contas.", 400);
  if (!c.appUrl) throw new HttpError("Informe o endereço do app (URL pública) na configuração do Instagram.", 400);
  return c;
}

/** Sem o segredo: é o que qualquer usuário logado pode ver. */
export async function getPublicConfig(userRole: string) {
  const c = await getConfig();
  return {
    configured: isConfigured(c),
    source: c.source,
    can_edit: userRole === "admin" || userRole === "super_admin",
    app_id: c.appId,
    has_secret: !!c.appSecret,
    public_url: c.appUrl,
    verify_token: c.verifyToken,
    callback_url: c.appUrl ? `${c.appUrl}/api/instagram/oauth/callback` : null,
    webhook_url: c.appUrl ? `${c.appUrl}/api/instagram/webhook` : null,
  };
}

export async function saveConfig(user: { id: number; role: string }, input: { app_id?: string; app_secret?: string; public_url?: string; verify_token?: string }) {
  if (user.role !== "admin" && user.role !== "super_admin") throw new HttpError("Somente administradores configuram o app do Meta.", 403);
  const current = await prisma.instagramAppConfig.findUnique({ where: { id: 1 } });
  const envFallback = await getConfig();

  const appId = (input.app_id ?? current?.app_id ?? envFallback.appId).trim();
  if (!/^\d{8,20}$/.test(appId)) throw new HttpError("O App ID do Meta é um número (veja em developers.facebook.com → seu app → Configurações → Básico).");
  const secret = input.app_secret?.trim();
  const encSecret = secret ? encrypt(secret) : current?.app_secret ?? (envFallback.appSecret ? encrypt(envFallback.appSecret) : null);
  if (!encSecret) throw new HttpError("Informe o App Secret do app do Meta.");
  const url = stripSlash(input.public_url ?? current?.public_url ?? envFallback.appUrl);
  if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new HttpError("Informe o endereço público do app, ex.: https://app.suaempresa.com");
  const verify = input.verify_token?.trim() || current?.verify_token || crypto.randomBytes(12).toString("hex");

  await prisma.instagramAppConfig.upsert({
    where: { id: 1 },
    create: { id: 1, app_id: appId, app_secret: encSecret, verify_token: verify, public_url: url, updated_by: user.id },
    update: { app_id: appId, app_secret: encSecret, verify_token: verify, public_url: url, updated_by: user.id },
  });
  invalidateConfig();
  return getPublicConfig(user.role);
}
