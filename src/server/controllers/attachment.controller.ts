import type { Request, Response } from "express";
import * as attachmentService from "../services/attachment.service";
import { emitAll } from "../lib/socket";

export async function listAttachments(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.taskId);
    const attachments = await attachmentService.listAttachments(taskId);
    res.json(attachments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createAttachment(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.taskId);
    const { file_name, file_url, file_size, file_type } = req.body;
    if (!file_name || !file_url) {
      return res.status(400).json({ error: "file_name and file_url are required" });
    }
    const attachment = await attachmentService.createAttachment(taskId, {
      file_name, file_url, file_size, file_type,
    });
    emitAll("attachment_added", { taskId, attachment });
    res.status(201).json(attachment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteAttachment(req: Request, res: Response) {
  try {
    const attachmentId = parseInt(req.params.attachmentId);
    const taskId = parseInt(req.params.taskId);
    await attachmentService.deleteAttachment(attachmentId);
    emitAll("attachment_removed", { taskId, attachmentId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}