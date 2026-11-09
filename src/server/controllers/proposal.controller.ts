import type { Request, Response } from "express";
import * as proposalService from "../services/proposal.service";

export async function listTemplates(req: Request, res: Response) {
  try {
    const templates = await proposalService.listTemplates(req.user!.id, req.user!.company_id);
    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getTemplate(req: Request, res: Response) {
  try {
    const templateId = parseInt(req.params.id);
    if (isNaN(templateId)) return res.status(400).json({ error: "ID inválido" });

    const template = await proposalService.getTemplateById(templateId);
    if (!template) return res.status(404).json({ error: "Modelo não encontrado" });

    // Verify ownership
    if (template.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createTemplate(req: Request, res: Response) {
  try {
    const template = await proposalService.createTemplate({
      ...req.body,
      user_id: req.user!.id,
      company_id: req.user!.company_id,
    });
    res.status(201).json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateTemplate(req: Request, res: Response) {
  try {
    const templateId = parseInt(req.params.id);
    if (isNaN(templateId)) return res.status(400).json({ error: "ID inválido" });

    const existing = await proposalService.getTemplateById(templateId);
    if (!existing) return res.status(404).json({ error: "Modelo não encontrado" });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const template = await proposalService.updateTemplate(templateId, req.body);
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteTemplate(req: Request, res: Response) {
  try {
    const templateId = parseInt(req.params.id);
    if (isNaN(templateId)) return res.status(400).json({ error: "ID inválido" });

    const existing = await proposalService.getTemplateById(templateId);
    if (!existing) return res.status(404).json({ error: "Modelo não encontrado" });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    await proposalService.deleteTemplate(templateId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/** Public endpoint - returns merged proposal data for a task */
export async function getPublicProposal(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: "ID inválido" });

    const proposal = await proposalService.getProposalForTask(taskId);
    if (!proposal) return res.status(404).json({ error: "Proposta não encontrada" });

    res.json(proposal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
