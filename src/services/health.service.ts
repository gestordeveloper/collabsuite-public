import api from "./api";
import { toDayString } from "./habit.service";

export type HealthSource = "manual" | "api";

export interface HealthDay {
  date: string;
  steps: number | null;
  water_ml: number | null;
  sleep_min: number | null;
  sleep_quality: number | null;
  weight_kg: number | null;
  body_fat: number | null;
  waist_cm: number | null;
  neck_cm: number | null;
  chest_cm: number | null;
  arm_cm: number | null;
  hip_cm: number | null;
  thigh_cm: number | null;
  calf_cm: number | null;
  mood: number | null;
  energy: number | null;
  stress: number | null;
  notes: string | null;
  sources: Partial<Record<keyof Omit<HealthDay, "date" | "sources">, HealthSource>>;
}

export type HealthDayPatch = Partial<Omit<HealthDay, "date" | "sources">>;

export interface HealthWorkout {
  id: number;
  date: string;
  type: string;
  duration_min: number;
  calories: number | null;
  distance_km: number | null;
  notes: string | null;
  source: string;
}

export interface HealthGoals {
  steps: number;
  water_ml: number;
  sleep_min: number;
  workouts_per_week: number;
  weight_kg: number | null;
}

export interface HealthOverview {
  today: string;
  goals: HealthGoals;
  days: HealthDay[];
  workouts: HealthWorkout[];
  sync: { has_token: boolean; token_hint: string | null; last_synced_at: string | null };
}

export interface WorkoutPayload {
  date: string;
  type: string;
  duration_min: number;
  calories?: number | null;
  distance_km?: number | null;
  notes?: string | null;
}

export async function fetchOverview() {
  const { data } = await api.get("/health", { params: { today: toDayString() } });
  return data as HealthOverview;
}

export type MeasureKey = "weight_kg" | "body_fat" | "waist_cm" | "neck_cm" | "chest_cm" | "arm_cm" | "hip_cm" | "thigh_cm" | "calf_cm";

/** Peso, gordura e medidas corporais: rótulo, unidade e limites aceitos pelo servidor. */
export const MEASURE_DEFS: { key: MeasureKey; label: string; unit: string; min: number; max: number }[] = [
  { key: "weight_kg", label: "Peso", unit: "kg", min: 20, max: 500 },
  { key: "body_fat", label: "Gordura", unit: "%", min: 1, max: 80 },
  { key: "waist_cm", label: "Cintura", unit: "cm", min: 20, max: 300 },
  { key: "hip_cm", label: "Quadril", unit: "cm", min: 40, max: 250 },
  { key: "chest_cm", label: "Peito", unit: "cm", min: 40, max: 250 },
  { key: "arm_cm", label: "Braço", unit: "cm", min: 10, max: 80 },
  { key: "thigh_cm", label: "Coxa", unit: "cm", min: 20, max: 130 },
  { key: "calf_cm", label: "Panturrilha", unit: "cm", min: 15, max: 80 },
  { key: "neck_cm", label: "Pescoço", unit: "cm", min: 15, max: 80 },
];

export type MeasurePatch = Record<MeasureKey, number | null>;

export type HealthMeasure = { date: string; source: HealthSource } & MeasurePatch;

export async function fetchMeasures() {
  const { data } = await api.get("/health/measures");
  return data as HealthMeasure[];
}

export async function saveDay(date: string, patch: HealthDayPatch) {
  const { data } = await api.put(`/health/day/${date}`, patch);
  return data as HealthDay;
}

export async function addWater(date: string, delta_ml: number) {
  const { data } = await api.post(`/health/day/${date}/water`, { delta_ml });
  return data as HealthDay;
}

export async function addWorkout(payload: WorkoutPayload) {
  const { data } = await api.post("/health/workouts", payload);
  return data as HealthWorkout;
}

export async function deleteWorkout(id: number) {
  await api.delete(`/health/workouts/${id}`);
}

export async function saveGoals(goals: Partial<HealthGoals>) {
  const { data } = await api.put("/health/goals", goals);
  return data as HealthGoals;
}

export async function createSyncToken() {
  const { data } = await api.post("/health/sync-token");
  return data as { token: string; token_hint: string };
}

export async function revokeSyncToken() {
  await api.delete("/health/sync-token");
}

/** 450 → "7h30"; null → "—". */
export function formatSleep(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Aceita "7:30", "7h30", "7,5" ou "7.5" (horas) e devolve minutos; null se inválido. */
export function parseSleep(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  const hm = t.match(/^(\d{1,2})\s*[h:]\s*(\d{1,2})?$/);
  if (hm) return Math.min(1440, Number(hm[1]) * 60 + Number(hm[2] ?? 0));
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(1440, Math.round(n * 60));
}
