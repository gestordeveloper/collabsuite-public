import { prisma } from "../../lib/prisma";
import { runDuePosts, sweepStuckPosts } from "./post.service";
import { refreshAccount } from "./account.service";
import { getConfig } from "./config.service";

/** Poller em processo (mesmo padrão do reminderWorker): publica posts vencidos e renova tokens. */
const POLL_INTERVAL_MS = 60_000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastRefreshCheck = 0;

async function tick() {
  if (running) return; // uma publicação longa (vídeo) não pode empilhar ciclos
  running = true;
  try {
    await runDuePosts();
    if (Date.now() - lastRefreshCheck > 6 * 60 * 60 * 1000) {
      lastRefreshCheck = Date.now();
      const stale = await prisma.instagramAccount.findMany({
        where: { connected: true, user_token: { not: null }, OR: [{ refreshed_at: null }, { refreshed_at: { lt: new Date(Date.now() - REFRESH_AFTER_MS) } }] },
        select: { id: true },
      });
      for (const a of stale) await refreshAccount(a.id);
    }
  } finally {
    running = false;
  }
}

export async function startInstagramWorker(): Promise<void> {
  if (timer) return;
  await getConfig().catch(() => {}); // aquece a URL pública usada nas mídias
  await sweepStuckPosts();
  timer = setInterval(() => {
    tick().catch((err) => console.error("[instagram-worker] Erro inesperado no ciclo:", err));
  }, POLL_INTERVAL_MS);
  console.log(`[instagram-worker] Publicador de posts agendados iniciado (intervalo de ${POLL_INTERVAL_MS / 1000}s).`);
}
