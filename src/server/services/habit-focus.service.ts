import { prisma } from "../lib/prisma";
import { addDays, fmt, toDbDate, todayUtc } from "./habit.service";

/** "Foco do dia": até 3 prioridades escolhidas de manhã e a revisão da noite. Um registro por usuário/dia. */

export interface FocusItem {
  id: string;
  text: string;
  done: boolean;
  task_id?: number | null;
}

export interface FocusView {
  date: string;
  items: FocusItem[];
  review: string | null;
}

const MAX_ITEMS = 3;

function parseItems(raw: string | null | undefined): FocusItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitize(items: FocusItem[]): FocusItem[] {
  return items
    .map((i) => ({
      id: String(i.id || Math.random().toString(36).slice(2, 10)).slice(0, 40),
      text: String(i.text ?? "").trim().slice(0, 200),
      done: !!i.done,
      task_id: Number.isInteger(i.task_id) ? i.task_id : null,
    }))
    .filter((i) => i.text)
    .slice(0, MAX_ITEMS);
}

export async function getFocus(userId: number, day: string): Promise<FocusView> {
  const row = await prisma.dailyFocus.findUnique({ where: { user_id_focus_date: { user_id: userId, focus_date: toDbDate(day) } } });
  return { date: day, items: parseItems(row?.items), review: row?.review ?? null };
}

export async function saveFocus(userId: number, day: string, data: { items: FocusItem[]; review?: string | null }): Promise<FocusView> {
  // Tolera 1 dia à frente do relógio do servidor (fuso); além disso não faz sentido planejar.
  if (day > addDays(todayUtc(), 1)) throw new Error("Só é possível definir o foco de hoje ou de dias anteriores.");

  const items = sanitize(data.items);
  const review = data.review?.trim() ? data.review.trim().slice(0, 2000) : null;
  const key = { user_id_focus_date: { user_id: userId, focus_date: toDbDate(day) } };

  const row = await prisma.dailyFocus.upsert({
    where: key,
    create: { user_id: userId, focus_date: toDbDate(day), items: JSON.stringify(items), review },
    update: { items: JSON.stringify(items), review },
  });
  return { date: fmt(row.focus_date), items: parseItems(row.items), review: row.review };
}
