import type { Request, Response } from "express";
import { sendError, HttpError } from "../lib/httpError";
import * as config from "../services/social/config.service";
import * as account from "../services/social/account.service";
import * as posts from "../services/social/post.service";
import * as tiktok from "../services/social/tiktok";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendError(res, err, "social");
  }
};
const uid = (req: Request) => req.user!.id;
const id = (req: Request) => parseInt(req.params.id);
const pid = (req: Request) => {
  const v = parseInt(String(req.query.project_id ?? req.body?.project_id ?? ""));
  return Number.isInteger(v) ? v : undefined;
};
const platformOf = (req: Request) => config.assertPlatform(req.query.platform ?? req.body?.platform ?? req.params.platform);

// ─── Configuração e contas ──────────────────────────────────────────────────────
export const getConfig = wrap(async (req, res) => res.json(await config.getAllPublicConfigs(req.user!.role)));
export const saveConfig = wrap(async (req, res) => res.json(await config.saveConfig(req.user!, config.assertPlatform(req.params.platform), req.body ?? {})));
export const accounts = wrap(async (req, res) => res.json(await account.listAccounts(uid(req))));
export const connectUrl = wrap(async (req, res) => {
  const projectId = pid(req);
  if (!projectId) throw new HttpError("Selecione o projeto (cliente).");
  res.json({ url: await account.buildConnectUrl(uid(req), projectId, platformOf(req)) });
});
export const disconnect = wrap(async (req, res) => {
  const projectId = pid(req);
  if (!projectId) throw new HttpError("Selecione o projeto (cliente).");
  res.json(await account.disconnect(uid(req), projectId, platformOf(req)));
});

/** Opções reais de privacidade da conta do TikTok (contas sem auditoria só têm "Só eu"). */
export const tiktokCreatorInfo = wrap(async (req, res) => {
  const projectId = pid(req);
  if (!projectId) throw new HttpError("Selecione o projeto (cliente).");
  const acc = await account.requireAccount(uid(req), projectId, "tiktok");
  const { token } = await account.validAccessToken(acc.id);
  try {
    res.json(await tiktok.creatorInfo(token));
  } catch (e: any) {
    throw new HttpError(e.message, 502);
  }
});

/** Rota pública: a rede redireciona o navegador para cá. */
export async function oauthCallback(req: Request, res: Response) {
  const platform = config.assertPlatform(req.params.platform);
  const q = req.query as Record<string, string>;
  res.redirect(await account.handleCallback(platform, { code: q.code, state: q.state, error: q.error, error_description: q.error_description }));
}

// ─── Posts ──────────────────────────────────────────────────────────────────────
export const listPosts = wrap(async (req, res) => res.json(await posts.listPosts(uid(req), pid(req))));
export const getPostByTask = wrap(async (req, res) => res.json(await posts.getPostByTask(uid(req), parseInt(req.params.taskId))));
export const createPosts = wrap(async (req, res) => res.status(201).json(await posts.createPosts(uid(req), req.body)));
export const updatePost = wrap(async (req, res) => res.json(await posts.updatePost(uid(req), id(req), req.body)));
export const deletePost = wrap(async (req, res) => res.json(await posts.deletePost(uid(req), id(req))));
export const publishNow = wrap(async (req, res) => res.json(await posts.publishNow(uid(req), id(req))));
