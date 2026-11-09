const $ = (id) => document.getElementById(id);
async function refresh() {
  const { server, token, status, statusAt } = await chrome.storage.local.get(["server", "token", "status", "statusAt"]);
  if (server && !$("server").value) $("server").value = server;
  if (token && !$("token").value) $("token").placeholder = "(código salvo)";
  $("status").textContent = status ? `${status}${statusAt ? ` · ${new Date(statusAt).toLocaleTimeString()}` : ""}` : "Não configurada";
}
$("save").addEventListener("click", async () => {
  let server = $("server").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  if (!/^https?:\/\//.test(server)) { $("status").textContent = "Informe o endereço completo (https://…)."; return; }
  try {
    const origin = new URL(server).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`, "https://*/*"] });
    if (!granted) { $("status").textContent = "É preciso permitir o acesso ao servidor e ao Flow."; return; }
  } catch (e) { $("status").textContent = `Endereço inválido: ${e.message}`; return; }
  const patch = { server };
  if (token) patch.token = token;
  await chrome.storage.local.set(patch);
  $("token").value = "";
  chrome.runtime.sendMessage({ cmd: "kick" });
  $("status").textContent = "Conectando…";
});
refresh();
setInterval(refresh, 1500);
