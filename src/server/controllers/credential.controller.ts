import type { Request, Response } from "express";
import * as credentialService from "../services/credential.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const credentials = await credentialService.listCredentials(projectId, req.user!.id);
    res.json(credentials);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const credential = await credentialService.createCredential(projectId, req.user!.id, req.body);
    res.status(201).json(credential);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const credentialId = parseInt(req.params.credentialId);
    const credential = await credentialService.updateCredential(projectId, credentialId, req.user!.id, req.body);
    res.json(credential);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const credentialId = parseInt(req.params.credentialId);
    const result = await credentialService.deleteCredential(projectId, credentialId, req.user!.id);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function reveal(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const credentialId = parseInt(req.params.credentialId);
    const result = await credentialService.revealCredentialPassword(projectId, credentialId, req.user!.id);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
