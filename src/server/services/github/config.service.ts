/**
 * Credenciais do OAuth App do GitHub. É UM app para a plataforma toda — cada pessoa autoriza a própria
 * conta depois. Banco (tela de configuração, só admin) > .env.
 */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt, decrypt } from "../../lib/encryption";

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  /** URL pública do app, sem barra final. */
  appUrl: string;
  source: "db" | "env" | "none";
}

const stripSlash = (u: string | null | undefined) => (u || "").trim().replace(/\/+$/, "");

let cache: { value: GithubConfig; at: number } | null = null;
const TTL_MS = 30_000;

export function invalidateConfig() {
  cache = null;
}

export async function getConfig(): Promise<GithubConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await prisma.githubAppConfig.findUnique({ where: { id: 1 } });
  let value: GithubConfig;
  if (row) {
    value = { clientId: row.client_id, clientSecret: decrypt(row.client_secret), appUrl: stripSlash(row.public_url) || stripSlash(process.env.APP_URL), source: "db" };
  } else if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    value = { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, appUrl: stripSlash(process.env.APP_URL), source: "env" };
  } else {
    value = { clientId: "", clientSecret: "", appUrl: stripSlash(process.env.APP_URL), source: "none" };
  }
  cache = { value, at: Date.now() };
  return value;
}

export const isConfigured = (c: GithubConfig) => !!(c.clientId && c.clientSecret && c.appUrl);

export async function requireConfig(): Promise<GithubConfig> {
  const c = await getConfig();
  if (!c.clientId || !c.clientSecret) throw new HttpError("O app do GitHub ainda não foi configurado. Peça a um administrador para informar o Client ID e o Client Secret.", 400);
  if (!c.appUrl) throw new HttpError("Informe o endereço público do app na configuração do GitHub.", 400);
  return c;
}

/** Sem o segredo: é o que qualquer usuário logado pode ver. */
export async function getPublicConfig(userRole: string) {
  const c = await getConfig();
  return {
    configured: isConfigured(c),
    source: c.source,
    can_edit: userRole === "admin" || userRole === "super_admin",
    client_id: c.clientId,
    has_secret: !!c.clientSecret,
    public_url: c.appUrl,
    callback_url: c.appUrl ? `${c.appUrl}/api/github/oauth/callback` : null,
  };
}

export async function saveConfig(user: { id: number; role: string }, input: { client_id?: string; client_secret?: string; public_url?: string }) {
  if (user.role !== "admin" && user.role !== "super_admin") throw new HttpError("Somente administradores configuram o app do GitHub.", 403);
  const current = await prisma.githubAppConfig.findUnique({ where: { id: 1 } });
  const fallback = await getConfig();

  const clientId = (input.client_id ?? current?.client_id ?? fallback.clientId).trim();
  if (!/^[A-Za-z0-9._-]{8,80}$/.test(clientId)) throw new HttpError("Informe o Client ID do OAuth App (GitHub → Settings → Developer settings → OAuth Apps).");
  const secret = input.client_secret?.trim();
  const encSecret = secret ? encrypt(secret) : current?.client_secret ?? (fallback.clientSecret ? encrypt(fallback.clientSecret) : null);
  if (!encSecret) throw new HttpError("Informe o Client Secret do OAuth App.");
  const url = stripSlash(input.public_url ?? current?.public_url ?? fallback.appUrl);
  if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new HttpError("Informe o endereço público do app, ex.: https://app.suaempresa.com");

  await prisma.githubAppConfig.upsert({
    where: { id: 1 },
    create: { id: 1, client_id: clientId, client_secret: encSecret, public_url: url, updated_by: user.id },
    update: { client_id: clientId, client_secret: encSecret, public_url: url, updated_by: user.id },
  });
  invalidateConfig();
  return getPublicConfig(user.role);
}
