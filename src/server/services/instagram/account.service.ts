/**
 * Contas do Instagram: uma por PROJETO (cada projeto = um cliente). Qualquer membro do projeto usa a
 * conta; o token fica criptografado e `user_id` guarda só quem conectou.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt, decrypt } from "../../lib/encryption";
import * as graph from "./graph";
import { getConfig, requireConfig, isConfigured as cfgReady } from "./config.service";

const JWT_SECRET = process.env.JWT_SECRET || "collabsuite-secret-key-change-in-production";

const redirectUri = (appUrl: string) => `${appUrl}/api/instagram/oauth/callback`;

// ─── Acesso por projeto ─────────────────────────────────────────────────────────

const memberWhere = (userId: number) => ({ OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] });

/** Projetos de que o usuário é dono ou membro. */
export async function memberProjectIds(userId: number): Promise<number[]> {
  const rows = await prisma.project.findMany({ where: memberWhere(userId), select: { id: true } });
  return rows.map((r) => r.id);
}

export async function assertMember(userId: number, projectId: number): Promise<{ id: number; name: string | null }> {
  if (!Number.isInteger(projectId)) throw new HttpError("Selecione o projeto (cliente).");
  const project = await prisma.project.findFirst({ where: { id: projectId, ...memberWhere(userId) }, select: { id: true, name: true } });
  if (!project) throw new HttpError("Projeto não encontrado ou sem permissão de acesso.", 404);
  return project;
}

// Contas descobertas no OAuth quando o usuário tem mais de uma Página — só em memória (10 min), com os tokens.
const pending = new Map<string, { userId: number; projectId: number; userToken: string; accounts: graph.IgAccountOption[]; expires: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}, 60_000).unref();

export async function buildConnectUrl(userId: number, projectId: number): Promise<string> {
  const cfg = await requireConfig();
  await assertMember(userId, projectId);
  const state = jwt.sign({ userId, projectId, nonce: crypto.randomBytes(8).toString("hex"), purpose: "ig_oauth" }, JWT_SECRET, { expiresIn: "10m" });
  return graph.oauthDialogUrl(cfg.appId, redirectUri(cfg.appUrl), state);
}

async function saveAccount(userId: number, projectId: number, userToken: string, a: graph.IgAccountOption) {
  const taken = await prisma.instagramAccount.findUnique({ where: { ig_user_id: a.instagramId }, include: { project: { select: { name: true } } } });
  if (taken && taken.project_id !== projectId) {
    throw new HttpError(`@${a.username || a.instagramId} já está conectada ao projeto "${taken.project.name ?? taken.project_id}". Desconecte lá antes de usar em outro cliente.`, 409);
  }
  const data = {
    user_id: userId,
    connected: true,
    ig_user_id: a.instagramId,
    username: a.username || null,
    avatar: a.avatar || null,
    page_name: a.pageName || null,
    page_token: encrypt(a.pageToken),
    user_token: encrypt(userToken),
    token_error: null,
    refreshed_at: new Date(),
  };
  await prisma.instagramAccount.upsert({ where: { project_id: projectId }, create: { project_id: projectId, ...data }, update: data });
  getConfig()
    .then((cfg) => graph.setupWebhooks(cfg, a.instagramId, a.pageToken))
    .then((ok) => prisma.instagramAccount.update({ where: { project_id: projectId }, data: { webhook_ok: ok } }))
    .catch((e) => console.warn("[instagram] webhook setup:", e));
}

/** Callback do Facebook (rota pública). Devolve a URL do app para onde redirecionar o navegador. */
export async function handleCallback(query: { code?: string; state?: string; error?: string }): Promise<string> {
  let projectId = 0;
  const cfg = await getConfig();
  const back = (qs: string) => `${cfg.appUrl}/instagram?tab=account&project=${projectId}&${qs}`;
  let userId: number;
  try {
    const p = jwt.verify(query.state || "", JWT_SECRET) as any;
    if (p.purpose !== "ig_oauth") throw new Error("estado inválido");
    userId = p.userId;
    projectId = p.projectId;
  } catch {
    return back("ig_error=invalid_state");
  }
  if (query.error) return back("ig_error=cancelled");
  if (!query.code) return back("ig_error=no_code");

  try {
    await assertMember(userId, projectId);
    const userToken = await graph.exchangeCode(cfg.appId, cfg.appSecret, redirectUri(cfg.appUrl), query.code);
    const accounts = await graph.listInstagramAccounts(userToken);
    if (accounts.length === 0) return back("ig_error=no_instagram");
    if (accounts.length === 1) {
      await saveAccount(userId, projectId, userToken, accounts[0]);
      return back("ig_success=1");
    }
    const id = crypto.randomBytes(12).toString("hex");
    pending.set(id, { userId, projectId, userToken, accounts, expires: Date.now() + 10 * 60_000 });
    return back(`ig_select=${id}`);
  } catch (e: any) {
    if (e instanceof HttpError) return back(`ig_error=in_use&ig_detail=${encodeURIComponent(e.message)}`);
    console.error("[instagram] callback:", e);
    return back("ig_error=server_error");
  }
}

function getPending(userId: number, id: string) {
  const p = pending.get(id);
  if (!p || p.userId !== userId || p.expires < Date.now()) throw new HttpError("A seleção expirou. Conecte novamente.", 404);
  return p;
}

export function listPending(userId: number, id: string) {
  return getPending(userId, id).accounts.map(({ pageToken: _t, ...rest }) => rest);
}

export async function selectPending(userId: number, id: string, instagramId: string) {
  const p = getPending(userId, id);
  const chosen = p.accounts.find((a) => a.instagramId === instagramId);
  if (!chosen) throw new HttpError("Conta não encontrada.", 404);
  await saveAccount(userId, p.projectId, p.userToken, chosen);
  pending.delete(id);
  return listAccounts(userId);
}

/** Todos os projetos do usuário, cada um com a conta conectada (se houver). */
export async function listAccounts(userId: number) {
  const cfg = await getConfig();
  const projects = await prisma.project.findMany({
    where: memberWhere(userId),
    select: { id: true, name: true, color: true, instagramAccount: true },
    orderBy: { name: "asc" },
  });
  return {
    configured: cfgReady(cfg),
    projects: projects.map((p) => {
      const a = p.instagramAccount;
      return {
        project_id: p.id,
        project_name: p.name ?? `Projeto ${p.id}`,
        project_color: p.color,
        connected: !!a?.connected,
        account: a
          ? { id: a.id, username: a.username, avatar: a.avatar, page_name: a.page_name, webhook_ok: a.webhook_ok, token_error: a.token_error, connected: a.connected }
          : null,
      };
    }),
  };
}

export async function disconnect(userId: number, projectId: number) {
  await assertMember(userId, projectId);
  const acc = await prisma.instagramAccount.findUnique({ where: { project_id: projectId } });
  if (acc) {
    // Mantém a linha (posts e automações dependem dela): só limpa os tokens. Reconectar reativa.
    await prisma.instagramAccount.update({ where: { id: acc.id }, data: { connected: false, page_token: "", user_token: null, webhook_ok: false, token_error: null } });
    await prisma.instagramAutomation.updateMany({ where: { account_id: acc.id }, data: { status: "paused" } });
  }
  return listAccounts(userId);
}

/** Conta do projeto com o token já descriptografado — erro amigável se não houver/estiver desconectada. */
export async function requireAccount(userId: number, projectId: number) {
  const project = await assertMember(userId, projectId);
  const acc = await prisma.instagramAccount.findUnique({ where: { project_id: projectId } });
  if (!acc || !acc.connected) throw new HttpError(`Conecte a conta do Instagram do projeto "${project.name ?? projectId}" antes de continuar.`, 400);
  return { ...acc, token: decrypt(acc.page_token) };
}

/** Usado pelo publicador (sem usuário logado): o acesso já foi checado quando o post foi criado. */
export async function accountTokenById(accountId: number) {
  const acc = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
  if (!acc || !acc.connected) throw new HttpError("A conta do Instagram deste projeto está desconectada. Reconecte para publicar.", 400);
  return { ...acc, token: decrypt(acc.page_token) };
}

export async function accountByIgId(igUserId: string) {
  const acc = await prisma.instagramAccount.findUnique({ where: { ig_user_id: igUserId } });
  return acc?.connected ? { ...acc, token: decrypt(acc.page_token) } : null;
}

export async function listMedia(userId: number, projectId: number) {
  const acc = await requireAccount(userId, projectId);
  try {
    return await graph.listMedia(acc.token, acc.ig_user_id);
  } catch (e: any) {
    throw new HttpError(e.message, 502);
  }
}

/** Renova o token de usuário (~60 dias) e busca um token de página novo. Chamado pelo worker. */
export async function refreshAccount(accountId: number): Promise<void> {
  const acc = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
  if (!acc?.connected || !acc.user_token) return;
  const { appId, appSecret } = await getConfig();
  if (!appId || !appSecret) return;
  try {
    const userToken = await graph.exchangeLongLived(appId, appSecret, decrypt(acc.user_token));
    const match = (await graph.listInstagramAccounts(userToken)).find((a) => a.instagramId === acc.ig_user_id);
    if (!match) throw new Error("A página vinculada ao Instagram não foi encontrada na conta.");
    await prisma.instagramAccount.update({
      where: { id: acc.id },
      data: { user_token: encrypt(userToken), page_token: encrypt(match.pageToken), token_error: null, refreshed_at: new Date() },
    });
  } catch (e: any) {
    await prisma.instagramAccount.update({ where: { id: acc.id }, data: { token_error: String(e.message).slice(0, 300) } });
  }
}
