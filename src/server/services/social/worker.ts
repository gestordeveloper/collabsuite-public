import { runDuePosts, sweepStuckPosts } from "./post.service";
import { refreshStaleAccounts } from "./account.service";

/** Poller em processo (mesmo padrão do worker do Instagram): publica vídeos vencidos e mantém os tokens vivos. */
const POLL_INTERVAL_MS = 60_000;
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastRefresh = 0;

async function tick() {
  if (running) return; // um upload longo não pode empilhar ciclos
  running = true;
  try {
    await runDuePosts();
    if (Date.now() - lastRefresh > REFRESH_EVERY_MS) {
      lastRefresh = Date.now();
      await refreshStaleAccounts();
    }
  } finally {
    running = false;
  }
}

export async function startSocialWorker(): Promise<void> {
  if (timer) return;
  await sweepStuckPosts();
  timer = setInterval(() => {
    tick().catch((err) => console.error("[social-worker] Erro inesperado no ciclo:", err));
  }, POLL_INTERVAL_MS);
  console.log(`[social-worker] Publicador de YouTube/TikTok iniciado (intervalo de ${POLL_INTERVAL_MS / 1000}s).`);
}
