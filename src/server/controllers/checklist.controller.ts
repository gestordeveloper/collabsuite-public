import type { Request, Response } from "express";
import * as checklistService from "../services/checklist.service";
import { emitAll } from "../lib/socket";

export async function listChecklist(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const items = await checklistService.listChecklist(taskId);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function addChecklistItem(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const { item, task } = await checklistService.addChecklistItem(taskId, req.body.title);
    emitAll("task_updated", task);
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateChecklistItem(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { item, task } = await checklistService.updateChecklistItem(id, req.body);
    emitAll("task_updated", task);
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklistItem(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const result = await checklistService.deleteChecklistItem(id);
    if (result) {
      emitAll("task_updated", result.task);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}