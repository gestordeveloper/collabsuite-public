import type { Request, Response } from "express";
import { sendError } from "../lib/httpError";
import * as config from "../services/github/config.service";
import * as account from "../services/github/account.service";
import * as repo from "../services/github/repo.service";
import * as report from "../services/github/report.service";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendError(res, err, "github");
  }
};
const uid = (req: Request) => req.user!.id;
const projectId = (req: Request) => parseInt(req.params.projectId);
const num = (req: Request, name = "n") => {
  const v = parseInt(req.params[name]);
  if (!Number.isInteger(v) || v < 1) throw new Error("Número inválido.");
  return v;
};
const page = (req: Request) => Math.max(1, parseInt(String(req.query.page ?? "1")) || 1);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
/** Leitura / escrita: escrita exige a conta do GitHub da própria pessoa. */
const read = (req: Request) => repo.context(uid(req), projectId(req));
const write = (req: Request) => repo.context(uid(req), projectId(req), true);

// ─── Configuração e conta ───────────────────────────────────────────────────────
export const getConfig = wrap(async (req, res) => res.json(await config.getPublicConfig(req.user!.role)));
export const saveConfig = wrap(async (req, res) => res.json(await config.saveConfig(req.user!, req.body ?? {})));
export const status = wrap(async (req, res) => res.json(await account.getStatus(uid(req), req.user!.role)));
export const connectUrl = wrap(async (req, res) => res.json({ url: await account.buildConnectUrl(uid(req), req.body?.return_to) }));
export const disconnect = wrap(async (req, res) => res.json(await account.disconnect(uid(req))));

/** Rota pública: o GitHub redireciona o navegador para cá. */
export async function oauthCallback(req: Request, res: Response) {
  const url = await account.handleCallback({ code: req.query.code as string, state: req.query.state as string, error: req.query.error as string });
  res.redirect(url);
}

// ─── Repositórios ───────────────────────────────────────────────────────────────
export const listRepos = wrap(async (req, res) => res.json(await repo.listRepos(uid(req), page(req))));
export const listOrgs = wrap(async (req, res) => res.json(await repo.listOrgs(uid(req))));
export const getLink = wrap(async (req, res) => res.json(await repo.getLink(uid(req), projectId(req))));
export const createRepo = wrap(async (req, res) => res.status(201).json(await repo.createRepo(uid(req), projectId(req), req.body ?? {})));
export const linkRepo = wrap(async (req, res) => res.json(await repo.linkRepo(uid(req), projectId(req), String(req.body?.full_name ?? ""))));
export const unlinkRepo = wrap(async (req, res) => res.json(await repo.unlinkRepo(uid(req), projectId(req))));

// ─── Commits, branches, arquivos ────────────────────────────────────────────────
export const listCommits = wrap(async (req, res) => res.json(await repo.listCommits(await read(req), { sha: str(req.query.sha), path: str(req.query.path), page: page(req) })));
export const getCommit = wrap(async (req, res) => res.json(await repo.getCommit(await read(req), req.params.ref)));
export const listBranches = wrap(async (req, res) => res.json(await repo.listBranches(await read(req))));
export const createBranch = wrap(async (req, res) => res.status(201).json(await repo.createBranch(await write(req), req.body ?? {})));
export const deleteBranch = wrap(async (req, res) => res.json(await repo.deleteBranch(await write(req), String(req.query.name ?? ""))));
export const getContents = wrap(async (req, res) => res.json(await repo.getContents(await read(req), { path: str(req.query.path), ref: str(req.query.ref) })));
export const putFile = wrap(async (req, res) => res.json(await repo.putFile(await write(req), req.body ?? {})));
export const deleteFile = wrap(async (req, res) => res.json(await repo.deleteFile(await write(req), req.body ?? {})));

// ─── Pull requests ──────────────────────────────────────────────────────────────
export const listPulls = wrap(async (req, res) => res.json(await repo.listPulls(await read(req), { state: str(req.query.state), page: page(req) })));
export const getPull = wrap(async (req, res) => res.json(await repo.getPull(await read(req), num(req))));
export const getPullFiles = wrap(async (req, res) => res.json(await repo.getPullFiles(await read(req), num(req))));
export const createPull = wrap(async (req, res) => res.status(201).json(await repo.createPull(await write(req), req.body ?? {})));
export const mergePull = wrap(async (req, res) => res.json(await repo.mergePull(await write(req), num(req), req.body ?? {})));
export const updatePull = wrap(async (req, res) => res.json(await repo.updatePull(await write(req), num(req), req.body ?? {})));
export const reviewPull = wrap(async (req, res) => res.json(await repo.reviewPull(await write(req), num(req), req.body ?? {})));
export const addComment = wrap(async (req, res) => res.status(201).json(await repo.addComment(await write(req), num(req), String(req.body?.body ?? ""))));

// ─── Issues ─────────────────────────────────────────────────────────────────────
export const listIssues = wrap(async (req, res) => res.json(await repo.listIssues(await read(req), { state: str(req.query.state), page: page(req) })));
export const getIssue = wrap(async (req, res) => res.json(await repo.getIssue(await read(req), num(req))));
export const createIssue = wrap(async (req, res) => res.status(201).json(await repo.createIssue(await write(req), req.body ?? {})));
export const updateIssue = wrap(async (req, res) => res.json(await repo.updateIssue(await write(req), num(req), req.body ?? {})));

// ─── Actions ────────────────────────────────────────────────────────────────────
export const listRuns = wrap(async (req, res) => res.json(await repo.listRuns(await read(req), { branch: str(req.query.branch), status: str(req.query.status), page: page(req) })));
export const getRunJobs = wrap(async (req, res) => res.json(await repo.getRunJobs(await read(req), num(req, "runId"))));
export const getJobLogs = wrap(async (req, res) => res.json(await repo.getJobLogs(await read(req), num(req, "jobId"))));
export const rerunRun = wrap(async (req, res) => res.json(await repo.rerunRun(await write(req), num(req, "runId"), !!req.body?.failed_only)));
export const cancelRun = wrap(async (req, res) => res.json(await repo.cancelRun(await write(req), num(req, "runId"))));
export const listWorkflows = wrap(async (req, res) => res.json(await repo.listWorkflows(await read(req))));
export const dispatchWorkflow = wrap(async (req, res) => res.json(await repo.dispatchWorkflow(await write(req), num(req, "workflowId"), req.body ?? {})));

// ─── Relatório de atualizações (IA + PDF) ───────────────────────────────────────
export const generateReport = wrap(async (req, res) => {
  const b = req.body ?? {};
  res.json(await report.generateReport(uid(req), req.user!.company_id ?? null, projectId(req), {
    since: String(b.since ?? ""), until: String(b.until ?? ""), branch: str(b.branch), provider: str(b.provider), model: str(b.model),
  }));
});
