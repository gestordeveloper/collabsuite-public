import type { Request, Response } from "express";
import * as icpService from "../services/icp.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const icps = await icpService.listIcps(req.user!.id);
    res.json(icps);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const icp = await icpService.getIcp(parseInt(req.params.id), req.user!.id);
    res.json(icp);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const icp = await icpService.createIcp(req.user!.id, req.user!.company_id ?? null, req.body);
    res.status(201).json(icp);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const icp = await icpService.updateIcp(parseInt(req.params.id), req.user!.id, req.body);
    res.json(icp);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const result = await icpService.deleteIcp(parseInt(req.params.id), req.user!.id);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
