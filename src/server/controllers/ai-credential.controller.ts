import type { Request, Response } from "express";
import * as aiCredentialService from "../services/ai-credential.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function listStatus(req: Request, res: Response) {
  try {
    const status = await aiCredentialService.listStatus(req.user!.id, req.user!.company_id ?? null);
    res.json(status);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function upsertPersonal(req: Request, res: Response) {
  try {
    const result = await aiCredentialService.upsertPersonalCredential(req.user!.id, req.params.provider, req.body);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function removePersonal(req: Request, res: Response) {
  try {
    const result = await aiCredentialService.deletePersonalCredential(req.user!.id, req.params.provider);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function upsertCompany(req: Request, res: Response) {
  try {
    const result = await aiCredentialService.upsertCompanyCredential(req.user!.company_id ?? null, req.params.provider, req.body);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function removeCompany(req: Request, res: Response) {
  try {
    const result = await aiCredentialService.deleteCompanyCredential(req.user!.company_id ?? null, req.params.provider);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
