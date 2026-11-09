import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { runExclusive } from "../lib/keyedMutex";

/**
 * Saúde: um registro por usuário e dia (água, sono, passos, peso, humor…) + treinos avulsos.
 *
 * Como em Hábitos, datas são "dias de calendário" do usuário (YYYY-MM-DD) enviados pelo cliente;
 * o servidor só grava/lê o dia (coluna DATE, UTC 00:00), sem converter fuso.
 *
 * Origem dos dados: `sources` guarda, por campo, "manual" ou "api". A API de importação (token por
 * usuário, para apps ponte/relógios) nunca sobrescreve um campo digitado à mão.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const OVERVIEW_DAYS = 90;

export const DAY_FIELDS = [
  "steps", "water_ml", "sleep_min", "sleep_quality", "weight_kg", "body_fat", "waist_cm", "neck_cm", "chest_cm", "arm_cm", "hip_cm",
  "thigh_cm", "calf_cm", "mood", "energy", "stress", "notes",
] as const;

/** Campos de composição corporal: peso, gordura e as medidas em cm. */
export const MEASURE_FIELDS = ["weight_kg", "body_fat", "waist_cm", "neck_cm", "chest_cm", "arm_cm", "hip_cm", "thigh_cm", "calf_cm"] as const;
export type MeasureField = (typeof MEASURE_FIELDS)[number];
export type DayField = (typeof DAY_FIELDS)[number];
export type DayPatch = Partial<Record<DayField, number | string | null>>;
export type DataSource = "manual" | "api";

export interface HealthGoals {
  steps: number;
  water_ml: number;
  sleep_min: number;
  workouts_per_week: number;
  weight_kg: number | null;
}

export const DEFAULT_GOALS: HealthGoals = { steps: 8000, water_ml: 2000, sleep_min: 480, workouts_per_week: 3, weight_kg: null };

export interface WorkoutInput {
  date: string;
  type: string;
  duration_min: number;
  calories?: number | null;
  distance_km?: number | null;
  notes?: string | null;
  external_id?: string | null;
}

// ── datas ──

const todayUtc = () => new Date().toISOString().slice(0, 10);
const toDbDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => fromDbDate(new Date(toDbDate(day).getTime() + n * DAY_MS));

function assertNotFuture(day: string) {
  // Tolera 1 dia à frente do relógio do servidor por causa de fuso horário.
  if (day > addDays(todayUtc(), 1)) throw new Error("Não é possível registrar uma data futura.");
}

// ── metas ──

function parseGoals(raw: string | null | undefined): HealthGoals {
  if (!raw) return { ...DEFAULT_GOALS };
  try {
    return { ...DEFAULT_GOALS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_GOALS };
  }
}

async function ensureProfile(userId: number) {
  return prisma.healthProfile.upsert({ where: { user_id: userId }, create: { user_id: userId }, update: {} });
}

export async function getGoals(userId: number): Promise<HealthGoals> {
  const profile = await prisma.healthProfile.findUnique({ where: { user_id: userId } });
  return parseGoals(profile?.goals);
}

export async function setGoals(userId: number, goals: Partial<HealthGoals>) {
  const merged = { ...(await getGoals(userId)), ...goals };
  await prisma.healthProfile.upsert({
    where: { user_id: userId },
    create: { user_id: userId, goals: JSON.stringify(merged) },
    update: { goals: JSON.stringify(merged) },
  });
  // Metas novas podem fazer hoje contar (ou não) para hábitos ligados à saúde.
  await syncHabits(userId, todayUtc());
  return merged;
}

// ── dias ──

type DayRow = NonNullable<Awaited<ReturnType<typeof prisma.healthDaily.findFirst>>>;

export interface DayView {
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
  sources: Partial<Record<DayField, DataSource>>;
}

function parseSources(raw: string | null): Partial<Record<DayField, DataSource>> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function dayView(row: DayRow): DayView {
  return {
    date: fromDbDate(row.log_date),
    steps: row.steps,
    water_ml: row.water_ml,
    sleep_min: row.sleep_min,
    sleep_quality: row.sleep_quality,
    weight_kg: row.weight_kg,
    body_fat: row.body_fat,
    waist_cm: row.waist_cm,
    neck_cm: row.neck_cm,
    chest_cm: row.chest_cm,
    arm_cm: row.arm_cm,
    hip_cm: row.hip_cm,
    thigh_cm: row.thigh_cm,
    calf_cm: row.calf_cm,
    mood: row.mood,
    energy: row.energy,
    stress: row.stress,
    notes: row.notes,
    sources: parseSources(row.sources),
  };
}

const dayLock = (userId: number, day: string) => `health:${userId}:${day}`;

/** Grava os campos informados (null limpa o campo). Importações pulam campos já digitados à mão. */
export function saveDay(userId: number, day: string, patch: DayPatch, source: DataSource = "manual"): Promise<DayView> {
  // Leitura + gravação do mesmo dia não podem se misturar (ex.: dois toques seguidos em "+500 ml").
  return runExclusive(dayLock(userId, day), () => writeDay(userId, day, patch, source));
}

async function writeDay(userId: number, day: string, patch: DayPatch, source: DataSource): Promise<DayView> {
  assertNotFuture(day);
  const existing = await prisma.healthDaily.findUnique({ where: { user_id_log_date: { user_id: userId, log_date: toDbDate(day) } } });
  const sources = parseSources(existing?.sources ?? null);

  const data: Record<string, number | string | null> = {};
  for (const field of DAY_FIELDS) {
    if (patch[field] === undefined) continue;
    const current = (existing as any)?.[field];
    if (source === "api" && sources[field] === "manual" && current !== null && current !== undefined) continue;
    data[field] = patch[field] as number | string | null;
    if (patch[field] === null) delete sources[field];
    else sources[field] = source;
  }

  const row = await prisma.healthDaily.upsert({
    where: { user_id_log_date: { user_id: userId, log_date: toDbDate(day) } },
    create: { user_id: userId, log_date: toDbDate(day), ...data, sources: JSON.stringify(sources) },
    update: { ...data, sources: JSON.stringify(sources) },
  });
  await syncHabits(userId, day);
  return dayView(row);
}

export function addWater(userId: number, day: string, deltaMl: number): Promise<DayView> {
  return runExclusive(dayLock(userId, day), async () => {
    const existing = await prisma.healthDaily.findUnique({ where: { user_id_log_date: { user_id: userId, log_date: toDbDate(day) } } });
    const next = Math.max(0, Math.min(20000, (existing?.water_ml ?? 0) + deltaMl));
    return writeDay(userId, day, { water_ml: next }, "manual");
  });
}

// ── treinos ──

function workoutView(w: { id: number; log_date: Date; type: string; duration_min: number; calories: number | null; distance_km: number | null; notes: string | null; source: string }) {
  return {
    id: w.id,
    date: fromDbDate(w.log_date),
    type: w.type,
    duration_min: w.duration_min,
    calories: w.calories,
    distance_km: w.distance_km,
    notes: w.notes,
    source: w.source,
  };
}
export type WorkoutView = ReturnType<typeof workoutView>;

export async function addWorkout(userId: number, input: WorkoutInput, source: DataSource = "manual") {
  assertNotFuture(input.date);
  const data = {
    user_id: userId,
    log_date: toDbDate(input.date),
    type: input.type.trim().slice(0, 40),
    duration_min: input.duration_min,
    calories: input.calories ?? null,
    distance_km: input.distance_km ?? null,
    notes: input.notes?.trim().slice(0, 300) || null,
    source,
  };
  let row;
  if (source === "api") {
    // Reenvios do mesmo treino atualizam em vez de duplicar.
    const external_id = (input.external_id || `${input.date}-${data.type}-${data.duration_min}`).slice(0, 100);
    row = await prisma.healthWorkout.upsert({
      where: { user_id_source_external_id: { user_id: userId, source, external_id } },
      create: { ...data, external_id },
      update: data,
    });
  } else {
    row = await prisma.healthWorkout.create({ data });
  }
  await syncHabits(userId, input.date);
  return workoutView(row);
}

export async function deleteWorkout(userId: number, workoutId: number) {
  const row = await prisma.healthWorkout.findFirst({ where: { id: workoutId, user_id: userId } });
  if (!row) throw new Error("Treino não encontrado.");
  await prisma.healthWorkout.delete({ where: { id: workoutId } });
  return { ok: true };
}

// ── peso e medidas (histórico completo) ──

export type MeasureRow = { date: string; source: DataSource } & Record<MeasureField, number | null>;

/** Todas as pesagens/medidas já registradas (não só os últimos 90 dias), da mais antiga à mais nova. */
export async function getMeasures(userId: number): Promise<MeasureRow[]> {
  const rows = await prisma.healthDaily.findMany({
    where: { user_id: userId, OR: MEASURE_FIELDS.map((f) => ({ [f]: { not: null } })) },
    orderBy: { log_date: "asc" },
    take: 3000,
  });
  return rows.map((r) => {
    const sources = parseSources(r.sources);
    return {
      date: fromDbDate(r.log_date),
      ...(Object.fromEntries(MEASURE_FIELDS.map((f) => [f, r[f]])) as Record<MeasureField, number | null>),
      source: MEASURE_FIELDS.some((f) => r[f] != null && sources[f] === "api") ? "api" : "manual",
    } as MeasureRow;
  });
}

// ── visão geral ──

export async function getOverview(userId: number, today: string = todayUtc()) {
  const from = addDays(today, -(OVERVIEW_DAYS - 1));
  const [days, workouts, profile] = await Promise.all([
    prisma.healthDaily.findMany({ where: { user_id: userId, log_date: { gte: toDbDate(from), lte: toDbDate(today) } }, orderBy: { log_date: "asc" } }),
    prisma.healthWorkout.findMany({
      where: { user_id: userId, log_date: { gte: toDbDate(from), lte: toDbDate(today) } },
      orderBy: [{ log_date: "desc" }, { id: "desc" }],
    }),
    prisma.healthProfile.findUnique({ where: { user_id: userId } }),
  ]);
  const goals = parseGoals(profile?.goals);
  return {
    today,
    goals,
    days: days.map(dayView),
    workouts: workouts.map(workoutView),
    sync: {
      has_token: !!profile?.sync_token_hash,
      token_hint: profile?.sync_token_hint ?? null,
      last_synced_at: profile?.last_synced_at?.toISOString() ?? null,
    },
  };
}

// ── API de importação (apps ponte / relógios) ──

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Gera (ou troca) o token. O valor em claro só é devolvido agora; no banco fica apenas o hash. */
export async function createSyncToken(userId: number) {
  await ensureProfile(userId);
  const token = `hk_${crypto.randomBytes(24).toString("base64url")}`;
  await prisma.healthProfile.update({
    where: { user_id: userId },
    data: { sync_token_hash: hashToken(token), sync_token_hint: token.slice(-4) },
  });
  return { token, token_hint: token.slice(-4) };
}

export async function revokeSyncToken(userId: number) {
  await prisma.healthProfile.updateMany({ where: { user_id: userId }, data: { sync_token_hash: null, sync_token_hint: null } });
  return { ok: true };
}

export interface IngestPayload {
  days?: Array<{ date: string } & DayPatch>;
  workouts?: WorkoutInput[];
}

export async function ingest(token: string, payload: IngestPayload) {
  const profile = await prisma.healthProfile.findUnique({ where: { sync_token_hash: hashToken(token) } });
  if (!profile) return null;

  let days = 0;
  let workouts = 0;
  const errors: string[] = [];
  for (const { date, ...patch } of payload.days ?? []) {
    try {
      await saveDay(profile.user_id, date, patch, "api");
      days++;
    } catch (err: any) {
      errors.push(`${date}: ${err.message}`);
    }
  }
  for (const w of payload.workouts ?? []) {
    try {
      await addWorkout(profile.user_id, w, "api");
      workouts++;
    } catch (err: any) {
      errors.push(`${w.date} ${w.type}: ${err.message}`);
    }
  }
  await prisma.healthProfile.update({ where: { id: profile.id }, data: { last_synced_at: new Date() } });
  return { days, workouts, errors };
}

// ── integração com Hábitos ──

/**
 * Hábitos ligados a uma métrica de saúde (`health_metric`) são marcados sozinhos quando a meta do dia
 * é batida. Só marca — nunca desmarca, para não apagar um check-in feito à mão.
 */
export async function syncHabits(userId: number, day: string) {
  const habits = await prisma.habit.findMany({
    where: { user_id: userId, archived_at: null, health_metric: { not: null } },
    select: { id: true, health_metric: true },
  });
  if (habits.length === 0) return;

  const [goals, row, workoutCount] = await Promise.all([
    getGoals(userId),
    prisma.healthDaily.findUnique({ where: { user_id_log_date: { user_id: userId, log_date: toDbDate(day) } } }),
    prisma.healthWorkout.count({ where: { user_id: userId, log_date: toDbDate(day) } }),
  ]);
  const met: Record<string, boolean> = {
    steps: (row?.steps ?? 0) >= goals.steps,
    water: (row?.water_ml ?? 0) >= goals.water_ml,
    sleep: (row?.sleep_min ?? 0) >= goals.sleep_min,
    workout: workoutCount > 0,
  };
  for (const h of habits) {
    if (!met[h.health_metric!]) continue;
    await prisma.habitLog.upsert({
      where: { habit_id_log_date: { habit_id: h.id, log_date: toDbDate(day) } },
      create: { habit_id: h.id, log_date: toDbDate(day) },
      update: {},
    });
  }
}
