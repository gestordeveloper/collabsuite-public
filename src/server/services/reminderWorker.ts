import { prisma } from "../lib/prisma";
import { notifyUsers } from "./notification.service";

/** In-process poller, same pattern as campaignWorker.ts — no job-queue library exists here. */
const POLL_INTERVAL_MS = 60000;
const REMINDER_LEAD_MINUTES = 15;

let timer: ReturnType<typeof setInterval> | null = null;

export function startReminderWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.error("[reminder-worker] Erro inesperado no ciclo do worker:", err));
  }, POLL_INTERVAL_MS);
  console.log(`[reminder-worker] Worker de lembretes de reunião iniciado (intervalo de ${POLL_INTERVAL_MS / 1000}s).`);
}

export function stopReminderWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60 * 1000);

  const dueMeetings = await prisma.task.findMany({
    where: {
      type: "meeting",
      deleted_at: null,
      status: { not: "done" },
      reminder_sent_at: null,
      due_at: { gte: now, lte: windowEnd },
    },
    include: {
      taskUsers: { select: { user_id: true } },
    },
  });

  for (const meeting of dueMeetings) {
    try {
      const recipientIds = [meeting.user_id, ...meeting.taskUsers.map((tu) => tu.user_id)].filter(
        (id): id is number => typeof id === "number"
      );

      if (recipientIds.length > 0) {
        await notifyUsers(recipientIds, {
          type: "meeting_reminder",
          title: `Reunião em breve: ${meeting.title || "Sem título"}`,
          body: meeting.hour_at ? `Começa às ${meeting.hour_at}.` : "Começa em instantes.",
          link: `/task/${meeting.id}`,
          metadata: { taskId: meeting.id },
        });
      }

      // Marked even with no recipients, so an unassigned meeting isn't re-checked every tick.
      await prisma.task.update({
        where: { id: meeting.id },
        data: { reminder_sent_at: new Date() },
      });
    } catch (err) {
      console.error(`[reminder-worker] Erro ao processar lembrete da reunião ${meeting.id}:`, err);
    }
  }
}
