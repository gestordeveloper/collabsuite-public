import api from "./api";

export interface LocalCli {
  id: number;
  name: string;
  preset: string;
  command: string;
  args: string;
  prompt_mode: "stdin" | "arg";
  models: string[];
  models_text: string;
  timeout_sec: number;
  is_active: boolean;
  installed: boolean;
}

export interface CliPreset {
  preset: string;
  label: string;
  command: string;
  args: string;
  prompt_mode: "stdin" | "arg";
  models: string;
  path?: string | null;
}

export type LocalCliInput = Pick<LocalCli, "name" | "preset" | "command" | "args" | "prompt_mode" | "timeout_sec" | "is_active"> & { models: string };

export const listLocalClis = () => api.get<LocalCli[]>("/local-clis").then((r) => r.data);
export const getCliPresets = () => api.get<{ presets: CliPreset[]; detected: CliPreset[] }>("/local-clis/presets").then((r) => r.data);
export const createLocalCli = (d: LocalCliInput) => api.post("/local-clis", d).then((r) => r.data);
export const updateLocalCli = (id: number, d: Partial<LocalCliInput>) => api.put(`/local-clis/${id}`, d).then((r) => r.data);
export const deleteLocalCli = (id: number) => api.delete(`/local-clis/${id}`);
export const testLocalCli = (id: number, model?: string) => api.post<{ ok: boolean; ms: number; reply: string }>(`/local-clis/${id}/test`, { model }, { timeout: 15 * 60 * 1000 }).then((r) => r.data);

export interface CliAgentStatus { connected: boolean; clis: { name: string; models: string[] }[]; pending: number }
export const getCliAgentStatus = () => api.get<CliAgentStatus>("/cli-agent/status").then((r) => r.data);
export const createCliAgentToken = () => api.post<{ token: string }>("/cli-agent/token").then((r) => r.data.token);
