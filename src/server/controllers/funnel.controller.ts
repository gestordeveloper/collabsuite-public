import type { Request, Response } from "express";
import * as funnelService from "../services/funnel.service";
import * as accessService from "../services/access.service";
import { emitToUser } from "../lib/socket";

function handleError(res: Response, err: any, fallbackStatus = 500) {
  res.status(err.statusCode || fallbackStatus).json({ error: err.message });
}

async function broadcastToFunnelViewers(funnelId: number, event: string, data: unknown) {
  const viewerIds = await accessService.getFunnelViewerIds(funnelId);
  viewerIds.forEach((userId) => emitToUser(userId, event, data));
}

export async function listFunnels(req: Request, res: Response) {
  try {
    const funnels = await funnelService.listFunnelsByUser(req.user!.id);
    res.json(funnels);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function listFunnelsByProject(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id);
    await accessService.assertProjectMember(projectId, req.user!.id);
    const funnels = await funnelService.listFunnelsByProject(projectId, req.user!.id);
    res.json(funnels);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function createFunnel(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id);
    await accessService.assertProjectMember(projectId, req.user!.id);
    const funnel = await funnelService.createFunnel(projectId, req.body);
    await broadcastToFunnelViewers(funnel!.id, "funnel_created", funnel);
    res.status(201).json(funnel);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function updateFunnel(req: Request, res: Response) {
  try {
    const funnelId = parseInt(req.params.id);
    await accessService.assertFunnelAccess(funnelId, req.user!.id);
    const funnel = await funnelService.updateFunnel(funnelId, req.body);
    await broadcastToFunnelViewers(funnelId, "funnel_updated", funnel);
    res.json(funnel);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function deleteFunnel(req: Request, res: Response) {
  try {
    const funnelId = parseInt(req.params.id);
    await accessService.assertFunnelAccess(funnelId, req.user!.id);
    const viewerIds = await accessService.getFunnelViewerIds(funnelId);
    await funnelService.deleteFunnel(funnelId);
    viewerIds.forEach((userId) => emitToUser(userId, "funnel_deleted", { funnelId }));
    res.json({ success: true });
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function createStage(req: Request, res: Response) {
  try {
    const funnelId = parseInt(req.params.id);
    await accessService.assertFunnelAccess(funnelId, req.user!.id);
    const { name, status } = req.body;
    const stage = await funnelService.createStage(funnelId, name, status);
    await broadcastToFunnelViewers(funnelId, "stage_created", { funnelId, stage });
    res.status(201).json(stage);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function updateStage(req: Request, res: Response) {
  try {
    const stageId = parseInt(req.params.id);
    const { funnel_id } = await accessService.assertStageAccess(stageId, req.user!.id);
    const stage = await funnelService.updateStage(stageId, req.body);
    await broadcastToFunnelViewers(funnel_id, "stage_updated", stage);
    res.json(stage);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function deleteStage(req: Request, res: Response) {
  try {
    const stageId = parseInt(req.params.id);
    const { funnel_id } = await accessService.assertStageAccess(stageId, req.user!.id);
    const viewerIds = await accessService.getFunnelViewerIds(funnel_id);
    await funnelService.deleteStage(stageId);
    viewerIds.forEach((userId) => emitToUser(userId, "stage_deleted", { stageId }));
    res.json({ success: true });
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function listFunnelUsers(req: Request, res: Response) {
  try {
    const funnelId = parseInt(req.params.id);
    await accessService.assertFunnelAccess(funnelId, req.user!.id);
    const users = await funnelService.getFunnelUsers(funnelId);
    res.json(users);
  } catch (err: any) {
    handleError(res, err);
  }
}

export async function addFunnelUser(req: Request, res: Response) {
  try {
    const funnelId = parseInt(req.params.id);
    await accessService.assertFunnelAccess(funnelId, req.user!.id);
    const { user_id } = req.body;
    const shared = await funnelService.addUserToFunnel(funnelId, user_id);
    emitToUser(user_id, "funnels_updated", null);
    res.status(201).json(shared);
  } catch (err: any) {
    handleError(res, err, 400);
  }
}

export async function removeFunnelUser(req: Request, res: Response) {
  try {
    const funnelId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);
    await accessService.assertFunnelAccess(funnelId, req.user!.id);
    await funnelService.removeUserFromFunnel(funnelId, userId);
    emitToUser(userId, "funnels_updated", null);
    res.json({ success: true });
  } catch (err: any) {
    handleError(res, err, 400);
  }
}
