import type { Request, Response } from "express";
import * as agentService from "../services/agent.service";
import * as agentRunService from "../services/agent-run.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const agents = await agentService.listAgents(req.user!.id);
    res.json(agents);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const agent = await agentService.getAgent(parseInt(req.params.id), req.user!.id);
    res.json(agent);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const agent = await agentService.createAgent(req.user!.id, req.user!.company_id ?? null, req.body);
    res.status(201).json(agent);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const agent = await agentService.updateAgent(parseInt(req.params.id), req.user!.id, req.body);
    res.json(agent);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const result = await agentService.deleteAgent(parseInt(req.params.id), req.user!.id);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function run(req: Request, res: Response) {
  try {
    const agentId = parseInt(req.params.id);
    const { message, history, icp_ids } = req.body as {
      message: string;
      history?: { role: "user" | "assistant"; content: string }[];
      icp_ids?: number[];
    };
    const result = await agentRunService.runStandaloneAgent(
      agentId,
      req.user!.id,
      req.user!.company_id ?? null,
      message,
      history,
      icp_ids
    );
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
