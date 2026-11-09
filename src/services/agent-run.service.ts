import api from "./api";

export type AgentRunStatus = "pending" | "running" | "done" | "error" | "cancelled";

export interface AgentRunStep {
  id: number;
  run_id: number;
  node_id: string | null;
  agent_id: number | null;
  step_order: number;
  status: AgentRunStatus;
  input: string | null;
  output: string | null;
  tool_calls: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface AgentRun {
  id: number;
  user_id: number;
  pipeline_id: number | null;
  agent_id: number | null;
  status: AgentRunStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  steps?: AgentRunStep[];
  agent?: { id: number; name: string } | null;
  pipeline?: { id: number; name: string } | null;
}

export async function fetchRuns(opts: { pipelineId?: number; agentId?: number } = {}) {
  const { data } = await api.get("/agent-runs", {
    params: { pipeline_id: opts.pipelineId, agent_id: opts.agentId },
  });
  return data as AgentRun[];
}

export async function fetchRun(runId: number) {
  const { data } = await api.get(`/agent-runs/${runId}`);
  return data as AgentRun;
}
