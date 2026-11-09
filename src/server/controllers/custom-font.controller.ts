import type { Request, Response } from "express";
import * as customFontService from "../services/custom-font.service";

export async function listCustomFonts(req: Request, res: Response) {
  try {
    const fonts = await customFontService.listCustomFonts(req.user!.id, req.user!.company_id);
    res.json(fonts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createCustomFont(req: Request, res: Response) {
  try {
    const font = await customFontService.createCustomFont({
      ...req.body,
      user_id: req.user!.id,
      company_id: req.user!.company_id,
    });
    res.status(201).json(font);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteCustomFont(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await customFontService.getCustomFontById(id);
    if (!existing) return res.status(404).json({ error: "Fonte não encontrada" });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    await customFontService.deleteCustomFont(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
