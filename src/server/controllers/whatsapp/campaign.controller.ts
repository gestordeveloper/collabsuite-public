import type { Request, Response } from "express";
import * as campaignService from "../../services/whatsapp/campaign.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const campaigns = await campaignService.listCampaigns(req.user!.id);
    res.json(campaigns);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const campaign = await campaignService.getCampaign(req.user!.id, campaignId);
    res.json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const campaign = await campaignService.createCampaign(req.user!.id, req.body);
    res.status(201).json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const campaign = await campaignService.updateCampaign(req.user!.id, campaignId, req.body);
    res.json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const result = await campaignService.deleteCampaign(req.user!.id, campaignId);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function schedule(req: Request, res: Response) {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const scheduledAt = req.body?.scheduled_at ?? null;
    const campaign = await campaignService.scheduleCampaign(req.user!.id, campaignId, scheduledAt);
    res.json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function pause(req: Request, res: Response) {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const campaign = await campaignService.pauseCampaign(req.user!.id, campaignId);
    res.json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function unschedule(req: Request, res: Response) {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const campaign = await campaignService.unscheduleCampaign(req.user!.id, campaignId);
    res.json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function getForTask(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.taskId);
    const campaign = await campaignService.getCampaignByTaskId(taskId);
    res.json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function upsertForTask(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.taskId);
    const campaign = await campaignService.upsertTaskCampaign(req.user!.id, taskId, req.body);
    res.json(campaign);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function listRecipients(req: Request, res: Response) {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const recipients = await campaignService.listRecipients(req.user!.id, campaignId);
    res.json(recipients);
  } catch (err: any) {
    handleError(err, res);
  }
}
