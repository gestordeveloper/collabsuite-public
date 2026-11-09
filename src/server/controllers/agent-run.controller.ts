import type { Request, Response } from "express";
import * as agentRunService from "../services/agent-run.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const pipelineId = req.query.pipeline_id ? parseInt(req.query.pipeline_id as string) : undefined;
    const agentId = req.query.agent_id ? parseInt(req.query.agent_id as string) : undefined;
    const runs = await agentRunService.listRuns(req.user!.id, { pipelineId, agentId });
    res.json(runs);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const run = await agentRunService.getRun(parseInt(req.params.id), req.user!.id);
    res.json(run);
  } catch (err: any) {
    handleError(err, res);
  }
}
