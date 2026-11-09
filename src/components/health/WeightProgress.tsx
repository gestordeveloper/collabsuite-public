import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { ACCENT_COLORS } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";
import { fromDayString } from "@/src/services/habit.service";
import { MEASURE_DEFS } from "@/src/services/health.service";
import type { HealthGoals, HealthMeasure, MeasureKey, MeasurePatch } from "@/src/services/health.service";

const RANGES = [
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "1 ano", days: 365 },
  { label: "Tudo", days: 0 },
] as const;

/** Nestas, "diminuir" costuma ser o objetivo (verde); nas demais (braço, peito, coxa…) a leitura é neutra. */
const LOWER_IS_BETTER: MeasureKey[] = ["weight_kg", "body_fat", "waist_cm", "hip_cm"];

const fmt = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",");
const signed = (n: number, digits = 1) => `${n > 0 ? "+" : ""}${fmt(n, digits)}`;
const dayShort = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
const colorOf = (key: MeasureKey) => ACCENT_COLORS[MEASURE_DEFS.findIndex((m) => m.key === key) % (ACCENT_COLORS.length - 1)];

function daysBetween(a: string, b: string) {
  return Math.round((fromDayString(b).getTime() - fromDayString(a).getTime()) / 86400000);
}

export function WeightProgress({ measures, goals, today, onSave, onClear }: {
  measures: HealthMeasure[];
  goals: HealthGoals;
  today: string;
  onSave: (date: string, patch: MeasurePatch) => Promise<void>;
  onClear: (m: HealthMeasure) => Promise<void>;
}) {
  const [metric, setMetric] = useState<MeasureKey>("weight_kg");
  const [range, setRange] = useState<number>(90);
  const [editing, setEditing] = useState<HealthMeasure | "new" | null>(null);
  const meta = MEASURE_DEFS.find((m) => m.key === metric)!;
  const color = colorOf(metric);

  const withMetric = useMemo(() => measures.filter((m) => m[metric] != null), [measures, metric]);
  const visible = useMemo(
    () => (range === 0 ? withMetric : withMetric.filter((m) => daysBetween(m.date, today) <= range)),
    [withMetric, range, today]
  );

  const stats = useMemo(() => {
    if (withMetric.length === 0) return null;
    const values = withMetric.map((m) => m[metric] as number);
    const first = withMetric[0];
    const last = withMetric[withMetric.length - 1];
    // Referência de ~30 dias atrás: a última medida feita até essa data.
    const ref = [...withMetric].reverse().find((m) => daysBetween(m.date, last.date) >= 30);
    return {
      first, last,
      min: Math.min(...values), max: Math.max(...values),
      sinceStart: (last[metric] as number) - (first[metric] as number),
      vs30: ref ? (last[metric] as number) - (ref[metric] as number) : null,
      count: withMetric.length,
    };
  }, [withMetric, metric]);

  const toneOf = (delta: number | null) =>
    delta == null || delta === 0 || !LOWER_IS_BETTER.includes(metric) ? undefined : delta < 0 ? ("down" as const) : ("up" as const);

  const goal = metric === "weight_kg" ? goals.weight_kg : null;
  const chartData = visible.map((m) => ({ date: m.date, label: dayShort(m.date), value: m[metric] as number }));
  const history = useMemo(() => [...withMetric].reverse(), [withMetric]);

  /** "Quadril 98 · Peito 102": as outras medidas feitas no mesmo dia, para a linha da tabela. */
  const others = (m: HealthMeasure) =>
    MEASURE_DEFS.filter((d) => d.key !== metric && m[d.key] != null)
      .map((d) => `${d.label} ${fmt(m[d.key] as number)}${d.unit === "%" ? "%" : ""}`)
      .join(" · ");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Ruler className="h-5 w-5 text-primary" /> Peso e medidas
        </h2>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Registrar medidas
        </Button>
      </div>

      {measures.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma medida ainda. Registre peso, gordura e medidas (cintura, quadril, peito, braço, coxa, panturrilha, pescoço) para acompanhar a evolução — pode ser de qualquer data passada.
          </p>
          <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Registrar medidas</Button>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 rounded-[9px] border bg-surface p-[3px]">
              {MEASURE_DEFS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetric(m.key)}
                  className={cn("rounded-md px-3 py-1 text-[13px] font-medium transition-colors", metric === m.key ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="inline-flex gap-1 rounded-[9px] border bg-surface p-[3px]">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setRange(r.days)}
                  className={cn("rounded-md px-3 py-1 text-[13px] font-medium transition-colors", range === r.days ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {stats ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={`${meta.label} atual`} value={`${fmt(stats.last[metric] as number)} ${meta.unit}`} hint={`em ${dayShort(stats.last.date)}`} />
              <Stat
                label="Desde o início"
                value={`${signed(stats.sinceStart)} ${meta.unit}`}
                hint={`${fmt(stats.first[metric] as number)} em ${dayShort(stats.first.date)}`}
                tone={toneOf(stats.sinceStart)}
              />
              <Stat
                label="Últimos 30 dias"
                value={stats.vs30 != null ? `${signed(stats.vs30)} ${meta.unit}` : "—"}
                hint={stats.vs30 != null ? "vs. ~30 dias atrás" : "precisa de uma medida mais antiga"}
                tone={toneOf(stats.vs30)}
              />
              <Stat
                label={goal != null ? "Para a meta" : "Mín. / máx."}
                value={goal != null ? `${fmt(Math.abs((stats.last.weight_kg as number) - goal))} kg` : `${fmt(stats.min)} / ${fmt(stats.max)}`}
                hint={goal != null
                  ? (stats.last.weight_kg as number) === goal ? "meta atingida!" : `meta ${fmt(goal)} kg · ${(stats.last.weight_kg as number) > goal ? "falta perder" : "falta ganhar"}`
                  : `${stats.count} registros`}
              />
            </div>
          ) : (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Sem registros de {meta.label.toLowerCase()} ainda.{" "}
              <button type="button" className="text-primary hover:underline" onClick={() => setEditing("new")}>Registrar agora</button>
            </Card>
          )}

          {stats && (
            <>
              <Card className="p-4">
                <div className="h-60">
                  {chartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-subtle">Sem registros neste período.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} minTickGap={28} />
                        <YAxis
                          width={44}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          domain={[(min: number) => Math.floor(Math.min(min, goal ?? min) - 1), (max: number) => Math.ceil(Math.max(max, goal ?? max) + 1)]}
                        />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => [`${fmt(v)} ${meta.unit}`, meta.label]}
                          labelFormatter={(_, p) => (p?.[0]?.payload?.date ? dayShort(p[0].payload.date) : "")}
                        />
                        {goal != null && <ReferenceLine y={goal} stroke={ACCENT_COLORS[4]} strokeDasharray="4 4" label={{ value: "meta", fill: ACCENT_COLORS[4], fontSize: 11, position: "right" }} />}
                        <Line type="monotone" dataKey="value" isAnimationActive={false} stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="px-4 py-2 font-medium">Data</th>
                        <th className="px-2 py-2 font-medium">{meta.label}</th>
                        <th className="px-2 py-2 font-medium">Variação</th>
                        <th className="hidden px-2 py-2 font-medium md:table-cell">Outras medidas do dia</th>
                        <th className="w-20 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((m, i) => {
                        const prev = history[i + 1]; // lista decrescente: a próxima linha é a medida anterior
                        const delta = prev ? (m[metric] as number) - (prev[metric] as number) : null;
                        const extra = others(m);
                        return (
                          <tr key={m.date} className="border-b last:border-0 hover:bg-accent/40">
                            <td className="px-4 py-2 font-mono text-xs">
                              {dayShort(m.date)}
                              {m.source === "api" && <span className="ml-2 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">auto</span>}
                            </td>
                            <td className="px-2 py-2 font-mono">{fmt(m[metric] as number)} {meta.unit}</td>
                            <td className={cn("px-2 py-2 font-mono text-xs", toneOf(delta) === "down" ? "text-success" : toneOf(delta) === "up" ? "text-warning" : "text-subtle")}>
                              {delta != null ? signed(delta) : "—"}
                            </td>
                            <td className="hidden max-w-[320px] truncate px-2 py-2 text-xs text-muted-foreground md:table-cell" title={extra}>{extra || "—"}</td>
                            <td className="px-2 py-1 text-right">
                              <button type="button" onClick={() => setEditing(m)} aria-label="Editar" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Remover"
                                onClick={() => confirm(`Remover todas as medidas de ${dayShort(m.date)}?`) && onClear(m)}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}

      <MeasureDialog
        open={editing !== null}
        initial={editing && editing !== "new" ? editing : null}
        today={today}
        existing={measures}
        onClose={() => setEditing(null)}
        onSave={onSave}
      />
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "up" | "down" }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold", tone === "down" && "text-success", tone === "up" && "text-warning")}>{value}</div>
      <div className="text-[11px] text-subtle">{hint}</div>
    </Card>
  );
}

type Draft = Record<MeasureKey, string>;
const EMPTY_DRAFT = Object.fromEntries(MEASURE_DEFS.map((d) => [d.key, ""])) as Draft;
const toDraft = (m?: HealthMeasure): Draft =>
  Object.fromEntries(MEASURE_DEFS.map((d) => [d.key, m?.[d.key] != null ? String(m[d.key]).replace(".", ",") : ""])) as Draft;

function MeasureDialog({ open, initial, today, existing, onClose, onSave }: {
  open: boolean;
  initial: HealthMeasure | null;
  today: string;
  existing: HealthMeasure[];
  onClose: () => void;
  onSave: (date: string, patch: MeasurePatch) => Promise<void>;
}) {
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDate(initial?.date ?? today);
    setDraft(initial ? toDraft(initial) : EMPTY_DRAFT);
  }, [open, initial, today]);

  /** Trocar a data para um dia que já tem medidas carrega esses valores, em vez de sobrescrever às cegas. */
  function changeDate(d: string) {
    setDate(d);
    const found = existing.find((m) => m.date === d);
    if (found) setDraft(toDraft(found));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const patch = {} as MeasurePatch;
    for (const def of MEASURE_DEFS) {
      const text = draft[def.key].trim();
      const n = text ? Number(text.replace(",", ".")) : null;
      if (n !== null && !Number.isFinite(n)) return setError(`${def.label}: use apenas números (ex.: 74,5).`);
      if (n !== null && (n < def.min || n > def.max)) return setError(`${def.label}: informe um valor entre ${def.min} e ${def.max} ${def.unit}.`);
      patch[def.key] = n;
    }
    if (Object.values(patch).every((v) => v === null)) return setError("Informe ao menos uma medida.");
    if (!date || date > today) return setError("Escolha uma data até hoje.");
    setSaving(true);
    setError(null);
    try {
      await onSave(date, patch);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.details ? "Algum valor está fora do limite permitido." : err?.response?.data?.error || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar medidas" : "Registrar medidas"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="measure-date">Data</Label>
            <Input id="measure-date" type="date" max={today} value={date} onChange={(e) => changeDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MEASURE_DEFS.map((def, i) => (
              <div key={def.key} className="space-y-1.5">
                <Label htmlFor={`measure-${def.key}`}>{def.label} ({def.unit})</Label>
                <Input
                  id={`measure-${def.key}`}
                  autoFocus={i === 0}
                  inputMode="decimal"
                  value={draft[def.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [def.key]: e.target.value }))}
                  placeholder={i === 0 ? "74,5" : "opc."}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-subtle">Preencha só o que mediu. Apagar um campo e salvar limpa aquele valor do dia.</p>
          {existing.some((m) => m.date === date) && !initial && (
            <p className="text-[11px] text-subtle">Já existe registro neste dia — salvar atualiza os valores.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
