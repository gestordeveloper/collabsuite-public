import type { Request, Response } from "express";
import * as activityService from "../services/activity.service";
import { emitAll } from "../lib/socket";

export async function addActivity(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const { content, attachment_url, attachment_name, attachment_type, attachment_size } = req.body;
    const { activity, task } = await activityService.addActivity(taskId, req.user!.id, content, attachment_url
      ? { url: attachment_url, name: attachment_name, type: attachment_type, size: attachment_size }
      : undefined);
    emitAll("task_updated", task);
    res.status(201).json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
