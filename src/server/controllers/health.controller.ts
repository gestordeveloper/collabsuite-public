import type { Request, Response } from "express";
import * as healthService from "../services/health.service";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

/** "Hoje" no calendário do usuário, enviado pelo cliente (?today=YYYY-MM-DD). */
function todayFrom(value: unknown): string | undefined {
  return typeof value === "string" && DAY_RE.test(value) ? value : undefined;
}

function dayParam(req: Request): string {
  if (!DAY_RE.test(req.params.date)) throw new Error("Data inválida (use AAAA-MM-DD).");
  return req.params.date;
}

export async function overview(req: Request, res: Response) {
  try {
    res.json(await healthService.getOverview(req.user!.id, todayFrom(req.query.today)));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function measures(req: Request, res: Response) {
  try {
    res.json(await healthService.getMeasures(req.user!.id));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function saveDay(req: Request, res: Response) {
  try {
    res.json(await healthService.saveDay(req.user!.id, dayParam(req), req.body));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function addWater(req: Request, res: Response) {
  try {
    res.json(await healthService.addWater(req.user!.id, dayParam(req), req.body.delta_ml));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function addWorkout(req: Request, res: Response) {
  try {
    res.status(201).json(await healthService.addWorkout(req.user!.id, req.body));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function deleteWorkout(req: Request, res: Response) {
  try {
    res.json(await healthService.deleteWorkout(req.user!.id, parseInt(req.params.id)));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function setGoals(req: Request, res: Response) {
  try {
    res.json(await healthService.setGoals(req.user!.id, req.body));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function createSyncToken(req: Request, res: Response) {
  try {
    res.json(await healthService.createSyncToken(req.user!.id));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function revokeSyncToken(req: Request, res: Response) {
  try {
    res.json(await healthService.revokeSyncToken(req.user!.id));
  } catch (err: any) {
    handleError(err, res);
  }
}

/** Importação por token (Authorization: Bearer hk_…), sem login: usada por apps ponte e relógios. */
export async function ingest(req: Request, res: Response) {
  try {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "Token ausente." });
    const result = await healthService.ingest(token, req.body);
    if (!result) return res.status(401).json({ error: "Token inválido ou revogado." });
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
