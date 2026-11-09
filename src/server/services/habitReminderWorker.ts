import { prisma } from "../lib/prisma";
import { notifyUser } from "./notification.service";
import { addDays, fmt, parseChecklist, parseDays, toDbDate, weekStart } from "./habit.service";
import { buildWeeklySummary } from "./habit-summary.service";

/**
 * Lembretes de hábito/rotina no horário combinado e resumo semanal (segunda-feira de manhã).
 * Mesmo padrão do reminderWorker.ts: poller em processo, sem fila. Todos os horários são de
 * Brasília (UTC-3 fixo, como no restante do app).
 */

const POLL_INTERVAL_MS = 60_000;
const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Se o servidor ficou fora do ar, ainda avisa até 1h depois do horário; além disso o aviso perdeu o sentido. */
const REMINDER_GRACE_MINUTES = 60;
const WEEKLY_SUMMARY_FROM = "08:00";
const WEEKLY_SUMMARY_UNTIL = "11:00";

let timer: ReturnType<typeof setInterval> | null = null;

export function startHabitReminderWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.error("[habit-worker] Erro inesperado no ciclo do worker:", err));
  }, POLL_INTERVAL_MS);
  console.log(`[habit-worker] Worker de lembretes de hábitos iniciado (intervalo de ${POLL_INTERVAL_MS / 1000}s).`);
}

export function stopHabitReminderWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Relógio de Brasília como um Date cujos campos UTC são a hora local. */
function brtClock(now: Date = new Date()) {
  const local = new Date(now.getTime() - BRAZIL_OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return { day: fmt(local), time: `${hh}:${mm}`, weekday: local.getUTCDay(), local };
}

function minusMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function tick(): Promise<void> {
  const now = brtClock();
  await sendHabitReminders(now);
  await sendWeeklySummaries(now);
}

async function sendHabitReminders(now: ReturnType<typeof brtClock>) {
  const due = await prisma.habit.findMany({
    where: {
      archived_at: null,
      reminder_time: { not: null, lte: now.time, gte: minusMinutes(now.time, REMINDER_GRACE_MINUTES) },
      OR: [{ last_reminded_on: null }, { last_reminded_on: { lt: toDbDate(now.day) } }],
    },
    select: { id: true, user_id: true, name: true, description: true, kind: true, checklist: true, reminder_days: true, reminder_time: true },
  });
  if (due.length === 0) return;

  const doneToday = new Set(
    (await prisma.habitLog.findMany({ where: { habit_id: { in: due.map((h) => h.id) }, log_date: toDbDate(now.day) }, select: { habit_id: true } })).map((l) => l.habit_id)
  );

  for (const habit of due) {
    try {
      const days = parseDays(habit.reminder_days);
      if (days && !days.includes(now.weekday)) continue; // hoje não é dia de lembrete

      if (!doneToday.has(habit.id)) {
        const steps = parseChecklist(habit.checklist);
        const isRoutine = habit.kind === "routine";
        await notifyUser(habit.user_id, {
          type: "habit_reminder",
          title: `${isRoutine ? "Hora da rotina" : "Hora do hábito"}: ${habit.name}`,
          body: steps.length ? `Passos: ${steps.slice(0, 4).join(" · ")}${steps.length > 4 ? "…" : ""}` : habit.description || "Marque quando concluir.",
          link: "/habitos",
          metadata: { habitId: habit.id },
        });
      }
      // Marcado mesmo se já cumprido, para não reavaliar a cada minuto durante a janela.
      await prisma.habit.update({ where: { id: habit.id }, data: { last_reminded_on: toDbDate(now.day) } });
    } catch (err) {
      console.error(`[habit-worker] Erro ao lembrar o hábito ${habit.id}:`, err);
    }
  }
}

/** Segunda-feira, entre 08:00 e 11:00: resumo da semana que terminou. Uma vez por usuário por dia. */
async function sendWeeklySummaries(now: ReturnType<typeof brtClock>) {
  if (now.weekday !== 1 || now.time < WEEKLY_SUMMARY_FROM || now.time >= WEEKLY_SUMMARY_UNTIL) return;

  const users = await prisma.habit.findMany({ where: { archived_at: null }, select: { user_id: true }, distinct: ["user_id"] });
  if (users.length === 0) return;

  const dayStartUtc = new Date(toDbDate(now.day).getTime() + BRAZIL_OFFSET_MS);
  const alreadySent = new Set(
    (
      await prisma.notification.findMany({
        where: { type: "weekly_summary", created_at: { gte: dayStartUtc }, user_id: { in: users.map((u) => u.user_id) } },
        select: { user_id: true },
      })
    ).map((n) => n.user_id)
  );

  const lastWeekStart = addDays(weekStart(now.day), -7);
  for (const { user_id } of users) {
    if (alreadySent.has(user_id)) continue;
    try {
      const summary = await buildWeeklySummary(user_id, lastWeekStart, now.day);
      await notifyUser(user_id, {
        type: "weekly_summary",
        title: "Seu resumo da semana está pronto",
        body: summary.highlights.slice(0, 3).join(" "),
        link: "/habitos?aba=resumo",
        metadata: { weekStart: lastWeekStart },
      });
    } catch (err) {
      console.error(`[habit-worker] Erro ao enviar resumo semanal do usuário ${user_id}:`, err);
    }
  }
}
