// Mantém no ícone da extensão o número de tarefas de hoje ainda pendentes.
importScripts("api.js");

const ALARM = "refresh-badge";

async function refreshBadge() {
  try {
    const { token } = await getSession();
    if (!token) return chrome.action.setBadgeText({ text: "" });
    const tasks = await fetchTodayTasks();
    const pending = tasks.filter((t) => t.status !== "done").length;
    await chrome.action.setBadgeBackgroundColor({ color: "#EC1889" });
    await chrome.action.setBadgeText({ text: pending ? String(pending) : "" });
  } catch {
    // Sem rede ou sessão expirada: mantém o último valor, o popup mostra o erro.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 15 });
  refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === ALARM && refreshBadge());
chrome.runtime.onMessage.addListener((msg) => msg?.type === "refresh-badge" && refreshBadge());
