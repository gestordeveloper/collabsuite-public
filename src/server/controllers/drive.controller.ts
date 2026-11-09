import type { Request, Response } from "express";
import * as projectService from "../services/project.service";
import { pipeFile } from "./taskDrive.controller";

function handleDriveError(err: any, res: Response) {
  if (err?.driveScopeError) {
    return res.status(409).json({ error: "O responsável por esta pasta precisa reconectar a conta do Google (Configurações > Perfil) para habilitar o acesso ao Drive." });
  }
  res.status(400).json({ error: err.message || "Erro ao acessar o Google Drive." });
}

export async function getStatus(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const status = await projectService.getProjectDriveStatus(projectId, req.user!.id);
    res.json(status);
  } catch (err: any) {
    handleDriveError(err, res);
  }
}

export async function connect(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const status = await projectService.connectProjectDrive(projectId, req.user!.id);
    res.status(201).json(status);
  } catch (err: any) {
    handleDriveError(err, res);
  }
}

export async function listFiles(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
    const files = await projectService.listProjectDriveFiles(projectId, folderId);
    res.json(files);
  } catch (err: any) {
    handleDriveError(err, res);
  }
}

export async function createFolder(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const folder = await projectService.createProjectDriveFolder(projectId, req.body);
    res.status(201).json(folder);
  } catch (err: any) {
    handleDriveError(err, res);
  }
}

export async function uploadFile(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const file = await projectService.uploadProjectDriveFile(projectId, req.body);
    res.status(201).json(file);
  } catch (err: any) {
    handleDriveError(err, res);
  }
}

export async function getFileContent(req: Request, res: Response) {
  try {
    await pipeFile(parseInt(req.params.projectId), req.params.fileId, res);
  } catch (err: any) {
    if (!res.headersSent) handleDriveError(err, res);
  }
}

export async function deleteFile(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.projectId);
    const { fileId } = req.params;
    const result = await projectService.deleteProjectDriveFile(projectId, fileId);
    res.json(result);
  } catch (err: any) {
    handleDriveError(err, res);
  }
}
