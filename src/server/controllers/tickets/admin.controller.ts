import type { Request, Response } from "express";
import { sendError } from "../../lib/httpError";
import * as queueService from "../../services/tickets/queue.service";
import * as flowService from "../../services/bot/flow.service";

const idParam = (req: Request) => parseInt(req.params.id, 10);

// ─── Filas ───
export const listQueues = async (_req: Request, res: Response) => {
  try {
    res.json(await queueService.listQueues());
  } catch (err) {
    sendError(res, err);
  }
};
export const createQueue = async (req: Request, res: Response) => {
  try {
    res.status(201).json(await queueService.createQueue(req.body));
  } catch (err) {
    sendError(res, err);
  }
};
export const updateQueue = async (req: Request, res: Response) => {
  try {
    res.json(await queueService.updateQueue(idParam(req), req.body));
  } catch (err) {
    sendError(res, err);
  }
};
export const deleteQueue = async (req: Request, res: Response) => {
  try {
    res.json(await queueService.deleteQueue(idParam(req)));
  } catch (err) {
    sendError(res, err);
  }
};

// ─── Etiquetas ───
export const listTags = async (_req: Request, res: Response) => {
  try {
    res.json(await queueService.listTags());
  } catch (err) {
    sendError(res, err);
  }
};
export const createTag = async (req: Request, res: Response) => {
  try {
    res.status(201).json(await queueService.createTag(req.body));
  } catch (err) {
    sendError(res, err);
  }
};
export const updateTag = async (req: Request, res: Response) => {
  try {
    res.json(await queueService.updateTag(idParam(req), req.body));
  } catch (err) {
    sendError(res, err);
  }
};
export const deleteTag = async (req: Request, res: Response) => {
  try {
    res.json(await queueService.deleteTag(idParam(req)));
  } catch (err) {
    sendError(res, err);
  }
};

// ─── Fluxos do bot ───
export const listFlows = async (_req: Request, res: Response) => {
  try {
    res.json(await flowService.listFlows());
  } catch (err) {
    sendError(res, err);
  }
};
export const getFlow = async (req: Request, res: Response) => {
  try {
    res.json(await flowService.getFlow(idParam(req)));
  } catch (err) {
    sendError(res, err);
  }
};
export const createFlow = async (req: Request, res: Response) => {
  try {
    res.status(201).json(await flowService.createFlow(req.body));
  } catch (err) {
    sendError(res, err);
  }
};
export const updateFlow = async (req: Request, res: Response) => {
  try {
    res.json(await flowService.updateFlow(idParam(req), req.body));
  } catch (err) {
    sendError(res, err);
  }
};
export const deleteFlow = async (req: Request, res: Response) => {
  try {
    res.json(await flowService.deleteFlow(idParam(req)));
  } catch (err) {
    sendError(res, err);
  }
};
export const publishFlow = async (req: Request, res: Response) => {
  try {
    res.json(await flowService.publishFlow(idParam(req)));
  } catch (err) {
    sendError(res, err);
  }
};
