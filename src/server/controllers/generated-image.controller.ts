import type { Request, Response } from "express";
import * as generatedImageService from "../services/generated-image.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const agentId = req.query.agent_id ? parseInt(req.query.agent_id as string) : undefined;
    const images = await generatedImageService.listImages(req.user!.id, { agentId });
    res.json(images);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const result = await generatedImageService.deleteImage(parseInt(req.params.id), req.user!.id);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
