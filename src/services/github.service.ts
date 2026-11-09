import api from "./api";

// ─── tipos ──────────────────────────────────────────────────────────────────────

export interface GithubConfig {
  configured: boolean;
  source: "db" | "env" | "none";
  can_edit: boolean;
  client_id: string;
  has_secret: boolean;
  public_url: string;
  callback_url: string | null;
}

export interface GithubStatus {
  configured: boolean;
  can_configure: boolean;
  connected: boolean;
  login: string | null;
  avatar: string | null;
  token_error: string | null;
  /** true = o token se renova sozinho (GitHub App / OAuth com expiração). */
  auto_refresh: boolean;
}

export interface Person { login: string; avatar: string | null }
export interface Label { name: string; color: string }

export interface RepoLink {
  linked: true;
  owner: string;
  repo: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  is_private: boolean;
  can_write: boolean;
  info: null | { description: string | null; stars: number; forks: number; open_issues: number; language: string | null; pushed_at: string | null; permissions: any };
  info_error: string | null;
}
export type RepoLinkState = RepoLink | { linked: false };

export interface RepoOption { full_name: string; private: boolean; description: string | null; updated_at: string | null }

export interface Commit {
  sha: string;
  short: string;
  message: string;
  full_message: string;
  author: { name: string; login: string | null; avatar: string | null };
  date: string | null;
  html_url: string;
}
export interface DiffFile {
  filename: string;
  previous_filename: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  patch_truncated: boolean;
}
export interface CommitDetail extends Commit {
  stats: { additions: number; deletions: number; total: number } | null;
  parents: string[];
  files: DiffFile[];
}

export interface Branch { name: string; sha: string; protected: boolean }

export type DirEntry = { name: string; path: string; type: "dir" | "file" | "other"; size: number; sha: string };
export type Contents =
  | { type: "dir"; path: string; entries: DirEntry[] }
  | { type: "other"; path: string; name: string }
  | { type: "file"; path: string; name: string; sha: string; size: number; html_url: string; download_url: string | null; content: string | null; base64: string | null; binary: boolean; too_large: boolean };

export interface Pull {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  user: Person | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  comments: number;
  labels: Label[];
  html_url: string;
}
export interface Comment { id: number; user: Person | null; body: string; created_at: string }
export interface Review { id: number; user: Person | null; state: string; body: string; submitted_at: string }
export interface PullDetail extends Pull {
  body: string;
  mergeable: boolean | null;
  mergeable_state: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  merged_by: Person | null;
  comment_list: Comment[];
  reviews: Review[];
}

export interface Issue {
  number: number;
  title: string;
  state: "open" | "closed";
  user: Person | null;
  created_at: string;
  updated_at: string;
  comments: number;
  labels: Label[];
  html_url: string;
}
export interface IssueDetail extends Issue { body: string; comment_list: Comment[] }

export interface Run {
  id: number;
  name: string;
  title: string;
  run_number: number;
  attempt: number;
  event: string;
  status: string;
  conclusion: string | null;
  branch: string;
  sha: string;
  actor: Person | null;
  workflow_id: number;
  created_at: string;
  updated_at: string;
  html_url: string;
}
export interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: { number: number; name: string; status: string; conclusion: string | null }[];
}
export interface Workflow { id: number; name: string; path: string; state: string }

// ─── configuração e conta ───────────────────────────────────────────────────────

export const getConfig = async () => (await api.get("/github/config")).data as GithubConfig;
export const saveConfig = async (p: { client_id?: string; client_secret?: string; public_url?: string }) => (await api.put("/github/config", p)).data as GithubConfig;
export const getStatus = async () => (await api.get("/github/status")).data as GithubStatus;
export const connectUrl = async (returnTo: string) => (await api.post("/github/connect-url", { return_to: returnTo })).data.url as string;
export const disconnect = async () => (await api.delete("/github/account")).data;

// ─── repositórios ───────────────────────────────────────────────────────────────

export const listRepos = async () => (await api.get("/github/repos")).data as { repos: RepoOption[]; has_next: boolean };
export const listOrgs = async () => (await api.get("/github/orgs")).data as { login: string; avatar: string | null }[];

const base = (projectId: number) => `/github/projects/${projectId}`;

export const getLink = async (projectId: number) => (await api.get(`${base(projectId)}/repo`)).data as RepoLinkState;
export const createRepo = async (projectId: number, p: { name: string; description?: string; private?: boolean; org?: string }) =>
  (await api.post(`${base(projectId)}/repo/create`, p)).data as RepoLink;
export const linkRepo = async (projectId: number, full_name: string) => (await api.post(`${base(projectId)}/repo/link`, { full_name })).data as RepoLink;
export const unlinkRepo = async (projectId: number) => (await api.delete(`${base(projectId)}/repo`)).data;

// ─── código ─────────────────────────────────────────────────────────────────────

export const listCommits = async (projectId: number, q: { sha?: string; path?: string; page?: number }) =>
  (await api.get(`${base(projectId)}/commits`, { params: q })).data as { commits: Commit[]; has_next: boolean };
export const getCommit = async (projectId: number, ref: string) => (await api.get(`${base(projectId)}/commits/${encodeURIComponent(ref)}`)).data as CommitDetail;
export const listBranches = async (projectId: number) => (await api.get(`${base(projectId)}/branches`)).data as { default_branch: string; branches: Branch[] };
export const createBranch = async (projectId: number, p: { name: string; from?: string }) => (await api.post(`${base(projectId)}/branches`, p)).data as { name: string; sha: string };
export const deleteBranch = async (projectId: number, name: string) => (await api.delete(`${base(projectId)}/branches`, { params: { name } })).data;
export const getContents = async (projectId: number, path: string, ref?: string) => (await api.get(`${base(projectId)}/contents`, { params: { path, ref } })).data as Contents;
export const putFile = async (projectId: number, p: { path: string; content: string; message: string; branch: string; sha?: string }) =>
  (await api.put(`${base(projectId)}/file`, p)).data as { commit: Commit; sha: string; path: string };
export const deleteFile = async (projectId: number, p: { path: string; message: string; branch: string; sha: string }) =>
  (await api.delete(`${base(projectId)}/file`, { data: p })).data as { commit: Commit };

// ─── pull requests e issues ─────────────────────────────────────────────────────

export const listPulls = async (projectId: number, state: string, page = 1) => (await api.get(`${base(projectId)}/pulls`, { params: { state, page } })).data as { pulls: Pull[]; has_next: boolean };
export const getPull = async (projectId: number, n: number) => (await api.get(`${base(projectId)}/pulls/${n}`)).data as PullDetail;
export const getPullFiles = async (projectId: number, n: number) => (await api.get(`${base(projectId)}/pulls/${n}/files`)).data as DiffFile[];
export const createPull = async (projectId: number, p: { title: string; body?: string; head: string; base?: string; draft?: boolean }) => (await api.post(`${base(projectId)}/pulls`, p)).data as Pull;
export const mergePull = async (projectId: number, n: number, method: string) => (await api.put(`${base(projectId)}/pulls/${n}/merge`, { method })).data as { merged: boolean; message: string };
export const updatePull = async (projectId: number, n: number, p: { state?: string; title?: string; body?: string }) => (await api.patch(`${base(projectId)}/pulls/${n}`, p)).data as Pull;
export const reviewPull = async (projectId: number, n: number, p: { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body?: string }) => (await api.post(`${base(projectId)}/pulls/${n}/reviews`, p)).data;
export const addComment = async (projectId: number, n: number, body: string) => (await api.post(`${base(projectId)}/issues/${n}/comments`, { body })).data as Comment;

export const listIssues = async (projectId: number, state: string, page = 1) => (await api.get(`${base(projectId)}/issues`, { params: { state, page } })).data as { issues: Issue[]; has_next: boolean };
export const getIssue = async (projectId: number, n: number) => (await api.get(`${base(projectId)}/issues/${n}`)).data as IssueDetail;
export const createIssue = async (projectId: number, p: { title: string; body?: string }) => (await api.post(`${base(projectId)}/issues`, p)).data as Issue;
export const updateIssue = async (projectId: number, n: number, p: { state?: string; title?: string; body?: string }) => (await api.patch(`${base(projectId)}/issues/${n}`, p)).data as Issue;

// ─── Actions ────────────────────────────────────────────────────────────────────

export const listRuns = async (projectId: number, q: { branch?: string; status?: string; page?: number }) => (await api.get(`${base(projectId)}/actions/runs`, { params: q })).data as { runs: Run[]; has_next: boolean };
export const getRunJobs = async (projectId: number, runId: number) => (await api.get(`${base(projectId)}/actions/runs/${runId}/jobs`)).data as Job[];
export const getJobLogs = async (projectId: number, jobId: number) => (await api.get(`${base(projectId)}/actions/jobs/${jobId}/logs`)).data as { truncated: boolean; text: string };
export const rerunRun = async (projectId: number, runId: number, failedOnly = false) => (await api.post(`${base(projectId)}/actions/runs/${runId}/rerun`, { failed_only: failedOnly })).data;
export const cancelRun = async (projectId: number, runId: number) => (await api.post(`${base(projectId)}/actions/runs/${runId}/cancel`)).data;
export const listWorkflows = async (projectId: number) => (await api.get(`${base(projectId)}/actions/workflows`)).data as Workflow[];
export const dispatchWorkflow = async (projectId: number, workflowId: number, ref: string) => (await api.post(`${base(projectId)}/actions/workflows/${workflowId}/dispatch`, { ref })).data;

/** Mensagem de erro amigável vinda do servidor. */
export function errMsg(err: any, fallback = "Algo deu errado. Tente novamente."): string {
  return err?.response?.data?.error || err?.message || fallback;
}

// ─── relatório de atualizações (IA + PDF) ───────────────────────────────────────

export interface UpdateReport {
  filename: string;
  markdown: string;
  pdf_base64: string;
  total_changes: number;
  truncated: boolean;
  provider: string;
  model: string;
}
export const generateReport = async (projectId: number, p: { since: string; until: string; branch?: string }) =>
  (await api.post(`${base(projectId)}/report`, p, { timeout: 5 * 60 * 1000 })).data as UpdateReport;
