import api from "./api";

export interface Stats {
  totalTasks: number;
  totalProjects: number;
  totalUsers: number;
  tasksByStatus: { notdone: number; inprogress: number; done: number };
  tasksByPriority: { low: number; medium: number; high: number };
}

export interface BurndownPoint {
  date: string;
  remaining: number;
  completed: number;
  created: number;
}

export interface RankingEntry {
  userId: number;
  user: { id: number; first_name: string; last_name: string | null; photo: string | null; email: string } | null;
  completedTasks: number;
  storyPoints: number;
  hoursWorked: number;
}

export async function fetchStats(): Promise<Stats> {
  const { data } = await api.get("/analytics/stats");
  return data;
}

export async function fetchBurndown(): Promise<BurndownPoint[]> {
  const { data } = await api.get("/analytics/burndown");
  return data;
}

export async function fetchRanking(): Promise<RankingEntry[]> {
  const { data } = await api.get("/analytics/ranking");
  return data;
}

export interface ProductivityUser {
  id: number;
  first_name: string;
  last_name: string | null;
  photo: string | null;
  email: string;
}

export interface Productivity {
  days: number;
  stalledAfterDays: number;
  totals: { started: number; completed: number; inProgressNow: number; avgCycleHours: number | null };
  people: {
    userId: number;
    user: ProductivityUser | null;
    started: number;
    completed: number;
    avgCycleHours: number | null;
    inProgressNow: number;
    stalled: number;
  }[];
  daily: { date: string; started: number; completed: number }[];
  byHour: { hour: number; count: number }[];
  byWeekday: { weekday: number; count: number }[];
  stalled: { id: number; title: string | null; userId: number | null; user: ProductivityUser | null; daysStopped: number }[];
}

export async function fetchProductivity(params: { days: number; user_id?: number; project_id?: number }): Promise<Productivity> {
  const { data } = await api.get("/analytics/productivity", { params });
  return data;
}
