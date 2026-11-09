import "dotenv/config";
import http from "http";
import path from "path";
import express from "express";
import { createApp } from "./app";
import { initSocket } from "./lib/socket";
import { seedDatabase } from "./services/seed.service";
import { startCampaignWorker } from "./services/whatsapp/campaignWorker";
import { startReminderWorker } from "./services/reminderWorker";
import { startHabitReminderWorker } from "./services/habitReminderWorker";
import { startTelegramService } from "./services/agent-telegram/telegram.service";
import { startTicketServices } from "./services/tickets/boot";
import { startInstagramWorker } from "./services/instagram/worker";
import { startSocialWorker } from "./services/social/worker";
import { sweepStuckRuns } from "./services/agent-run.service";
import { sweepStuckRecordings } from "./services/recording.service";
import { sweepStuckSessions as sweepStuckSshSessions } from "./services/ssh/session.service";
import { startGithubTokenRefresher } from "./services/github/tokenRefresher";
import { createServer as createViteServer } from "vite";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware";

async function startServer() {
  await seedDatabase();

  const app = createApp();
  const server = http.createServer(app);

  initSocket(server);
  startCampaignWorker();
  startReminderWorker();
  startHabitReminderWorker();
  void startTicketServices();
  void startInstagramWorker();
  void startSocialWorker();
  void startTelegramService().catch((err) => console.error("[telegram] Falha ao iniciar:", err));
  startGithubTokenRefresher();
  await sweepStuckRuns();
  await sweepStuckRecordings();
  await sweepStuckSshSessions();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler as any);

  const PORT = parseInt(process.env.PORT || "3000");
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[CollabSuite Server] Running on http://localhost:${PORT}`);
  });
}

startServer();