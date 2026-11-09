const $ = (id) => document.getElementById(id);

let projects = [];
let funnelProject = new Map(); // funnel_id -> projeto (para mostrar o projeto de cada tarefa)

const loginView = $("login-view");
const tasksView = $("tasks-view");

function showError(el, message) {
  el.textContent = message || "";
  el.hidden = !message;
}

async function showLogin() {
  const { baseUrl } = await getSession();
  $("login-url").value = baseUrl;
  loginView.hidden = false;
  tasksView.hidden = true;
}

let session = null;

async function showTasks() {
  session = await getSession();
  loginView.hidden = true;
  tasksView.hidden = false;
  $("today-label").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  await loadProjects();
  await loadTasks();
}

function renderTasks(tasks) {
  const list = $("task-list");
  list.replaceChildren();
  $("empty").hidden = tasks.length > 0;

  // Pendentes primeiro, concluídas no fim (mantendo a ordem por horário dentro de cada grupo).
  const ordered = [...tasks].sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  for (const t of ordered) {
    const li = document.createElement("li");
    li.className = `task p-${t.priority || "none"}${t.status === "done" ? " done" : ""}`;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = t.status === "done";
    check.setAttribute("aria-label", "Concluir tarefa");
    check.addEventListener("change", async () => {
      check.disabled = true;
      try {
        await setTaskDone(t.id, check.checked);
        chrome.runtime.sendMessage({ type: "refresh-badge" });
        await loadTasks();
      } catch (err) {
        check.checked = !check.checked;
        check.disabled = false;
        showError($("list-error"), err.message);
      }
    });

    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t.title || "Sem título";
    title.title = "Abrir no sistema";
    title.addEventListener("click", async () => {
      const { baseUrl } = await getSession();
      chrome.tabs.create({ url: `${baseUrl}/task/${t.id}` });
    });
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = t.hour_at || "Dia inteiro";
    const projectName = funnelProject.get(t.funnel_id)?.name;
    if (projectName) {
      const tag = document.createElement("span");
      tag.className = "project";
      tag.textContent = projectName;
      time.append(tag);
    }
    body.append(title, time);

    li.append(check, body);
    list.append(li);
  }

  const pending = tasks.filter((t) => t.status !== "done").length;
  $("summary").textContent = tasks.length ? `${pending} pendente${pending === 1 ? "" : "s"} de ${tasks.length}` : "";
}

function personName(u) {
  return `${u.first_name} ${u.last_name || ""}`.trim();
}

function fillSelect(select, options, selected) {
  select.replaceChildren(...options.map(({ value, label }) => new Option(label, value, false, String(value) === String(selected))));
}

function refreshAssignee(preferred) {
  const { user } = session;
  const project = projects.find((p) => String(p.id) === $("add-project").value);
  const options = [{ value: user.id, label: "Eu" }];
  if (project) {
    for (const pu of project.projectUsers || []) {
      if (pu.user && pu.user.id !== user.id) options.push({ value: pu.user.id, label: personName(pu.user) });
    }
    options.push({ value: "", label: "Sem responsável" });
  }
  fillSelect($("add-assignee"), options, preferred ?? user.id);
}

function refreshFunnels() {
  const project = projects.find((p) => String(p.id) === $("add-project").value);
  const funnels = project?.funnels || [];
  const funnelSelect = $("add-funnel");
  funnelSelect.hidden = funnels.length < 2;
  const def = funnels.find((f) => f.is_default) || funnels[0];
  fillSelect(funnelSelect, funnels.map((f) => ({ value: f.id, label: f.name || "Funil" })), def?.id);
  refreshStages();
}

// Etapas do funil escolhido (já ordenadas pela API); a primeira vem selecionada.
function refreshStages() {
  const project = projects.find((p) => String(p.id) === $("add-project").value);
  const funnel = project?.funnels.find((f) => String(f.id) === $("add-funnel").value);
  const stages = funnel?.stages || [];
  const stageSelect = $("add-stage");
  stageSelect.hidden = stages.length === 0;
  fillSelect(stageSelect, stages.map((s) => ({ value: s.id, label: s.name || "Etapa" })), stages[0]?.id);
}

async function loadProjects() {
  try {
    projects = await fetchProjects();
  } catch {
    projects = [];
  }
  funnelProject = new Map();
  for (const p of projects) for (const f of p.funnels || []) funnelProject.set(f.id, p);
  const { lastProjectId } = await chrome.storage.local.get("lastProjectId");
  fillSelect(
    $("add-project"),
    [{ value: "", label: "Sem projeto (tarefa pessoal)" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    projects.some((p) => p.id === lastProjectId) ? lastProjectId : "",
  );
  refreshFunnels();
  refreshAssignee();
}

async function loadTasks() {
  showError($("list-error"), "");
  try {
    renderTasks(await fetchTodayTasks());
  } catch (err) {
    if (err.status === 401) return showLogin();
    showError($("list-error"), err.message === "Failed to fetch" ? "Não foi possível conectar ao sistema." : err.message);
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = $("login-submit");
  showError($("login-error"), "");
  submit.disabled = true;
  try {
    const url = normalizeBaseUrl($("login-url").value);
    // Pede permissão só para o endereço informado (necessário quando o servidor restringe CORS).
    await chrome.permissions.request({ origins: [`${url}/*`] }).catch(() => {});
    await login(url, $("login-user").value.trim(), $("login-pass").value);
    $("login-pass").value = "";
    chrome.runtime.sendMessage({ type: "refresh-badge" });
    await showTasks();
  } catch (err) {
    showError($("login-error"), err.message === "Failed to fetch" ? "Não foi possível conectar ao endereço informado." : err.message);
  } finally {
    submit.disabled = false;
  }
});

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("add-title").value.trim();
  if (!title) return;
  const submit = $("add-submit");
  showError($("add-error"), "");
  submit.disabled = true;
  try {
    const projectId = $("add-project").value ? Number($("add-project").value) : null;
    const funnel = projectId
      ? projects.find((p) => p.id === projectId)?.funnels.find((f) => String(f.id) === $("add-funnel").value)
      : null;
    const stageId = funnel ? Number($("add-stage").value) || funnel.stages?.[0]?.id : null;
    await createTask({
      title,
      time: $("add-time").value,
      priority: $("add-priority").value,
      type: $("add-type").value,
      funnelId: funnel?.id,
      stageId,
      userId: $("add-assignee").value ? Number($("add-assignee").value) : null,
    });
    chrome.storage.local.set({ lastProjectId: projectId });
    $("add-title").value = "";
    $("add-time").value = "";
    chrome.runtime.sendMessage({ type: "refresh-badge" });
    await loadTasks();
  } catch (err) {
    showError($("add-error"), err.message);
  } finally {
    submit.disabled = false;
    $("add-title").focus();
  }
});

$("add-funnel").addEventListener("change", refreshStages);
$("add-project").addEventListener("change", () => {
  refreshFunnels();
  refreshAssignee();
});
$("refresh").addEventListener("click", () => Promise.all([loadProjects(), loadTasks()]));
$("open-app").addEventListener("click", async () => {
  const { baseUrl } = await getSession();
  chrome.tabs.create({ url: baseUrl });
});
$("logout").addEventListener("click", async () => {
  await logout();
  chrome.runtime.sendMessage({ type: "refresh-badge" });
  showLogin();
});

(async () => {
  const { token } = await getSession();
  if (token) await showTasks();
  else await showLogin();
})();
