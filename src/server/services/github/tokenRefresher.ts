import { refreshDueTokens } from "./account.service";

/**
 * Mantém os tokens do GitHub vivos mesmo sem uso: a cada 30 min renova os que vencem nas próximas 2 h.
 * Cada renovação troca também o refresh_token por um novo (~6 meses), então, com o servidor no ar, a conexão não expira.
 */
const INTERVAL_MS = 30 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startGithubTokenRefresher(): void {
  if (timer) return;
  const tick = () =>
    refreshDueTokens()
      .then((n) => n > 0 && console.log(`[github-token] ${n} token(s) renovado(s).`))
      .catch((err) => console.error("[github-token] Erro ao renovar tokens:", err instanceof Error ? err.message : err));
  setTimeout(tick, 60_000).unref(); // primeira passada logo depois do boot (cobre o tempo em que o servidor ficou desligado)
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  console.log(`[github-token] Renovador de tokens iniciado (a cada ${INTERVAL_MS / 60_000} min).`);
}
