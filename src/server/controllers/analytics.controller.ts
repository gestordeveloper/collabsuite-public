import type { Request, Response } from "express";
import * as analyticsService from "../services/analytics.service";

export async function getStats(req: Request, res: Response) {
  try {
    const user = req.user!;
    const isSuperAdmin = user.role === "super_admin";
    const data = await analyticsService.getStats({
      userId: user.id,
      isSuperAdmin,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getBurndown(req: Request, res: Response) {
  try {
    const user = req.user!;
    const isSuperAdmin = user.role === "super_admin";
    const data = await analyticsService.getBurndown({
      userId: user.id,
      isSuperAdmin,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRanking(req: Request, res: Response) {
  try {
    const user = req.user!;
    const isSuperAdmin = user.role === "super_admin";
    const data = await analyticsService.getRanking({
      userId: user.id,
      isSuperAdmin,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getProductivity(req: Request, res: Response) {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
    const userId = req.query.user_id ? parseInt(req.query.user_id as string) : undefined;
    const projectId = req.query.project_id ? parseInt(req.query.project_id as string) : undefined;
    const data = await analyticsService.getProductivity({ viewerId: req.user!.id, days, userId, projectId });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
