import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/src/components/ui/card";
import { ACCENT_COLORS } from "@/src/lib/design";
import { cn } from "@/src/lib/utils";
import { fromDayString, toDayString } from "@/src/services/habit.service";
import type { HealthDay, HealthGoals } from "@/src/services/health.service";

const RANGES = [7, 30, 90] as const;

interface Point {
  date: string;
  label: string;
  steps: number | null;
  water: number | null;
  sleep: number | null;
  weight: number | null;
}

function buildSeries(days: HealthDay[], today: string, range: number): Point[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const end = fromDayString(today);
  const points: Point[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = toDayString(d);
    const row = byDate.get(key);
    points.push({
      date: key,
      label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      steps: row?.steps ?? null,
      water: row?.water_ml != null ? Math.round((row.water_ml / 1000) * 10) / 10 : null,
      sleep: row?.sleep_min != null ? Math.round((row.sleep_min / 60) * 10) / 10 : null,
      weight: row?.weight_kg ?? null,
    });
  }
  return points;
}

const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

function ChartCard({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</h3>
      <div className="h-44">
        {empty ? (
          <div className="flex h-full items-center justify-center text-xs text-subtle">Sem registros neste período.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export function HealthTrends({ days, goals, today }: { days: HealthDay[]; goals: HealthGoals; today: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const series = useMemo(() => buildSeries(days, today, range), [days, today, range]);
  const tickInterval = range === 7 ? 0 : range === 30 ? 4 : 13;
  const has = (key: keyof Point) => series.some((p) => p[key] != null);
  const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Evolução</h2>
        <div className="inline-flex gap-1 rounded-[9px] border bg-surface p-[3px]">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
                range === r ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r} dias
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Passos" empty={!has("steps")}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" interval={tickInterval} {...axis} />
            <YAxis width={44} {...axis} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString("pt-BR"), "Passos"]} />
            <ReferenceLine y={goals.steps} stroke={ACCENT_COLORS[4]} strokeDasharray="4 4" />
            <Bar dataKey="steps" fill={ACCENT_COLORS[5]} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Sono (horas)" empty={!has("sleep")}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" interval={tickInterval} {...axis} />
            <YAxis width={32} {...axis} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} h`, "Sono"]} />
            <ReferenceLine y={goals.sleep_min / 60} stroke={ACCENT_COLORS[4]} strokeDasharray="4 4" />
            <Bar dataKey="sleep" fill={ACCENT_COLORS[1]} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Água (litros)" empty={!has("water")}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" interval={tickInterval} {...axis} />
            <YAxis width={32} {...axis} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} L`, "Água"]} />
            <ReferenceLine y={goals.water_ml / 1000} stroke={ACCENT_COLORS[4]} strokeDasharray="4 4" />
            <Bar dataKey="water" fill={ACCENT_COLORS[2]} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartCard>

      </div>
    </section>
  );
}
