/**
 * Canais do YouTube / contas do TikTok: uma de cada por PROJETO (cliente). Qualquer membro do projeto usa a conta;
 * os tokens ficam criptografados e `user_id` guarda só quem conectou.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt, decrypt } from "../../lib/encryption";
import { runExclusive } from "../../lib/keyedMutex";
import { assertMember, memberProjectIds } from "../instagram/account.service";
import { requireConfig, getConfig, isConfigured, redirectUri, PLATFORMS, PLATFORM_LABEL, type Platform } from "./config.service";
import { PlatformError } from "./errors";
import * as youtube from "./youtube";
import * as tiktok from "./tiktok";

export { memberProjectIds };

const JWT_SECRET = process.env.JWT_SECRET || "collabsuite-secret-key-change-in-production";
const REFRESH_MARGIN_MS = 5 * 60_000;

export async function buildConnectUrl(userId: number, projectId: number, platform: Platform): Promise<string> {
  const cfg = await requireConfig(platform);
  await assertMember(userId, projectId);
  const state = jwt.sign({ userId, projectId, platform, nonce: crypto.randomBytes(8).toString("hex"), purpose: "social_oauth" }, JWT_SECRET, { expiresIn: "10m" });
  const redirect = redirectUri(platform, cfg.appUrl);
  return platform === "youtube" ? youtube.authUrl(cfg.clientId, redirect, state) : tiktok.authUrl(cfg.clientId, redirect, state);
}

/** Callback da rede (rota pública). Devolve a URL do app para onde redirecionar o navegador. */
export async function handleCallback(platform: Platform, query: { code?: string; state?: string; error?: string; error_description?: string }): Promise<string> {
  const cfg = await getConfig(platform);
  let projectId = 0;
  const back = (qs: string) => `${cfg.appUrl}/instagram?tab=account&project=${projectId}&${qs}`;
  let userId: number;
  try {
    const p = jwt.verify(query.state || "", JWT_SECRET) as any;
    if (p.purpose !== "social_oauth" || p.platform !== platform) throw new Error("estado inválido");
    userId = p.userId;
    projectId = p.projectId;
  } catch {
    return back(`social_error=invalid_state&social_platform=${platform}`);
  }
  if (query.error) return back(`social_error=cancelled&social_platform=${platform}`);
  if (!query.code) return back(`social_error=no_code&social_platform=${platform}`);

  try {
    await assertMember(userId, projectId);
    const redirect = redirectUri(platform, cfg.appUrl);
    if (platform === "youtube") {
      const tok = await youtube.exchangeCode(cfg.clientId, cfg.clientSecret, redirect, query.code);
      const channel = await youtube.getChannel(tok.access_token);
      await saveAccount({
        userId, projectId, platform, externalId: channel.id, username: channel.title, avatar: channel.avatar,
        accessToken: tok.access_token, refreshToken: tok.refresh_token ?? null, expiresInSec: tok.expires_in,
      });
    } else {
      const tok = await tiktok.exchangeCode(cfg.clientId, cfg.clientSecret, redirect, query.code);
      const user = await tiktok.getUser(tok.access_token).catch(() => ({ open_id: tok.open_id, display_name: "TikTok", avatar_url: null }));
      await saveAccount({
        userId, projectId, platform, externalId: tok.open_id || user.open_id, username: user.display_name, avatar: user.avatar_url,
        accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresInSec: tok.expires_in,
      });
    }
    return back(`social_success=${platform}`);
  } catch (e: any) {
    if (e instanceof HttpError) return back(`social_error=in_use&social_platform=${platform}&social_detail=${encodeURIComponent(e.message)}`);
    if (e instanceof PlatformError) return back(`social_error=failed&social_platform=${platform}&social_detail=${encodeURIComponent(e.message)}`);
    console.error(`[social] callback ${platform}:`, e);
    return back(`social_error=server_error&social_platform=${platform}`);
  }
}

async function saveAccount(a: { userId: number; projectId: number; platform: Platform; externalId: string; username: string; avatar: string | null; accessToken: string; refreshToken: string | null; expiresInSec: number }) {
  const taken = await prisma.socialAccount.findUnique({ where: { platform_external_id: { platform: a.platform, external_id: a.externalId } }, include: { project: { select: { name: true } } } });
  if (taken && taken.project_id !== a.projectId) {
    throw new HttpError(`Essa conta do ${PLATFORM_LABEL[a.platform]} já está conectada ao projeto "${taken.project.name ?? taken.project_id}". Desconecte lá antes de usar em outro cliente.`, 409);
  }
  const current = await prisma.socialAccount.findUnique({ where: { project_id_platform: { project_id: a.projectId, platform: a.platform } } });
  const data = {
    user_id: a.userId,
    connected: true,
    external_id: a.externalId,
    username: a.username.slice(0, 150),
    avatar: a.avatar?.slice(0, 1000) ?? null,
    access_token: encrypt(a.accessToken),
    // O Google só devolve refresh_token no primeiro consentimento: se não veio, mantém o anterior.
    refresh_token: a.refreshToken ? encrypt(a.refreshToken) : current?.refresh_token ?? null,
    expires_at: new Date(Date.now() + a.expiresInSec * 1000),
    token_error: null,
  };
  await prisma.socialAccount.upsert({
    where: { project_id_platform: { project_id: a.projectId, platform: a.platform } },
    create: { project_id: a.projectId, platform: a.platform, ...data },
    update: data,
  });
}

/** Todos os projetos do usuário, cada um com os canais conectados. */
export async function listAccounts(userId: number) {
  const [yt, tt] = await Promise.all([getConfig("youtube"), getConfig("tiktok")]);
  const projects = await prisma.project.findMany({
    where: { OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] },
    select: { id: true, name: true, color: true, socialAccounts: true },
    orderBy: { name: "asc" },
  });
  const view = (a?: (typeof projects)[number]["socialAccounts"][number]) =>
    a && a.connected ? { id: a.id, username: a.username, avatar: a.avatar, token_error: a.token_error } : null;
  return {
    configured: { youtube: isConfigured(yt), tiktok: isConfigured(tt) },
    projects: projects.map((p) => ({
      project_id: p.id,
      project_name: p.name ?? `Projeto ${p.id}`,
      project_color: p.color,
      youtube: view(p.socialAccounts.find((a) => a.platform === "youtube")),
      tiktok: view(p.socialAccounts.find((a) => a.platform === "tiktok")),
    })),
  };
}

export async function disconnect(userId: number, projectId: number, platform: Platform) {
  await assertMember(userId, projectId);
  const acc = await prisma.socialAccount.findUnique({ where: { project_id_platform: { project_id: projectId, platform } } });
  if (acc?.connected) {
    // Mantém a linha (posts dependem dela): só limpa os tokens. Reconectar reativa.
    await prisma.socialAccount.update({ where: { id: acc.id }, data: { connected: false, access_token: "", refresh_token: null, expires_at: null, token_error: null } });
    const cfg = await getConfig(platform);
    const token = decrypt(acc.access_token);
    if (platform === "youtube") void youtube.revoke(acc.refresh_token ? decrypt(acc.refresh_token) : token);
    else if (cfg.clientId) void tiktok.revoke(cfg.clientId, cfg.clientSecret, token);
  }
  return listAccounts(userId);
}

/** Conta do projeto — erro amigável se não houver/estiver desconectada. */
export async function requireAccount(userId: number, projectId: number, platform: Platform) {
  const project = await assertMember(userId, projectId);
  const acc = await prisma.socialAccount.findUnique({ where: { project_id_platform: { project_id: projectId, platform } } });
  if (!acc || !acc.connected) throw new HttpError(`Conecte o ${PLATFORM_LABEL[platform]} do projeto "${project.name ?? projectId}" (aba Contas) antes de continuar.`, 400);
  return acc;
}

/** Token de acesso válido (renova se estiver perto de vencer). Serializado por conta: o TikTok troca o refresh_token a cada renovação. */
export function validAccessToken(accountId: number): Promise<{ token: string; platform: Platform; externalId: string }> {
  return runExclusive(`social-token-${accountId}`, async () => {
    const acc = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!acc || !acc.connected) throw new PlatformError("A conta desta rede está desconectada. Reconecte para publicar.", false);
    const platform = acc.platform as Platform;
    const fresh = acc.expires_at && acc.expires_at.getTime() - Date.now() > REFRESH_MARGIN_MS;
    if (fresh) return { token: decrypt(acc.access_token), platform, externalId: acc.external_id };

    if (!acc.refresh_token) {
      await prisma.socialAccount.update({ where: { id: acc.id }, data: { token_error: "Sem refresh token. Reconecte." } });
      throw new PlatformError(`O acesso ao ${PLATFORM_LABEL[platform]} expirou. Reconecte a conta na aba Contas.`, false);
    }
    const cfg = await getConfig(platform);
    try {
      const tok = platform === "youtube" ? await youtube.refreshToken(cfg.clientId, cfg.clientSecret, decrypt(acc.refresh_token)) : await tiktok.refreshToken(cfg.clientId, cfg.clientSecret, decrypt(acc.refresh_token));
      await prisma.socialAccount.update({
        where: { id: acc.id },
        data: {
          access_token: encrypt(tok.access_token),
          ...(tok.refresh_token ? { refresh_token: encrypt(tok.refresh_token) } : {}),
          expires_at: new Date(Date.now() + tok.expires_in * 1000),
          token_error: null,
        },
      });
      return { token: tok.access_token, platform, externalId: acc.external_id };
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      if (e instanceof PlatformError && !e.retryable) await prisma.socialAccount.update({ where: { id: acc.id }, data: { token_error: msg } });
      throw e;
    }
  });
}

/** Renova antes que o refresh token do TikTok (1 ano) ou o access token vençam sem uso. */
export async function refreshStaleAccounts(): Promise<void> {
  const soon = new Date(Date.now() + 24 * 60 * 60_000);
  const rows = await prisma.socialAccount.findMany({ where: { connected: true, refresh_token: { not: null }, OR: [{ expires_at: null }, { expires_at: { lt: soon } }] }, select: { id: true } });
  for (const r of rows) await validAccessToken(r.id).catch((e) => console.warn(`[social] renovação do token ${r.id}:`, e?.message ?? e));
}

export { PLATFORMS };
