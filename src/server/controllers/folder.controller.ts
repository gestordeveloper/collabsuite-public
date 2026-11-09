import type { Request, Response } from "express";
import * as folderService from "../services/folder.service";

export async function listFolders(req: Request, res: Response) {
  try {
    const folders = await folderService.listFolders(req.user!.id);
    res.json(folders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createFolder(req: Request, res: Response) {
  try {
    const { name } = req.body;
    const folder = await folderService.createFolder(name, req.user!.id);
    res.status(201).json(folder);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteFolder(req: Request, res: Response) {
  try {
    const folderId = parseInt(req.params.id);
    if (isNaN(folderId)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    await folderService.deleteFolder(folderId, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
