import type { Request, Response } from "express";
import * as agentPipelineService from "../services/agent-pipeline.service";
import * as agentRunService from "../services/agent-run.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const pipelines = await agentPipelineService.listPipelines(req.user!.id);
    res.json(pipelines);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const pipeline = await agentPipelineService.getPipeline(parseInt(req.params.id), req.user!.id);
    res.json(pipeline);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const pipeline = await agentPipelineService.createPipeline(req.user!.id, req.user!.company_id ?? null, req.body);
    res.status(201).json(pipeline);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const pipeline = await agentPipelineService.updatePipeline(parseInt(req.params.id), req.user!.id, req.body);
    res.json(pipeline);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const result = await agentPipelineService.deletePipeline(parseInt(req.params.id), req.user!.id);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function run(req: Request, res: Response) {
  try {
    const pipelineId = parseInt(req.params.id);
    const { input } = req.body as { input: string };
    const result = await agentRunService.startPipelineRun(pipelineId, req.user!.id, req.user!.company_id ?? null, input);
    res.status(201).json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
