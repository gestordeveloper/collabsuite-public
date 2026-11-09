import type { Request, Response } from "express";
import * as transcriptService from "../services/transcript.service";

export async function createTranscript(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.taskId);
    const attachmentId = parseInt(req.params.attachmentId);
    const transcript = await transcriptService.getOrCreateTranscript(taskId, attachmentId);
    const result = transcript.status === "done" ? transcript : await transcriptService.runTranscription(transcript.id);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function retryTranscription(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const result = await transcriptService.runTranscription(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function listForTask(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.taskId);
    const list = await transcriptService.listTranscriptsForTask(taskId);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getOne(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const transcript = await transcriptService.getTranscript(id);
    if (!transcript) return res.status(404).json({ error: "Transcrição não encontrada." });
    res.json(transcript);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function sendMessage(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }
    const reply = await transcriptService.sendChatMessage(id, message);
    res.status(201).json(reply);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
