/**
 * Repositório de um projeto: vínculo/criação e todas as operações do dia a dia (commits, branches,
 * arquivos, PRs, issues, Actions). Leitura usa o token de quem está logado ou, se a pessoa não
 * conectou o GitHub, o de quem vinculou o repositório; escrita exige a conta da própria pessoa.
 */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { gh, GITHUB_AUTH_STATUS, GithubAuthError } from "./api";
import { tokenFor, requireToken, noTokenError, markTokenError, refreshAccessToken, withUserToken } from "./account.service";

// ─── acesso ─────────────────────────────────────────────────────────────────────

const memberWhere = (userId: number) => ({ OR: [{ user_id: userId }, { projectUsers: { some: { user_id: userId } } }] });

export async function assertMember(userId: number, projectId: number) {
  if (!Number.isInteger(projectId)) throw new HttpError("Projeto inválido.");
  const project = await prisma.project.findFirst({ where: { id: projectId, ...memberWhere(userId) }, select: { id: true, name: true } });
  if (!project) throw new HttpError("Projeto não encontrado ou sem permissão de acesso.", 404);
  return project;
}

export interface RepoCtx {
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Pessoa cujo token foi usado (para marcar "reconectar" se o GitHub o recusar). */
  tokenUserId: number | null;
}

export async function context(userId: number, projectId: number, write = false): Promise<RepoCtx> {
  await assertMember(userId, projectId);
  const link = await prisma.projectRepo.findUnique({ where: { project_id: projectId } });
  if (!link) throw new HttpError("Este projeto ainda não tem um repositório vinculado.", 404);
  const own = await tokenFor(userId);
  if (write) {
    return { token: await requireToken(userId, own), owner: link.owner, repo: link.repo, defaultBranch: link.default_branch, tokenUserId: userId };
  }
  const fallbackToken = own ? null : await tokenFor(link.linked_by);
  const token = own ?? fallbackToken;
  if (!token) throw await noTokenError(own ? null : userId, "Conecte sua conta do GitHub para ver este repositório.");
  return { token, owner: link.owner, repo: link.repo, defaultBranch: link.default_branch, tokenUserId: own ? userId : link.linked_by };
}

const RECONNECT_MSG = "O acesso ao GitHub expirou ou foi revogado. Reconecte sua conta do GitHub.";

/**
 * Chamada ao repositório do contexto. Se o GitHub recusar o token (401), renova o token UMA vez e repete; só quando não
 * há como renovar a pessoa recebe o pedido para reconectar.
 */
async function call<T = any>(ctx: RepoCtx, method: string, path: string, opts: Parameters<typeof gh>[3] = {}) {
  const run = (token: string) => gh<T>(token, method, `/repos/${ctx.owner}/${ctx.repo}${path}`, opts);
  try {
    return await run(ctx.token);
  } catch (err) {
    if (!(err instanceof GithubAuthError) || !ctx.tokenUserId) throw err;
    const fresh = await refreshAccessToken(ctx.tokenUserId, { failedToken: ctx.token });
    if (!fresh || fresh === ctx.token) {
      await markTokenError(ctx.tokenUserId, RECONNECT_MSG);
      throw err;
    }
    ctx.token = fresh; // as próximas chamadas deste contexto já usam o token novo
    try {
      return await run(fresh);
    } catch (err2) {
      if (err2 instanceof GithubAuthError) await markTokenError(ctx.tokenUserId, RECONNECT_MSG);
      throw err2;
    }
  }
}

const seg = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const person = (u: any) => (u ? { login: u.login as string, avatar: (u.avatar_url as string) ?? null } : null);
const BRANCH_RE = /^(?!\/|.*(\.\.|\/\/|@\{|\\))[^\s~^:?*[]+(?<![/.]|\.lock)$/;

function assertBranchName(name: unknown): string {
  if (typeof name !== "string" || !BRANCH_RE.test(name) || name.length > 200) throw new HttpError("Nome de branch inválido (sem espaços nem caracteres como ~ ^ : ? * [).");
  return name;
}

// ─── vínculo / criação ──────────────────────────────────────────────────────────

export async function listRepos(userId: number, page = 1) {
  const { data, hasNext } = await withUserToken(userId, (token) => gh<any[]>(token, "GET", "/user/repos", {
    query: { sort: "updated", per_page: 100, page, affiliation: "owner,collaborator,organization_member" },
  }));
  return {
    repos: data.map((r) => ({ full_name: r.full_name as string, private: !!r.private, description: r.description ?? null, updated_at: r.pushed_at ?? r.updated_at, permissions: r.permissions ?? null })),
    has_next: hasNext,
  };
}

export async function listOrgs(userId: number) {
  const { data } = await withUserToken(userId, (token) => gh<any[]>(token, "GET", "/user/orgs", { query: { per_page: 100 } }));
  return data.map((o) => ({ login: o.login as string, avatar: o.avatar_url ?? null }));
}

async function saveLink(userId: number, projectId: number, r: any) {
  const data = { owner: r.owner.login as string, repo: r.name as string, default_branch: (r.default_branch as string) || "main", html_url: r.html_url as string, is_private: !!r.private, linked_by: userId };
  await prisma.projectRepo.upsert({ where: { project_id: projectId }, create: { project_id: projectId, ...data }, update: data });
}

export async function createRepo(userId: number, projectId: number, input: { name: string; description?: string; private?: boolean; org?: string }) {
  await assertMember(userId, projectId);
  if (await prisma.projectRepo.findUnique({ where: { project_id: projectId } })) throw new HttpError("Este projeto já tem um repositório vinculado.", 409);
  const name = (input.name || "").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new HttpError("Nome do repositório inválido: use letras, números, ponto, hífen ou sublinhado (sem espaços).");
  const org = input.org?.trim();
  if (org && !/^[A-Za-z0-9-]{1,39}$/.test(org)) throw new HttpError("Organização inválida.");
  const { data } = await withUserToken(userId, (token) => gh<any>(token, "POST", org ? `/orgs/${org}/repos` : "/user/repos", {
    // auto_init cria o README e a branch padrão: assim o repositório já abre navegável na CollabSuite.
    body: { name, description: input.description?.slice(0, 350) || undefined, private: input.private !== false, auto_init: true },
  }));
  await saveLink(userId, projectId, data);
  return getLink(userId, projectId);
}

export async function linkRepo(userId: number, projectId: number, fullName: string) {
  await assertMember(userId, projectId);
  const m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec((fullName || "").trim());
  if (!m) throw new HttpError("Informe o repositório no formato dono/nome.");
  const { data } = await withUserToken(userId, (token) => gh<any>(token, "GET", `/repos/${m[1]}/${m[2]}`));
  await saveLink(userId, projectId, data);
  return getLink(userId, projectId);
}

export async function unlinkRepo(userId: number, projectId: number) {
  await assertMember(userId, projectId);
  await prisma.projectRepo.deleteMany({ where: { project_id: projectId } });
  return { ok: true };
}

/** Vínculo do projeto + dados vivos do repositório (melhor esforço: o vínculo aparece mesmo se o GitHub falhar). */
export async function getLink(userId: number, projectId: number) {
  await assertMember(userId, projectId);
  const link = await prisma.projectRepo.findUnique({ where: { project_id: projectId } });
  if (!link) return { linked: false as const };
  const own = await tokenFor(userId);
  const base = {
    linked: true as const,
    owner: link.owner,
    repo: link.repo,
    full_name: `${link.owner}/${link.repo}`,
    default_branch: link.default_branch,
    html_url: link.html_url,
    is_private: link.is_private,
    can_write: !!own,
    info: null as null | { description: string | null; stars: number; forks: number; open_issues: number; language: string | null; pushed_at: string | null; permissions: any },
    info_error: null as string | null,
  };
  try {
    // Quem não conectou o GitHub lê com o token de quem vinculou o repositório (renovado quando preciso).
    const readerId = own ? userId : link.linked_by;
    if (!readerId || !(await tokenFor(readerId))) return { ...base, info_error: "Conecte sua conta do GitHub para ver o repositório." };
    const { data: r } = await withUserToken(readerId, (token) => gh<any>(token, "GET", `/repos/${link.owner}/${link.repo}`));
    if (r.default_branch && r.default_branch !== link.default_branch) {
      await prisma.projectRepo.update({ where: { project_id: projectId }, data: { default_branch: r.default_branch } });
      base.default_branch = r.default_branch;
    }
    return {
      ...base,
      info: { description: r.description ?? null, stars: r.stargazers_count ?? 0, forks: r.forks_count ?? 0, open_issues: r.open_issues_count ?? 0, language: r.language ?? null, pushed_at: r.pushed_at ?? null, permissions: r.permissions ?? null },
    };
  } catch (err: any) {
    return { ...base, info_error: err?.message || "Não foi possível consultar o GitHub." };
  }
}

// ─── commits ────────────────────────────────────────────────────────────────────

const shapeCommit = (c: any) => ({
  sha: c.sha as string,
  short: (c.sha as string).slice(0, 7),
  message: String(c.commit?.message ?? "").split("\n")[0],
  full_message: String(c.commit?.message ?? ""),
  author: { name: c.commit?.author?.name ?? c.author?.login ?? "?", login: c.author?.login ?? null, avatar: c.author?.avatar_url ?? null },
  date: c.commit?.author?.date ?? null,
  html_url: c.html_url as string,
});

export async function listCommits(ctx: RepoCtx, q: { sha?: string; path?: string; page?: number }) {
  const { data, hasNext } = await call<any[]>(ctx, "GET", "/commits", { query: { sha: q.sha, path: q.path, per_page: 30, page: q.page ?? 1 } });
  return { commits: data.map(shapeCommit), has_next: hasNext };
}

/** Commits de um período (para o relatório de atualizações): percorre as páginas até `max`. Ignora merges. */
export async function listCommitsInRange(ctx: RepoCtx, q: { since: string; until: string; sha?: string; max?: number }) {
  const max = q.max ?? 600;
  const out: { message: string; date: string | null; author: string }[] = [];
  let truncated = false;
  for (let pg = 1; pg <= 10; pg++) {
    const { data, hasNext } = await call<any[]>(ctx, "GET", "/commits", { query: { sha: q.sha, since: q.since, until: q.until, per_page: 100, page: pg } });
    for (const c of data) {
      if ((c.parents ?? []).length > 1) continue;
      out.push({ message: String(c.commit?.message ?? ""), date: c.commit?.author?.date ?? c.commit?.committer?.date ?? null, author: c.commit?.author?.name ?? "" });
    }
    if (!hasNext) break;
    if (out.length >= max || pg === 10) { truncated = hasNext; break; }
  }
  return { commits: out.slice(0, max), truncated };
}

export async function getCommit(ctx: RepoCtx, ref: string) {
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref)) throw new HttpError("Referência inválida.");
  const { data: c } = await call<any>(ctx, "GET", `/commits/${seg(ref)}`);
  return {
    ...shapeCommit(c),
    stats: c.stats ?? null,
    parents: (c.parents ?? []).map((p: any) => p.sha as string),
    files: (c.files ?? []).slice(0, 300).map(shapeFile),
  };
}

const MAX_PATCH = 60_000;
const shapeFile = (f: any) => ({
  filename: f.filename as string,
  previous_filename: f.previous_filename ?? null,
  status: f.status as string,
  additions: f.additions ?? 0,
  deletions: f.deletions ?? 0,
  patch: typeof f.patch === "string" ? (f.patch.length > MAX_PATCH ? f.patch.slice(0, MAX_PATCH) : f.patch) : null,
  patch_truncated: typeof f.patch === "string" && f.patch.length > MAX_PATCH,
});

// ─── branches ───────────────────────────────────────────────────────────────────

export async function listBranches(ctx: RepoCtx) {
  const { data } = await call<any[]>(ctx, "GET", "/branches", { query: { per_page: 100 } });
  return {
    default_branch: ctx.defaultBranch,
    branches: data.map((b) => ({ name: b.name as string, sha: b.commit?.sha as string, protected: !!b.protected })),
  };
}

export async function createBranch(ctx: RepoCtx, input: { name: string; from?: string }) {
  const name = assertBranchName(input.name);
  const from = assertBranchName(input.from || ctx.defaultBranch);
  const { data: ref } = await call<any>(ctx, "GET", `/git/ref/heads/${seg(from)}`);
  await call(ctx, "POST", "/git/refs", { body: { ref: `refs/heads/${name}`, sha: ref.object.sha } });
  return { name, sha: ref.object.sha as string };
}

export async function deleteBranch(ctx: RepoCtx, name: string) {
  assertBranchName(name);
  if (name === ctx.defaultBranch) throw new HttpError("A branch padrão não pode ser excluída.");
  await call(ctx, "DELETE", `/git/refs/heads/${seg(name)}`);
  return { ok: true };
}

// ─── arquivos ───────────────────────────────────────────────────────────────────

const MAX_INLINE = 1_000_000;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;

function assertPath(path: unknown): string {
  if (typeof path !== "string" || path.length > 500 || path.split("/").some((s) => s === ".." || s === "." ) || path.startsWith("/")) throw new HttpError("Caminho inválido.");
  return path;
}

export async function getContents(ctx: RepoCtx, q: { path?: string; ref?: string }) {
  const path = q.path ? assertPath(q.path) : "";
  const { data } = await call<any>(ctx, "GET", `/contents/${seg(path)}`, { query: { ref: q.ref || undefined } });
  if (Array.isArray(data)) {
    const entries = data
      .map((e) => ({ name: e.name as string, path: e.path as string, type: (e.type === "dir" ? "dir" : e.type === "file" ? "file" : "other") as "dir" | "file" | "other", size: e.size ?? 0, sha: e.sha as string }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return { type: "dir" as const, path, entries };
  }
  if (data.type !== "file") return { type: "other" as const, path, name: data.name as string };

  const size = data.size ?? 0;
  const base = { type: "file" as const, path: data.path as string, name: data.name as string, sha: data.sha as string, size, html_url: data.html_url as string, download_url: (data.download_url as string) ?? null };
  if (size > MAX_INLINE || !data.content) return { ...base, content: null, base64: null, binary: false, too_large: size > MAX_INLINE };

  const buf = Buffer.from(String(data.content).replace(/\n/g, ""), "base64");
  const binary = buf.subarray(0, 8000).includes(0);
  if (binary || IMAGE_RE.test(base.name)) {
    return { ...base, content: IMAGE_RE.test(base.name) && base.name.toLowerCase().endsWith(".svg") ? buf.toString("utf8") : null, base64: IMAGE_RE.test(base.name) ? buf.toString("base64") : null, binary: true, too_large: false };
  }
  return { ...base, content: buf.toString("utf8"), base64: null, binary: false, too_large: false };
}

export async function putFile(ctx: RepoCtx, input: { path: string; content: string; message: string; branch: string; sha?: string }) {
  const path = assertPath(input.path);
  if (!path) throw new HttpError("Informe o caminho do arquivo.");
  const branch = assertBranchName(input.branch);
  const message = (input.message || "").trim();
  if (!message) throw new HttpError("Escreva a mensagem do commit.");
  if (typeof input.content !== "string" || Buffer.byteLength(input.content) > 5_000_000) throw new HttpError("Conteúdo inválido ou grande demais (máx. 5 MB).");
  const { data } = await call<any>(ctx, "PUT", `/contents/${seg(path)}`, {
    body: { message: message.slice(0, 500), content: Buffer.from(input.content, "utf8").toString("base64"), branch, ...(input.sha ? { sha: input.sha } : {}) },
  });
  return { commit: shapeCommit(data.commit), sha: data.content?.sha as string, path };
}

export async function deleteFile(ctx: RepoCtx, input: { path: string; message: string; branch: string; sha: string }) {
  const path = assertPath(input.path);
  const branch = assertBranchName(input.branch);
  if (!input.sha) throw new HttpError("Informe o sha do arquivo.");
  if (!(input.message || "").trim()) throw new HttpError("Escreva a mensagem do commit.");
  const { data } = await call<any>(ctx, "DELETE", `/contents/${seg(path)}`, { body: { message: input.message.trim().slice(0, 500), sha: input.sha, branch } });
  return { commit: shapeCommit(data.commit) };
}

// ─── pull requests ──────────────────────────────────────────────────────────────

const shapePull = (p: any) => ({
  number: p.number as number,
  title: p.title as string,
  state: p.state as "open" | "closed",
  draft: !!p.draft,
  merged: !!p.merged_at || !!p.merged,
  user: person(p.user),
  head: { ref: p.head?.ref as string, sha: p.head?.sha as string },
  base: { ref: p.base?.ref as string },
  created_at: p.created_at as string,
  updated_at: p.updated_at as string,
  comments: p.comments ?? 0,
  labels: (p.labels ?? []).map((l: any) => ({ name: l.name as string, color: l.color as string })),
  html_url: p.html_url as string,
});

const shapeComment = (c: any) => ({ id: c.id as number, user: person(c.user), body: String(c.body ?? ""), created_at: c.created_at as string });
const stateOf = (s: unknown) => (s === "closed" || s === "all" ? (s as string) : "open");

export async function listPulls(ctx: RepoCtx, q: { state?: string; page?: number }) {
  const { data, hasNext } = await call<any[]>(ctx, "GET", "/pulls", { query: { state: stateOf(q.state), per_page: 30, page: q.page ?? 1, sort: "updated", direction: "desc" } });
  return { pulls: data.map(shapePull), has_next: hasNext };
}

export async function getPull(ctx: RepoCtx, n: number) {
  const [pull, comments, reviews] = await Promise.all([
    call<any>(ctx, "GET", `/pulls/${n}`),
    call<any[]>(ctx, "GET", `/issues/${n}/comments`, { query: { per_page: 100 } }),
    call<any[]>(ctx, "GET", `/pulls/${n}/reviews`, { query: { per_page: 100 } }),
  ]);
  const p = pull.data;
  return {
    ...shapePull(p),
    body: String(p.body ?? ""),
    mergeable: p.mergeable ?? null,
    mergeable_state: p.mergeable_state ?? null,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    changed_files: p.changed_files ?? 0,
    commits: p.commits ?? 0,
    merged_by: person(p.merged_by),
    comment_list: comments.data.map(shapeComment),
    reviews: reviews.data.filter((r) => r.state !== "PENDING").map((r) => ({ id: r.id as number, user: person(r.user), state: r.state as string, body: String(r.body ?? ""), submitted_at: r.submitted_at as string })),
  };
}

export async function getPullFiles(ctx: RepoCtx, n: number) {
  const { data } = await call<any[]>(ctx, "GET", `/pulls/${n}/files`, { query: { per_page: 100 } });
  return data.map(shapeFile);
}

export async function createPull(ctx: RepoCtx, input: { title: string; body?: string; head: string; base?: string; draft?: boolean }) {
  const title = (input.title || "").trim();
  if (!title) throw new HttpError("Informe o título do pull request.");
  const head = assertBranchName(input.head);
  const base = assertBranchName(input.base || ctx.defaultBranch);
  const { data } = await call<any>(ctx, "POST", "/pulls", { body: { title: title.slice(0, 250), body: input.body?.slice(0, 60_000) || undefined, head, base, draft: !!input.draft } });
  return shapePull(data);
}

export async function mergePull(ctx: RepoCtx, n: number, input: { method?: string; title?: string }) {
  const method = ["merge", "squash", "rebase"].includes(input.method ?? "") ? input.method : "merge";
  const { data } = await call<any>(ctx, "PUT", `/pulls/${n}/merge`, { body: { merge_method: method, ...(input.title ? { commit_title: input.title.slice(0, 250) } : {}) } });
  return { merged: !!data?.merged, message: data?.message as string, sha: data?.sha as string };
}

export async function updatePull(ctx: RepoCtx, n: number, input: { state?: string; title?: string; body?: string }) {
  const body: Record<string, unknown> = {};
  if (input.state === "open" || input.state === "closed") body.state = input.state;
  if (typeof input.title === "string" && input.title.trim()) body.title = input.title.trim().slice(0, 250);
  if (typeof input.body === "string") body.body = input.body.slice(0, 60_000);
  const { data } = await call<any>(ctx, "PATCH", `/pulls/${n}`, { body });
  return shapePull(data);
}

export async function reviewPull(ctx: RepoCtx, n: number, input: { event: string; body?: string }) {
  const event = ["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(input.event) ? input.event : null;
  if (!event) throw new HttpError("Tipo de revisão inválido.");
  if (event !== "APPROVE" && !(input.body || "").trim()) throw new HttpError("Escreva um comentário para esta revisão.");
  await call(ctx, "POST", `/pulls/${n}/reviews`, { body: { event, body: input.body?.slice(0, 60_000) || undefined } });
  return { ok: true };
}

/** Comentário em PR ou issue (no GitHub os dois usam a mesma API). */
export async function addComment(ctx: RepoCtx, n: number, body: string) {
  if (!(body || "").trim()) throw new HttpError("Escreva o comentário.");
  const { data } = await call<any>(ctx, "POST", `/issues/${n}/comments`, { body: { body: body.slice(0, 60_000) } });
  return shapeComment(data);
}

// ─── issues ─────────────────────────────────────────────────────────────────────

const shapeIssue = (i: any) => ({
  number: i.number as number,
  title: i.title as string,
  state: i.state as "open" | "closed",
  user: person(i.user),
  created_at: i.created_at as string,
  updated_at: i.updated_at as string,
  comments: i.comments ?? 0,
  labels: (i.labels ?? []).map((l: any) => ({ name: l.name as string, color: l.color as string })),
  html_url: i.html_url as string,
});

export async function listIssues(ctx: RepoCtx, q: { state?: string; page?: number }) {
  const { data, hasNext } = await call<any[]>(ctx, "GET", "/issues", { query: { state: stateOf(q.state), per_page: 30, page: q.page ?? 1, sort: "updated", direction: "desc" } });
  // A API de issues também devolve PRs; a aba de PRs cuida deles.
  return { issues: data.filter((i) => !i.pull_request).map(shapeIssue), has_next: hasNext };
}

export async function getIssue(ctx: RepoCtx, n: number) {
  const [issue, comments] = await Promise.all([call<any>(ctx, "GET", `/issues/${n}`), call<any[]>(ctx, "GET", `/issues/${n}/comments`, { query: { per_page: 100 } })]);
  return { ...shapeIssue(issue.data), body: String(issue.data.body ?? ""), comment_list: comments.data.map(shapeComment) };
}

export async function createIssue(ctx: RepoCtx, input: { title: string; body?: string }) {
  const title = (input.title || "").trim();
  if (!title) throw new HttpError("Informe o título da issue.");
  const { data } = await call<any>(ctx, "POST", "/issues", { body: { title: title.slice(0, 250), body: input.body?.slice(0, 60_000) || undefined } });
  return shapeIssue(data);
}

export async function updateIssue(ctx: RepoCtx, n: number, input: { state?: string; title?: string; body?: string }) {
  const body: Record<string, unknown> = {};
  if (input.state === "open" || input.state === "closed") body.state = input.state;
  if (typeof input.title === "string" && input.title.trim()) body.title = input.title.trim().slice(0, 250);
  if (typeof input.body === "string") body.body = input.body.slice(0, 60_000);
  const { data } = await call<any>(ctx, "PATCH", `/issues/${n}`, { body });
  return shapeIssue(data);
}

// ─── Actions ────────────────────────────────────────────────────────────────────

const shapeRun = (r: any) => ({
  id: r.id as number,
  name: (r.name as string) ?? "",
  title: (r.display_title as string) ?? (r.name as string) ?? "",
  run_number: r.run_number as number,
  attempt: r.run_attempt ?? 1,
  event: r.event as string,
  status: r.status as string,
  conclusion: (r.conclusion as string) ?? null,
  branch: r.head_branch as string,
  sha: String(r.head_sha ?? "").slice(0, 7),
  actor: person(r.actor),
  workflow_id: r.workflow_id as number,
  created_at: r.created_at as string,
  updated_at: r.updated_at as string,
  html_url: r.html_url as string,
});

export async function listRuns(ctx: RepoCtx, q: { branch?: string; status?: string; page?: number }) {
  const status = ["queued", "in_progress", "completed", "success", "failure", "cancelled"].includes(q.status ?? "") ? q.status : undefined;
  const { data, hasNext } = await call<any>(ctx, "GET", "/actions/runs", { query: { branch: q.branch, status, per_page: 30, page: q.page ?? 1 } });
  return { runs: (data.workflow_runs ?? []).map(shapeRun), has_next: hasNext };
}

export async function getRunJobs(ctx: RepoCtx, runId: number) {
  const { data } = await call<any>(ctx, "GET", `/actions/runs/${runId}/jobs`, { query: { per_page: 100 } });
  return (data.jobs ?? []).map((j: any) => ({
    id: j.id as number,
    name: j.name as string,
    status: j.status as string,
    conclusion: (j.conclusion as string) ?? null,
    started_at: j.started_at ?? null,
    completed_at: j.completed_at ?? null,
    steps: (j.steps ?? []).map((s: any) => ({ number: s.number as number, name: s.name as string, status: s.status as string, conclusion: (s.conclusion as string) ?? null })),
  }));
}

const MAX_LOG = 300_000;

export async function getJobLogs(ctx: RepoCtx, jobId: number) {
  const { data } = await call<string>(ctx, "GET", `/actions/jobs/${jobId}/logs`, { text: true });
  const text = String(data ?? "");
  // Fica com o final do log (onde costuma estar o erro) e sem códigos de cor ANSI.
  const tail = text.length > MAX_LOG ? text.slice(-MAX_LOG) : text;
  return { truncated: text.length > MAX_LOG, text: tail.replace(/\u001b\[[0-9;]*m/g, "") };
}

export async function rerunRun(ctx: RepoCtx, runId: number, failedOnly: boolean) {
  await call(ctx, "POST", `/actions/runs/${runId}/${failedOnly ? "rerun-failed-jobs" : "rerun"}`);
  return { ok: true };
}

export async function cancelRun(ctx: RepoCtx, runId: number) {
  await call(ctx, "POST", `/actions/runs/${runId}/cancel`);
  return { ok: true };
}

export async function listWorkflows(ctx: RepoCtx) {
  const { data } = await call<any>(ctx, "GET", "/actions/workflows", { query: { per_page: 100 } });
  return (data.workflows ?? []).map((w: any) => ({ id: w.id as number, name: w.name as string, path: w.path as string, state: w.state as string }));
}

export async function dispatchWorkflow(ctx: RepoCtx, workflowId: number, input: { ref?: string; inputs?: Record<string, string> }) {
  const ref = assertBranchName(input.ref || ctx.defaultBranch);
  await call(ctx, "POST", `/actions/workflows/${workflowId}/dispatches`, { body: { ref, ...(input.inputs ? { inputs: input.inputs } : {}) } });
  return { ok: true };
}
