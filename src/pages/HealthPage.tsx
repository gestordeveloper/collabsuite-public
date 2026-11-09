import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Dumbbell, Droplets, Footprints, HeartPulse, Moon, Plus, RefreshCw, Scale, Target, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { GoalsDialog, SyncDialog, WorkoutDialog } from "@/src/components/health/HealthDialogs";
import { HealthTrends } from "@/src/components/health/HealthTrends";
import { WeightProgress } from "@/src/components/health/WeightProgress";
import { fromDayString, toDayString } from "@/src/services/habit.service";
import * as healthApi from "@/src/services/health.service";
import { MEASURE_DEFS, formatSleep, parseSleep } from "@/src/services/health.service";
import type { HealthDay, HealthDayPatch, HealthMeasure, HealthOverview, HealthWorkout, MeasurePatch, WorkoutPayload } from "@/src/services/health.service";
import { ACCENT_COLORS, hexA } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";

const MAX_DAYS_BACK = 89;
const MOODS = ["😞", "😕", "😐", "🙂", "😄"];
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const EMPTY_DAY = (date: string): HealthDay => ({
  date, steps: null, water_ml: null, sleep_min: null, sleep_quality: null, weight_kg: null, body_fat: null,
  waist_cm: null, neck_cm: null, chest_cm: null, arm_cm: null, hip_cm: null, thigh_cm: null, calf_cm: null, mood: null, energy: null, stress: null, notes: null, sources: {},
});

function addDays(day: string, n: number): string {
  const d = fromDayString(day);
  d.setDate(d.getDate() + n);
  return toDayString(d);
}

function dayLabel(day: string, today: string): string {
  if (day === today) return "Hoje";
  if (day === addDays(today, -1)) return "Ontem";
  const d = fromDayString(day);
  return `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseDecimal(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(n) ? n : null;
}

export function HealthPage() {
  const [data, setData] = useState<HealthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [measures, setMeasures] = useState<HealthMeasure[]>([]);
  const [showAllMeasures, setShowAllMeasures] = useState(false);

  const load = useCallback(async () => {
    try {
      const overview = await healthApi.fetchOverview();
      setData(overview);
      setSelected((s) => s ?? overview.today);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar os dados de saúde.");
    }
  }, []);

  const loadMeasures = useCallback(async () => {
    try {
      setMeasures(await healthApi.fetchMeasures());
    } catch {
      /* o histórico é complementar; a tela segue funcionando sem ele */
    }
  }, []);

  useEffect(() => {
    load();
    loadMeasures();
  }, [load, loadMeasures]);

  const today = data?.today ?? toDayString();
  const day = selected ?? today;
  const current = useMemo(() => data?.days.find((d) => d.date === day) ?? EMPTY_DAY(day), [data, day]);
  const dayWorkouts = useMemo(() => (data?.workouts ?? []).filter((w) => w.date === day), [data, day]);

  const mergeDay = useCallback((saved: HealthDay) => {
    setData((prev) => {
      if (!prev) return prev;
      const days = prev.days.filter((d) => d.date !== saved.date).concat(saved).sort((a, b) => a.date.localeCompare(b.date));
      return { ...prev, days };
    });
  }, []);

  /** Salva e mostra o erro do servidor (ex.: valor fora do limite) sem perder a tela. */
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await action();
      setError(null);
      return result;
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Não foi possível salvar.");
      return null;
    }
  }, []);

  const patchDay = useCallback(async (patch: HealthDayPatch) => {
    const saved = await run(() => healthApi.saveDay(day, patch));
    if (saved) {
      mergeDay(saved);
      if (MEASURE_DEFS.some((m) => m.key in patch)) loadMeasures();
    }
  }, [day, mergeDay, run, loadMeasures]);

  /** Registra/edita as medidas de qualquer data (a pesagem pode ser de dias atrás). */
  const saveMeasure = useCallback(async (date: string, patch: MeasurePatch) => {
    const saved = await healthApi.saveDay(date, patch);
    mergeDay(saved);
    await loadMeasures();
  }, [mergeDay, loadMeasures]);

  const clearMeasure = useCallback(async (m: HealthMeasure) => {
    const saved = await run(() => healthApi.saveDay(m.date, Object.fromEntries(MEASURE_DEFS.map((d) => [d.key, null])) as MeasurePatch));
    if (saved) {
      mergeDay(saved);
      await loadMeasures();
    }
  }, [mergeDay, loadMeasures, run]);

  const addWater = useCallback(async (delta: number) => {
    const saved = await run(() => healthApi.addWater(day, delta));
    if (saved) mergeDay(saved);
  }, [day, mergeDay, run]);

  async function saveWorkout(payload: WorkoutPayload) {
    const created = await healthApi.addWorkout(payload);
    setData((prev) => (prev ? { ...prev, workouts: [created, ...prev.workouts] } : prev));
  }

  async function removeWorkout(w: HealthWorkout) {
    if (!confirm(`Remover o treino "${w.type}"?`)) return;
    if (await run(() => healthApi.deleteWorkout(w.id)).then((r) => r !== null)) {
      setData((prev) => (prev ? { ...prev, workouts: prev.workouts.filter((x) => x.id !== w.id) } : prev));
    }
  }

  async function saveGoals(goals: Parameters<typeof healthApi.saveGoals>[0]) {
    const saved = await healthApi.saveGoals(goals);
    setData((prev) => (prev ? { ...prev, goals: saved } : prev));
  }

  // Médias dos últimos 7 dias e treinos da semana (domingo–sábado)
  const week = useMemo(() => {
    if (!data) return null;
    const from = addDays(today, -6);
    const last7 = data.days.filter((d) => d.date >= from && d.date <= today);
    const avg = (pick: (d: HealthDay) => number | null) => {
      const values = last7.map(pick).filter((v): v is number => v != null);
      return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    };
    const dow = fromDayString(today).getDay();
    const weekStart = addDays(today, -dow);
    return {
      steps: avg((d) => d.steps),
      sleep: avg((d) => d.sleep_min),
      water: avg((d) => d.water_ml),
      workouts: data.workouts.filter((w) => w.date >= weekStart && w.date <= today).length,
    };
  }, [data, today]);

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 p-4 sm:p-6 md:p-8">
        {error ? <p className="text-sm text-destructive">{error}</p> : <Skeleton className="h-64 w-full" />}
      </div>
    );
  }

  const { goals } = data;
  const waterPct = Math.min(100, Math.round(((current.water_ml ?? 0) / goals.water_ml) * 100));
  const stepsPct = Math.min(100, Math.round(((current.steps ?? 0) / goals.steps) * 100));
  const sleepPct = Math.min(100, Math.round(((current.sleep_min ?? 0) / goals.sleep_min) * 100));
  const auto = (field: keyof HealthDay["sources"]) => current.sources[field] === "api";
  const daysBack = Math.round((fromDayString(today).getTime() - fromDayString(day).getTime()) / 86400000);

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 text-[13px] text-subtle">
            <button
              type="button"
              onClick={() => setSelected(addDays(day, -1))}
              disabled={daysBack >= MAX_DAYS_BACK}
              aria-label="Dia anterior"
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[130px] text-center capitalize">{dayLabel(day, today)}</span>
            <button
              type="button"
              onClick={() => setSelected(addDays(day, 1))}
              disabled={day >= today}
              aria-label="Próximo dia"
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {day !== today && (
              <button type="button" onClick={() => setSelected(today)} className="ml-1 text-primary hover:underline">Hoje</button>
            )}
          </div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Saúde</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSyncOpen(true)}>
            <RefreshCw className="h-4 w-4" />
            {data.sync.last_synced_at ? "Sincronizado" : "Sincronizar"}
          </Button>
          <Button variant="outline" onClick={() => setGoalsOpen(true)}>
            <Target className="h-4 w-4" /> Metas
          </Button>
        </div>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {week && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Passos (média 7d)" value={week.steps != null ? week.steps.toLocaleString("pt-BR") : "—"} hint={`meta ${goals.steps.toLocaleString("pt-BR")}`} />
          <Stat label="Sono (média 7d)" value={formatSleep(week.sleep)} hint={`meta ${formatSleep(goals.sleep_min)}`} />
          <Stat label="Água (média 7d)" value={week.water != null ? `${(week.water / 1000).toFixed(1)} L` : "—"} hint={`meta ${(goals.water_ml / 1000).toFixed(1)} L`} />
          <Stat label="Treinos na semana" value={`${week.workouts}/${goals.workouts_per_week}`} hint="domingo a sábado" />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Água */}
        <MetricCard icon={<Droplets className="h-4 w-4" />} color={ACCENT_COLORS[2]} title="Água" auto={auto("water_ml")}>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-3xl font-semibold">{((current.water_ml ?? 0) / 1000).toFixed(2).replace(/\.?0+$/, "") || "0"}</span>
            <span className="text-sm text-muted-foreground">/ {(goals.water_ml / 1000).toFixed(1)} L</span>
          </div>
          <Bar pct={waterPct} color={ACCENT_COLORS[2]} />
          <div className="flex flex-wrap gap-2">
            {[250, 500].map((ml) => (
              <Button key={ml} size="sm" variant="outline" onClick={() => addWater(ml)}>+{ml} ml</Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => addWater(-250)} disabled={(current.water_ml ?? 0) === 0}>−250</Button>
          </div>
        </MetricCard>

        {/* Sono */}
        <MetricCard icon={<Moon className="h-4 w-4" />} color={ACCENT_COLORS[1]} title="Sono" auto={auto("sleep_min")}>
          <div className="flex items-end gap-3">
            <TextField
              key={`sleep-${day}-${current.sleep_min}`}
              label="Horas dormidas"
              initial={current.sleep_min != null ? formatSleep(current.sleep_min) : ""}
              placeholder="7h30"
              onCommit={(text) => {
                if (!text.trim()) return patchDay({ sleep_min: null });
                const min = parseSleep(text);
                if (min == null) return setError("Use um formato como 7h30, 7:30 ou 7,5.");
                return patchDay({ sleep_min: min });
              }}
            />
            <span className="pb-2 text-xs text-subtle">meta {formatSleep(goals.sleep_min)}</span>
          </div>
          <Bar pct={sleepPct} color={ACCENT_COLORS[1]} />
          <Scale5 label="Qualidade" value={current.sleep_quality} low="ruim" high="ótima" onPick={(v) => patchDay({ sleep_quality: v })} />
        </MetricCard>

        {/* Passos */}
        <MetricCard icon={<Footprints className="h-4 w-4" />} color={ACCENT_COLORS[5]} title="Passos" auto={auto("steps")}>
          <div className="flex items-end gap-3">
            <TextField
              key={`steps-${day}-${current.steps}`}
              label="Passos do dia"
              type="number"
              initial={current.steps != null ? String(current.steps) : ""}
              placeholder="0"
              onCommit={(text) => {
                if (!text.trim()) return patchDay({ steps: null });
                const n = parseDecimal(text);
                if (n == null || n < 0) return setError("Informe um número de passos válido.");
                return patchDay({ steps: Math.round(n) });
              }}
            />
            <span className="pb-2 text-xs text-subtle">meta {goals.steps.toLocaleString("pt-BR")}</span>
          </div>
          <Bar pct={stepsPct} color={ACCENT_COLORS[5]} />
        </MetricCard>

        {/* Peso e medidas */}
        <MetricCard icon={<Scale className="h-4 w-4" />} color={ACCENT_COLORS[0]} title="Peso e medidas" auto={auto("weight_kg")}>
          <div className="grid grid-cols-3 gap-2">
            {MEASURE_DEFS.slice(0, showAllMeasures ? undefined : 3).map(({ key, label, unit }) => (
              <TextField
                key={`${key}-${day}-${current[key]}`}
                label={`${label} (${unit})`}
                initial={current[key] != null ? String(current[key]).replace(".", ",") : ""}
                placeholder="—"
                inputMode="decimal"
                onCommit={(text) => {
                  if (!text.trim()) return patchDay({ [key]: null });
                  const n = parseDecimal(text);
                  if (n == null) return setError(`${label}: informe um número.`);
                  return patchDay({ [key]: n });
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAllMeasures((v) => !v)}
            className="self-start text-xs text-primary hover:underline"
          >
            {showAllMeasures ? "Menos medidas" : "Mais medidas (quadril, peito, braço, coxa…)"}
          </button>
          {goals.weight_kg != null && current.weight_kg != null && (
            <p className="text-xs text-muted-foreground">
              Faltam {Math.abs(current.weight_kg - goals.weight_kg).toFixed(1).replace(".", ",")} kg para {goals.weight_kg} kg
              {current.weight_kg === goals.weight_kg && " — meta atingida!"}
            </p>
          )}
        </MetricCard>

        {/* Humor / energia / estresse */}
        <MetricCard icon={<HeartPulse className="h-4 w-4" />} color={ACCENT_COLORS[4]} title="Como você está">
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Humor</span>
            <div className="flex gap-1.5">
              {MOODS.map((emoji, i) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => patchDay({ mood: current.mood === i + 1 ? null : i + 1 })}
                  aria-label={`Humor ${i + 1} de 5`}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg border text-xl transition-colors",
                    current.mood === i + 1 ? "border-primary/60 bg-primary/15" : "border-input opacity-70 hover:opacity-100"
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <Scale5 label="Energia" value={current.energy} low="baixa" high="alta" onPick={(v) => patchDay({ energy: v })} />
          <Scale5 label="Estresse" value={current.stress} low="calmo" high="alto" onPick={(v) => patchDay({ stress: v })} />
        </MetricCard>

        {/* Treinos */}
        <MetricCard icon={<Dumbbell className="h-4 w-4" />} color={ACCENT_COLORS[3]} title="Treinos">
          {dayWorkouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum treino neste dia.</p>
          ) : (
            <ul className="space-y-1.5">
              {dayWorkouts.map((w) => (
                <li key={w.id} className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{w.type}</div>
                    <div className="text-xs text-muted-foreground">
                      {w.duration_min} min
                      {w.calories != null && ` · ${w.calories} kcal`}
                      {w.distance_km != null && ` · ${String(w.distance_km).replace(".", ",")} km`}
                      {w.source !== "manual" && " · automático"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWorkout(w)}
                    aria-label="Remover treino"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" onClick={() => setWorkoutOpen(true)}>
            <Plus className="h-4 w-4" /> Registrar treino
          </Button>
        </MetricCard>
      </div>

      <WeightProgress measures={measures} goals={goals} today={today} onSave={saveMeasure} onClear={clearMeasure} />

      <HealthTrends days={data.days} goals={goals} today={today} />

      <GoalsDialog open={goalsOpen} goals={goals} onClose={() => setGoalsOpen(false)} onSave={saveGoals} />
      <WorkoutDialog open={workoutOpen} date={day} onClose={() => setWorkoutOpen(false)} onSave={saveWorkout} />
      <SyncDialog open={syncOpen} sync={data.sync} onClose={() => setSyncOpen(false)} onChanged={load} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold">{value}</div>
      <div className="text-[11px] text-subtle">{hint}</div>
    </Card>
  );
}

function MetricCard({ icon, color, title, auto, children }: { icon: React.ReactNode; color: string; title: string; auto?: boolean; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: hexA(color, 0.14), color }}>
          {icon}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {auto && <span className="ml-auto rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase text-primary">Automático</span>}
      </div>
      {children}
    </Card>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** Campo que só grava ao sair (blur) ou apertar Enter, para não salvar a cada tecla. */
function TextField({ label, initial, placeholder, type, inputMode, onCommit }: {
  label: string;
  initial: string;
  placeholder?: string;
  type?: string;
  inputMode?: "decimal" | "numeric";
  onCommit: (text: string) => void | Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const commit = () => {
    if (text.trim() !== initial.trim()) onCommit(text);
  };
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type={type}
        inputMode={inputMode}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), undefined)}
        className="h-9"
      />
    </label>
  );
}

function Scale5({ label, value, low, high, onPick }: { label: string; value: number | null; low: string; high: string; onPick: (v: number | null) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="text-subtle">{low} → {high}</span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPick(value === n ? null : n)}
            aria-label={`${label} ${n} de 5`}
            className={cn(
              "h-8 flex-1 rounded-md border font-mono text-[13px] transition-colors",
              value === n ? "border-primary/50 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground"
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
