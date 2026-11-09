import type { Request, Response } from "express";
import * as designService from "../services/design.service";

export async function listDesigns(req: Request, res: Response) {
  try {
    const designs = await designService.listDesigns(req.user!.id, req.user!.company_id);
    res.json(designs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDesign(req: Request, res: Response) {
  try {
    const designId = parseInt(req.params.id);
    if (isNaN(designId)) return res.status(400).json({ error: "ID inválido" });

    const design = await designService.getDesignById(designId);
    if (!design) return res.status(404).json({ error: "Design não encontrado" });

    if (design.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    res.json(design);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createDesign(req: Request, res: Response) {
  try {
    const design = await designService.createDesign({
      ...req.body,
      user_id: req.user!.id,
      company_id: req.user!.company_id,
    });
    res.status(201).json(design);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateDesign(req: Request, res: Response) {
  try {
    const designId = parseInt(req.params.id);
    if (isNaN(designId)) return res.status(400).json({ error: "ID inválido" });

    const existing = await designService.getDesignById(designId);
    if (!existing) return res.status(404).json({ error: "Design não encontrado" });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const design = await designService.updateDesign(designId, req.body);
    res.json(design);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteDesign(req: Request, res: Response) {
  try {
    const designId = parseInt(req.params.id);
    if (isNaN(designId)) return res.status(400).json({ error: "ID inválido" });

    const existing = await designService.getDesignById(designId);
    if (!existing) return res.status(404).json({ error: "Design não encontrado" });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    await designService.deleteDesign(designId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function duplicateDesign(req: Request, res: Response) {
  try {
    const designId = parseInt(req.params.id);
    if (isNaN(designId)) return res.status(400).json({ error: "ID inválido" });

    const existing = await designService.getDesignById(designId);
    if (!existing) return res.status(404).json({ error: "Design não encontrado" });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const copy = await designService.duplicateDesign(designId);
    res.status(201).json(copy);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
