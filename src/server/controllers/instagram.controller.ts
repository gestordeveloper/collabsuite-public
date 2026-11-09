import type { Request, Response } from "express";
import { sendError } from "../lib/httpError";
import * as account from "../services/instagram/account.service";
import * as posts from "../services/instagram/post.service";
import * as automations from "../services/instagram/automation.service";
import * as webhook from "../services/instagram/webhook.service";
import * as config from "../services/instagram/config.service";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendError(res, err, "instagram");
  }
};
const uid = (req: Request) => req.user!.id;
const id = (req: Request) => parseInt(req.params.id);
/** ?project_id= (opcional nas listas, obrigatório nas ações de conta). */
const pid = (req: Request) => {
  const v = parseInt(String(req.query.project_id ?? req.body?.project_id ?? ""));
  return Number.isInteger(v) ? v : undefined;
};

// ─── Conta ──────────────────────────────────────────────────────────────────────
export const getConfig = wrap(async (req, res) => res.json(await config.getPublicConfig(req.user!.role)));
export const saveConfig = wrap(async (req, res) => res.json(await config.saveConfig(req.user!, req.body ?? {})));
export const accounts = wrap(async (req, res) => res.json(await account.listAccounts(uid(req))));
export const connectUrl = wrap(async (req, res) => res.json({ url: await account.buildConnectUrl(uid(req), pid(req) as number) }));
export const disconnect = wrap(async (req, res) => res.json(await account.disconnect(uid(req), pid(req) as number)));
export const pendingAccounts = wrap(async (req, res) => res.json({ accounts: account.listPending(uid(req), req.params.selectionId) }));
export const selectAccount = wrap(async (req, res) => res.json(await account.selectPending(uid(req), req.params.selectionId, String(req.body?.instagramId ?? ""))));
export const media = wrap(async (req, res) => res.json({ data: await account.listMedia(uid(req), pid(req) as number) }));

/** Rota pública: o Facebook redireciona o navegador para cá. */
export async function oauthCallback(req: Request, res: Response) {
  const url = await account.handleCallback({ code: req.query.code as string, state: req.query.state as string, error: req.query.error as string });
  res.redirect(url);
}

// ─── Posts ──────────────────────────────────────────────────────────────────────
export const listPosts = wrap(async (req, res) => res.json(await posts.listPosts(uid(req), pid(req))));
export const getPost = wrap(async (req, res) => res.json(await posts.getPost(uid(req), id(req))));
export const getPostByTask = wrap(async (req, res) => res.json(await posts.getPostByTask(uid(req), parseInt(req.params.taskId))));
export const createPost = wrap(async (req, res) => res.status(201).json(await posts.createPost(uid(req), req.body)));
export const updatePost = wrap(async (req, res) => res.json(await posts.updatePost(uid(req), id(req), req.body)));
export const deletePost = wrap(async (req, res) => res.json(await posts.deletePost(uid(req), id(req))));
export const publishNow = wrap(async (req, res) => res.json(await posts.publishNow(uid(req), id(req))));

// ─── Automações (Engajar) ───────────────────────────────────────────────────────
export const listAutomations = wrap(async (req, res) => res.json(await automations.listAutomations(uid(req), pid(req))));
export const automationSummary = wrap(async (req, res) => res.json(await automations.summary(uid(req), pid(req))));
export const createAutomation = wrap(async (req, res) => res.status(201).json(await automations.createAutomation(uid(req), req.body)));
export const updateAutomation = wrap(async (req, res) => res.json(await automations.updateAutomation(uid(req), id(req), req.body)));
export const deleteAutomation = wrap(async (req, res) => res.json(await automations.removeAutomation(uid(req), id(req))));
export const automationEngagements = wrap(async (req, res) => res.json(await automations.listEngagements(uid(req), id(req))));

// ─── Webhook (público) ──────────────────────────────────────────────────────────
export async function webhookVerify(req: Request, res: Response) {
  const expected = await webhook.verifyToken();
  if (expected && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === expected) {
    res.status(200).send(String(req.query["hub.challenge"] ?? ""));
    return;
  }
  res.status(403).json({ error: "Token de verificação inválido." });
}

export async function webhookReceive(req: Request, res: Response) {
  if (!(await webhook.verifySignature((req as any).rawBody, req.headers["x-hub-signature-256"] as string | undefined))) {
    res.status(401).json({ error: "Assinatura inválida." });
    return;
  }
  // A Meta exige 200 rápido e reenvia se demorar: responde já e processa em seguida.
  res.status(200).send("EVENT_RECEIVED");
  void webhook.processPayload(req.body).catch((e) => console.error("[instagram] webhook:", e));
}
