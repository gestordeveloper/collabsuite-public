import api from "./api";

export interface Habit {
  id: number;
  name: string;
  description: string | null;
  color: string;
  target_per_week: number;
  created_at: string;
  /** Sequência atual: dias (hábito diário) ou semanas (hábito "N vezes por semana"). */
  streak: number;
  best_streak: number;
  streak_unit: "days" | "weeks";
  /** Percentual de cumprimento nos últimos 30 dias. */
  rate_30: number;
  /** Dias cumpridos (YYYY-MM-DD, ordem crescente) nos últimos ~200 dias. */
  logs: string[];
  /** "routine" = rotina de trabalho (com passos). */
  kind: HabitKind;
  project_id: number | null;
  project: { id: number; name: string; color: string | null } | null;
  /** HH:MM (horário de Brasília). */
  reminder_time: string | null;
  /** 0 = domingo … 6 = sábado; null = todos os dias. */
  reminder_days: number[] | null;
  checklist: string[];
  /** Meta de Saúde que marca este hábito sozinha quando batida. */
  health_metric: HealthMetric | null;
  /** Preenchido quando o hábito foi atribuído por um gestor (somente leitura para quem recebeu). */
  team: { id: number; creator_name: string } | null;
}

export type HabitKind = "habit" | "routine";
export type HealthMetric = "steps" | "water" | "sleep" | "workout";

export interface HabitPayload {
  name: string;
  description?: string | null;
  color?: string;
  target_per_week?: number;
  kind?: HabitKind;
  project_id?: number | null;
  reminder_time?: string | null;
  reminder_days?: number[] | null;
  checklist?: string[] | null;
  health_metric?: HealthMetric | null;
}

export interface TeamHabitPayload extends HabitPayload {
  assignee_ids: number[];
}

export interface TeamCandidate {
  id: number;
  first_name: string;
  last_name: string | null;
  photo: string | null;
  email: string;
}

export interface TeamBoardMember {
  user: { id: number; name: string; photo: string | null };
  habit_id: number;
  done_today: boolean;
  week_done: number;
  rate_30: number;
  streak: number;
  streak_unit: "days" | "weeks";
  recent: string[];
  last_done: string | null;
}

export interface TeamBoardHabit {
  id: number;
  name: string;
  description: string | null;
  color: string;
  kind: HabitKind;
  target_per_week: number;
  project: { id: number; name: string; color: string | null } | null;
  reminder_time: string | null;
  reminder_days: number[] | null;
  checklist: string[];
  members: TeamBoardMember[];
  summary: { total: number; done_today: number; avg_rate_30: number };
}

export interface FocusItem {
  id: string;
  text: string;
  done: boolean;
  task_id?: number | null;
}

export interface DailyFocus {
  date: string;
  items: FocusItem[];
  review: string | null;
}

export interface WeeklySummary {
  week_start: string;
  week_end: string;
  in_progress: boolean;
  habits: {
    overall_pct: number;
    previous_pct: number | null;
    items: { id: number; name: string; color: string; done: number; target: number; pct: number; streak_hint: boolean }[];
  };
  tasks: {
    completed: number;
    completed_titles: { id: number; title: string }[];
    overdue: number;
    overdue_list: { id: number; title: string; due_at: string }[];
    due_next_7_days: number;
  };
  focus: { days_planned: number; items_total: number; items_done: number; reviews: number };
  team: { id: number; name: string; avg_pct: number; behind: string[] }[];
  highlights: string[];
}

/** Dia de calendário local no formato YYYY-MM-DD (o servidor nunca converte fuso). */
export function toDayString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromDayString(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function fetchHabits() {
  const { data } = await api.get("/habits", { params: { today: toDayString() } });
  return data as Habit[];
}

export async function createHabit(payload: HabitPayload) {
  const { data } = await api.post("/habits", payload, { params: { today: toDayString() } });
  return data as Habit;
}

export async function updateHabit(habitId: number, payload: Partial<HabitPayload> & { archived?: boolean }) {
  const { data } = await api.put(`/habits/${habitId}`, payload, { params: { today: toDayString() } });
  return data as Habit;
}

export async function deleteHabit(habitId: number) {
  await api.delete(`/habits/${habitId}`);
}

export async function setHabitLog(habitId: number, date: string, done: boolean) {
  const { data } = await api.put(`/habits/${habitId}/logs`, { date, done, today: toDayString() });
  return data as Habit;
}


// ── equipe ──

export async function fetchTeamBoard() {
  const { data } = await api.get("/habits/team", { params: { today: toDayString() } });
  return data as TeamBoardHabit[];
}

export async function fetchTeamCandidates() {
  const { data } = await api.get("/habits/team/candidates");
  return data as TeamCandidate[];
}

export async function createTeamHabit(payload: TeamHabitPayload) {
  const { data } = await api.post("/habits/team", payload);
  return data as { id: number };
}

export async function updateTeamHabit(id: number, payload: Partial<TeamHabitPayload>) {
  const { data } = await api.put(`/habits/team/${id}`, payload);
  return data as { id: number };
}

export async function deleteTeamHabit(id: number) {
  await api.delete(`/habits/team/${id}`);
}

export async function nudgeTeamHabit(id: number) {
  const { data } = await api.post(`/habits/team/${id}/nudge`, null, { params: { today: toDayString() } });
  return data as { notified: number; total: number };
}

// ── foco do dia ──

export async function fetchFocus(date: string = toDayString()) {
  const { data } = await api.get("/habits/focus", { params: { date } });
  return data as DailyFocus;
}

export async function saveFocus(date: string, items: FocusItem[], review: string | null) {
  const { data } = await api.put("/habits/focus", { date, items, review });
  return data as DailyFocus;
}

// ── resumo semanal ──

export async function fetchWeeklySummary(weekStart: string) {
  const { data } = await api.get("/habits/summary", { params: { week_start: weekStart, today: toDayString() } });
  return data as WeeklySummary;
}
