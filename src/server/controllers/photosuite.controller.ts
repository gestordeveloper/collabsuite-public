import type { Request, Response } from "express";
import * as photosuiteService from "../services/photosuite.service";

function fail(err: any, res: Response) {
  const status = err?.statusCode;
  if (status) return res.status(status).json({ error: err.message });
  console.error("[photosuite]", err);
  res.status(500).json({ error: err?.message || "Erro interno" });
}

/**
 * Carrega o documento e confere o acesso (dono, ou membro do projeto se for compartilhado).
 * Com `ownerOnly`, só o dono passa. Responde 4xx e devolve null caso contrário.
 */
async function load(req: Request, res: Response, ownerOnly = false) {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return null;
  }
  const doc = await photosuiteService.getPhotoDocumentById(id);
  if (!doc) {
    res.status(404).json({ error: "Documento não encontrado" });
    return null;
  }
  const isOwner = doc.user_id === req.user!.id;
  if (ownerOnly ? !isOwner : !(await photosuiteService.canAccess(doc, req.user!.id))) {
    res.status(403).json({ error: ownerOnly ? "Só o dono pode fazer isso" : "Acesso negado" });
    return null;
  }
  return { doc, isOwner };
}

export async function listPhotoDocuments(req: Request, res: Response) {
  try {
    res.json(await photosuiteService.listPhotoDocuments(req.user!.id, req.user!.company_id));
  } catch (err) {
    fail(err, res);
  }
}

export async function getPhotoDocument(req: Request, res: Response) {
  try {
    const r = await load(req, res);
    if (r) res.json({ ...r.doc, is_owner: r.isOwner });
  } catch (err) {
    fail(err, res);
  }
}

export async function createPhotoDocument(req: Request, res: Response) {
  try {
    const doc = await photosuiteService.createPhotoDocument({ ...req.body, user_id: req.user!.id, company_id: req.user!.company_id });
    res.status(201).json(doc);
  } catch (err) {
    fail(err, res);
  }
}

export async function updatePhotoDocument(req: Request, res: Response) {
  try {
    const r = await load(req, res);
    if (!r) return;
    res.json(await photosuiteService.updatePhotoDocument(r.doc.id, req.user!.id, req.body));
  } catch (err) {
    fail(err, res);
  }
}

export async function deletePhotoDocument(req: Request, res: Response) {
  try {
    const r = await load(req, res, true);
    if (!r) return;
    await photosuiteService.deletePhotoDocument(r.doc.id);
    res.json({ success: true });
  } catch (err) {
    fail(err, res);
  }
}

export async function duplicatePhotoDocument(req: Request, res: Response) {
  try {
    const r = await load(req, res);
    if (!r) return;
    res.status(201).json(await photosuiteService.duplicatePhotoDocument(r.doc.id, req.user!.id));
  } catch (err) {
    fail(err, res);
  }
}

/** Liga/desliga o link público (só o dono). */
export async function sharePhotoDocument(req: Request, res: Response) {
  try {
    const r = await load(req, res, true);
    if (!r) return;
    res.json(await photosuiteService.setPublicShare(r.doc.id, req.body.enabled, req.body.image_url));
  } catch (err) {
    fail(err, res);
  }
}

/** Página pública: sem autenticação, só a imagem publicada. */
export async function getPublicPhotoDocument(req: Request, res: Response) {
  try {
    res.json(await photosuiteService.getPublicPhotoDocument(req.params.token));
  } catch (err) {
    fail(err, res);
  }
}
