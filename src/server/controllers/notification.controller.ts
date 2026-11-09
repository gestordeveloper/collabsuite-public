import type { Request, Response } from "express";
import * as notificationService from "../services/notification.service";
import { getVapidPublicKey } from "../lib/webPush";

export async function listNotifications(req: Request, res: Response) {
  try {
    const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const notifications = await notificationService.listNotifications(req.user!.id, { cursor, limit });
    res.json(notifications);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getUnreadCount(req: Request, res: Response) {
  try {
    const count = await notificationService.unreadCount(req.user!.id);
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function markRead(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    await notificationService.markRead(req.user!.id, id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function markAllRead(req: Request, res: Response) {
  try {
    await notificationService.markAllRead(req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSettings(req: Request, res: Response) {
  try {
    const settings = await notificationService.getSettings(req.user!.id);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateSettings(req: Request, res: Response) {
  try {
    const settings = await notificationService.updateSettings(req.user!.id, req.body);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getVapidKey(_req: Request, res: Response) {
  res.json({ publicKey: getVapidPublicKey() });
}

export async function subscribePush(req: Request, res: Response) {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Subscription inválida" });
    }
    await notificationService.saveSubscription(req.user!.id, {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: req.headers["user-agent"],
    });
    res.status(201).json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function unsubscribePush(req: Request, res: Response) {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: "endpoint é obrigatório" });
    }
    await notificationService.removeSubscription(endpoint);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
