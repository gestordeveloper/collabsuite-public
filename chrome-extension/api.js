// Cliente da API do CollabSuite, compartilhado entre o popup e o service worker.
// Sessão (URL do sistema + token JWT) fica em chrome.storage.local.

const DEFAULT_URL = "http://localhost:3000";

async function getSession() {
  const { baseUrl, token, user } = await chrome.storage.local.get(["baseUrl", "token", "user"]);
  return { baseUrl: baseUrl || DEFAULT_URL, token: token || null, user: user || null };
}

function normalizeBaseUrl(raw) {
  let url = (raw || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body, baseUrl, token } = {}) {
  const session = await getSession();
  const res = await fetch(`${baseUrl || session.baseUrl}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...((token || session.token) ? { Authorization: `Bearer ${token || session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !baseUrl) await chrome.storage.local.remove(["token", "user"]);
    throw new ApiError(data.error || `Erro ${res.status}`, res.status);
  }
  return data;
}

async function login(rawUrl, loginName, password) {
  const baseUrl = normalizeBaseUrl(rawUrl);
  const data = await request("/auth/login", { method: "POST", body: { login: loginName, password }, baseUrl });
  await chrome.storage.local.set({ baseUrl, token: data.token, user: data.user });
  return data.user;
}

async function logout() {
  await chrome.storage.local.remove(["token", "user"]);
}

function todayParts(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

// Tarefas de hoje em que o usuário é responsável ou participante (a API já restringe ao que ele pode ver).
async function fetchTodayTasks() {
  const { user } = await getSession();
  if (!user) throw new ApiError("Não autenticado.", 401);
  const { data } = await request(`/tasks?user_id=${user.id}&limit=1000`);
  const today = new Date().toDateString();
  return data
    .filter((t) => t.type !== "note" && t.due_at && new Date(t.due_at).toDateString() === today)
    .sort((a, b) => (a.hour_at || "99:99").localeCompare(b.hour_at || "99:99"));
}

// Projetos a que o usuário tem acesso, com funis/etapas e membros (para escolher o responsável).
async function fetchProjects() {
  return request("/projects");
}

async function createTask({ title, time, priority, type, funnelId, stageId, userId }) {
  const { user } = await getSession();
  const { date } = todayParts();
  return request("/tasks", {
    method: "POST",
    body: {
      title,
      type: type || "task",
      funnel_id: funnelId || null,
      stage_id: stageId || null,
      user_id: userId === undefined ? user.id : userId,
      due_at: date,
      hour_at: time || null,
      priority: priority || "none",
    },
  });
}

async function setTaskDone(id, done) {
  return request(`/tasks/${id}`, { method: "PUT", body: { status: done ? "done" : "notdone" } });
}
