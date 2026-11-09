/**
 * Conexão OAuth da conta do GitHub de cada pessoa + manutenção do token.
 *
 * Tokens de GitHub App (e de OAuth App com expiração) vencem em ~8 h e vêm com um refresh_token de uso ÚNICO (cada renovação
 * devolve um novo, ~6 meses de validade). Por isso a renovação é serializada por pessoa: usar o mesmo refresh_token duas vezes
 * o invalida e derrubaria a conexão. OAuth Apps comuns não expiram — nesse caso nada disso entra em ação.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt, decrypt } from "../../lib/encryption";
import { runExclusive } from "../../lib/keyedMutex";
import { gh, webBase, GITHUB_AUTH_STATUS, GithubAuthError } from "./api";
import { getConfig, requireConfig, isConfigured } from "./config.service";

const JWT_SECRET = process.env.JWT_SECRET || "collabsuite-secret-key-change-in-production";
// repo: código, PRs, issues e criação de repositórios; workflow: editar workflows e rodar Actions; read:org: listar organizações.
const SCOPES = "repo workflow read:org";
/** Renova no uso quando faltar menos que isso para vencer (folga para relógio e latência). */
const REFRESH_MARGIN_MS = 10 * 60_000;
const RECONNECT_MSG = "O acesso ao GitHub expirou ou foi revogado. Reconecte sua conta do GitHub.";

const redirectUri = (appUrl: string) => `${appUrl}/api/github/oauth/callback`;

/** Só caminhos internos: evita que o `state` vire um redirecionamento aberto. */
function safeReturnTo(value: unknown): string {
  return typeof value === "string" && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : "/projects";
}

export async function buildConnectUrl(userId: number, returnTo?: string): Promise<string> {
  const cfg = await requireConfig();
  const state = jwt.sign({ userId, returnTo: safeReturnTo(returnTo), nonce: crypto.randomBytes(8).toString("hex"), purpose: "gh_oauth" }, JWT_SECRET, { expiresIn: "10m" });
  const url = new URL(`${webBase()}/login/oauth/authorize`);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri(cfg.appUrl));
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

// ─── tokens ─────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Campos a gravar para um par de tokens recém-emitido (sem expires_in = token que não expira). */
function tokenFields(t: TokenResponse & { access_token: string }) {
  const now = Date.now();
  return {
    access_token: encrypt(t.access_token),
    refresh_token: t.refresh_token ? encrypt(t.refresh_token) : null,
    expires_at: t.expires_in ? new Date(now + t.expires_in * 1000) : null,
    refresh_expires_at: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000) : null,
    token_error: null,
  };
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${webBase()}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "CollabSuite" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok && !json.error) throw new Error(`HTTP ${res.status}`);
  return json;
}

/** Callback do GitHub (rota pública). Devolve a URL do app para onde redirecionar o navegador. */
export async function handleCallback(query: { code?: string; state?: string; error?: string }): Promise<string> {
  const cfg = await getConfig();
  let returnTo = "/projects";
  const back = (qs: string) => `${cfg.appUrl}${returnTo}${returnTo.includes("?") ? "&" : "?"}${qs}`;

  let userId: number;
  try {
    const p = jwt.verify(query.state || "", JWT_SECRET) as any;
    if (p.purpose !== "gh_oauth") throw new Error("estado inválido");
    userId = p.userId;
    returnTo = safeReturnTo(p.returnTo);
  } catch {
    return back("gh_error=invalid_state");
  }
  if (query.error) return back("gh_error=cancelled");
  if (!query.code) return back("gh_error=no_code");

  try {
    const tokenJson = await requestToken({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: query.code, redirect_uri: redirectUri(cfg.appUrl) });
    if (!tokenJson.access_token) return back("gh_error=token_exchange");

    const { data: me } = await gh<any>(tokenJson.access_token, "GET", "/user");
    const data = {
      github_id: String(me.id),
      login: me.login,
      avatar: me.avatar_url ?? null,
      scope: tokenJson.scope ?? null,
      ...tokenFields({ ...tokenJson, access_token: tokenJson.access_token }),
    };
    // Uma conta do GitHub só pode estar ligada a uma pessoa da plataforma.
    const taken = await prisma.githubAccount.findFirst({ where: { github_id: data.github_id, NOT: { user_id: userId } } });
    if (taken) return back("gh_error=in_use");
    await prisma.githubAccount.upsert({ where: { user_id: userId }, create: { user_id: userId, ...data }, update: data });
    return back("gh_success=1");
  } catch (e: any) {
    console.error("[github] callback:", e);
    return back("gh_error=server_error");
  }
}

export async function getStatus(userId: number, userRole: string) {
  const cfg = await getConfig();
  const account = await prisma.githubAccount.findUnique({ where: { user_id: userId } });
  return {
    configured: isConfigured(cfg),
    can_configure: userRole === "admin" || userRole === "super_admin",
    connected: !!account,
    login: account?.login ?? null,
    avatar: account?.avatar ?? null,
    token_error: account?.token_error ?? null,
    // true = o token se renova sozinho (GitHub App / OAuth com expiração); false = token que não expira.
    auto_refresh: !!account?.refresh_token,
  };
}

export async function disconnect(userId: number) {
  await prisma.githubAccount.deleteMany({ where: { user_id: userId } });
  return { ok: true };
}

/** Marca (ou limpa) o aviso de token inválido para a pessoa reconectar. */
export async function markTokenError(userId: number, message: string | null) {
  await prisma.githubAccount.updateMany({ where: { user_id: userId }, data: { token_error: message } });
}

/**
 * Erro para "sem token utilizável". Se a pessoa JÁ tem conta conectada, mas a conexão quebrou (expirou/revogada),
 * a mensagem é a do aviso salvo ("Reconecte…") em vez do genérico "Conecte…", que confundiria.
 */
export async function noTokenError(userId: number | null | undefined, fallback = "Conecte sua conta do GitHub para continuar."): Promise<HttpError> {
  const acc = userId ? await prisma.githubAccount.findUnique({ where: { user_id: userId }, select: { token_error: true } }) : null;
  return new HttpError(acc?.token_error || fallback, GITHUB_AUTH_STATUS);
}

export async function requireToken(userId: number, token: string | null): Promise<string> {
  if (!token) throw await noTokenError(userId);
  return token;
}

/**
 * Renova o token de uma pessoa e devolve o token em uso (ou null se a conexão não tem mais conserto).
 *  - `failedToken`: o GitHub acabou de recusar esse token (401) → renova mesmo sem vencer; se outra chamada já renovou
 *    enquanto esperávamos a vez, só devolve o token novo (nunca gasta o mesmo refresh_token duas vezes).
 *  - `within`: renova se vencer em menos que isso (padrão 10 min).
 * Falha de rede NÃO derruba a conexão: devolve o token atual se ainda valer.
 */
export function refreshAccessToken(userId: number, opts: { failedToken?: string; within?: number } = {}): Promise<string | null> {
  return runExclusive(`gh-refresh:${userId}`, async () => {
    const acc = await prisma.githubAccount.findUnique({ where: { user_id: userId } });
    if (!acc) return null;
    let current: string;
    try {
      current = decrypt(acc.access_token);
    } catch {
      return null;
    }
    const now = Date.now();
    const margin = opts.within ?? REFRESH_MARGIN_MS;
    const expiresIn = acc.expires_at ? acc.expires_at.getTime() - now : Infinity;

    if (opts.failedToken) {
      if (current !== opts.failedToken) return current; // outra chamada já renovou
    } else if (expiresIn > margin) {
      return current; // ainda longe de vencer
    }

    const fail = async (message: string) => {
      await markTokenError(userId, message);
      return null;
    };
    if (!acc.refresh_token) {
      // Token que não expira (OAuth App comum) e mesmo assim recusado: foi revogado — só reconectando.
      return opts.failedToken ? fail(RECONNECT_MSG) : current;
    }
    if (acc.refresh_expires_at && acc.refresh_expires_at.getTime() < now) {
      return fail("A conexão com o GitHub ficou tempo demais sem renovar e expirou. Reconecte sua conta do GitHub.");
    }

    let refreshToken: string;
    try {
      refreshToken = decrypt(acc.refresh_token);
    } catch {
      return fail(RECONNECT_MSG);
    }
    const cfg = await getConfig();
    if (!cfg.clientId || !cfg.clientSecret) return expiresIn > 0 ? current : null; // app desconfigurado: não dá para renovar agora

    let res: TokenResponse;
    try {
      res = await requestToken({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (err) {
      console.warn("[github] renovação do token falhou (rede):", err instanceof Error ? err.message : err);
      return expiresIn > 0 ? current : null;
    }
    if (!res.access_token) {
      console.warn("[github] renovação recusada pelo GitHub:", res.error);
      return fail(RECONNECT_MSG);
    }
    await prisma.githubAccount.update({ where: { user_id: userId }, data: { ...tokenFields({ ...res, access_token: res.access_token }), ...(res.scope ? { scope: res.scope } : {}) } });
    return res.access_token;
  });
}

/** Token em claro de uma pessoa (ou null). Renova antes de vencer. Nunca sai do servidor. */
export async function tokenFor(userId: number | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const acc = await prisma.githubAccount.findUnique({ where: { user_id: userId } });
  if (!acc) return null;
  if (acc.refresh_token && acc.expires_at && acc.expires_at.getTime() - Date.now() <= REFRESH_MARGIN_MS) {
    return refreshAccessToken(userId);
  }
  try {
    return decrypt(acc.access_token);
  } catch {
    return null;
  }
}

/**
 * Roda uma chamada ao GitHub com o token da pessoa: se o GitHub recusar (401), renova o token UMA vez e tenta de novo.
 * Só quando não há como renovar é que a pessoa vê o pedido para reconectar.
 */
export async function withUserToken<T>(userId: number, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await requireToken(userId, await tokenFor(userId));
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof GithubAuthError)) throw err;
    const fresh = await refreshAccessToken(userId, { failedToken: token });
    if (!fresh || fresh === token) {
      await markTokenError(userId, RECONNECT_MSG);
      throw err;
    }
    try {
      return await fn(fresh);
    } catch (err2) {
      if (err2 instanceof GithubAuthError) await markTokenError(userId, RECONNECT_MSG);
      throw err2;
    }
  }
}

/** Para o worker: renova os tokens que vencem logo, para nunca expirarem mesmo sem uso. Devolve quantos renovou. */
export async function refreshDueTokens(within = 2 * 3_600_000): Promise<number> {
  const now = new Date();
  const due = await prisma.githubAccount.findMany({
    where: { refresh_token: { not: null }, expires_at: { lt: new Date(now.getTime() + within) }, OR: [{ refresh_expires_at: null }, { refresh_expires_at: { gt: now } }] },
    select: { user_id: true, access_token: true },
  });
  let renewed = 0;
  for (const a of due) {
    const before = (() => { try { return decrypt(a.access_token); } catch { return null; } })();
    const after = await refreshAccessToken(a.user_id, { within }).catch(() => null);
    if (after && after !== before) renewed++;
  }
  return renewed;
}
