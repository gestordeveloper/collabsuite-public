import api from "./api";

export interface PipelineNodeData {
  agentId: number;
  label?: string;
  [key: string]: unknown;
}

export interface PipelineNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: PipelineNodeData;
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
}

export interface AgentPipeline {
  id: number;
  user_id: number;
  company_id?: number | null;
  name: string;
  description?: string | null;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentPipelinePayload {
  name: string;
  description?: string | null;
  nodes?: PipelineNode[];
  edges?: PipelineEdge[];
  is_active?: boolean;
}

export async function fetchPipelines() {
  const { data } = await api.get("/agent-pipelines");
  return data as AgentPipeline[];
}

export async function fetchPipeline(pipelineId: number) {
  const { data } = await api.get(`/agent-pipelines/${pipelineId}`);
  return data as AgentPipeline;
}

export async function createPipeline(payload: AgentPipelinePayload) {
  const { data } = await api.post("/agent-pipelines", payload);
  return data as AgentPipeline;
}

export async function updatePipeline(pipelineId: number, payload: Partial<AgentPipelinePayload>) {
  const { data } = await api.put(`/agent-pipelines/${pipelineId}`, payload);
  return data as AgentPipeline;
}

export async function deletePipeline(pipelineId: number) {
  await api.delete(`/agent-pipelines/${pipelineId}`);
}

export async function runPipeline(pipelineId: number, input: string) {
  const { data } = await api.post(`/agent-pipelines/${pipelineId}/run`, { input });
  return data as { run_id: number };
}
