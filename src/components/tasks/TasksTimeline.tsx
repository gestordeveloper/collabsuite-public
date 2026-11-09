import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { PINK, hexA } from "@/src/lib/design";
import { taskPeople, type TaskRow } from "@/src/lib/task-view";
import type { Project } from "@/src/types";
import { cn } from "@/src/lib/utils";

const DAY_W = 40;
const LEFT_W = 280;
const DOW_LETTER = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
/** Quanto o intervalo pode se estender para trás/frente de hoje (evita uma linha do tempo gigante). */
const MAX_BACK_DAYS = 120;
const MAX_FORWARD_DAYS = 120;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);

interface Bar {
  row: TaskRow;
  start: Date;
  end: Date;
}

interface TasksTimelineProps {
  rows: TaskRow[];
  projects: Project[];
  onOpen: (row: TaskRow) => void;
}

/** Linha do tempo (Gantt) por projeto: barra do início ao prazo; o preenchimento é o progresso. */
export function TasksTimeline({ rows, projects, onOpen }: TasksTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());

  const { bars, withoutDue } = useMemo(() => {
    const list: Bar[] = [];
    let missing = 0;
    const earliest = addDays(today, -MAX_BACK_DAYS);
    const latest = addDays(today, MAX_FORWARD_DAYS);
    for (const row of rows) {
      if (!row.task.due_at) {
        missing++;
        continue;
      }
      const end = startOfDay(new Date(row.task.due_at));
      let start = startOfDay(new Date(row.task.started_at ?? row.task.created_at));
      if (start > end) start = end;
      // Fora da janela máxima: não desenha (evitaria uma barra "grudada" na borda).
      if (end < earliest || start > latest) {
        missing++;
        continue;
      }
      list.push({ row, start, end });
    }
    return { bars: list, withoutDue: missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, today.getTime()]);

  const { rangeStart, dayCount } = useMemo(() => {
    let first = addDays(today, -14);
    let last = addDays(today, 28);
    const minCap = addDays(today, -MAX_BACK_DAYS);
    const maxCap = addDays(today, MAX_FORWARD_DAYS);
    for (const b of bars) {
      const s = b.start < minCap ? minCap : b.start;
      const e = b.end > maxCap ? maxCap : b.end;
      if (s < first) first = s;
      if (e > last) last = e;
    }
    return { rangeStart: first, dayCount: diffDays(first, last) + 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, today.getTime()]);

  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const date = addDays(rangeStart, i);
        return { date, num: date.getDate(), dow: DOW_LETTER[date.getDay()], weekend: date.getDay() === 0 || date.getDay() === 6, isToday: date.getTime() === today.getTime() };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeStart.getTime(), dayCount, today.getTime()]
  );

  const months = useMemo(() => {
    const segments: { label: string; days: number }[] = [];
    for (const d of days) {
      const label = `${MONTH_NAMES[d.date.getMonth()]}${d.date.getMonth() === 0 || segments.length === 0 ? ` ${d.date.getFullYear()}` : ""}`;
      const last = segments[segments.length - 1];
      if (last && last.label.split(" ")[0] === MONTH_NAMES[d.date.getMonth()]) last.days++;
      else segments.push({ label, days: 1 });
    }
    return segments;
  }, [days]);

  const groups = useMemo(() => {
    const byProject = new Map<number | "none", Bar[]>();
    for (const b of bars) {
      const key = b.row.project?.id ?? "none";
      const list = byProject.get(key) ?? [];
      list.push(b);
      byProject.set(key, list);
    }
    const ordered: { key: number | "none"; project: Project | null; bars: Bar[] }[] = [];
    for (const p of projects) {
      const list = byProject.get(p.id);
      if (list) ordered.push({ key: p.id, project: p, bars: list.sort((a, b) => +a.start - +b.start) });
    }
    const orphan = byProject.get("none");
    if (orphan) ordered.push({ key: "none", project: null, bars: orphan });
    return ordered;
  }, [bars, projects]);

  const width = dayCount * DAY_W;
  const todayLeft = diffDays(rangeStart, today) * DAY_W + DAY_W / 2 - 1;
  const gridBackground = `linear-gradient(90deg, hsl(var(--border) / 0.5) 1px, transparent 1px)`;

  function scrollToToday(behavior: ScrollBehavior = "smooth") {
    scrollRef.current?.scrollTo({ left: Math.max(0, todayLeft - 340), behavior });
  }

  function scrollByDays(amount: number) {
    scrollRef.current?.scrollBy({ left: amount * DAY_W, behavior: "smooth" });
  }

  // Ao abrir, deixa "hoje" visível.
  useEffect(() => {
    scrollToToday("auto");
  }, [todayLeft, groups.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (bars.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-16 text-center">
        <p className="text-sm font-medium text-muted-foreground">Nenhuma tarefa com prazo para mostrar na linha do tempo.</p>
        <p className="mt-1 text-xs text-subtle">Defina o prazo nas tarefas para vê-las aqui.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div ref={scrollRef} className="max-h-[calc(100vh-300px)] min-h-[320px] overflow-auto rounded-xl border bg-surface">
        <div className="grid min-w-max" style={{ gridTemplateColumns: `${LEFT_W}px ${width}px` }}>
          {/* Cabeçalho */}
          <div className="sticky left-0 top-0 z-[4] flex h-16 items-end border-b border-r bg-surface px-4 pb-2.5 text-xs font-medium text-subtle">
            Tarefa
          </div>
          <div className="sticky top-0 z-[3] flex h-16 flex-col border-b bg-surface">
            <div className="flex h-7">
              {months.map((m, i) => (
                <div key={m.label + i} className="border-l border-border/60 px-2.5 pt-2 text-xs font-semibold" style={{ width: m.days * DAY_W }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="flex flex-1">
              {days.map((d) => (
                <div
                  key={d.date.getTime()}
                  className={cn("flex shrink-0 flex-col items-center justify-center gap-px border-l border-border/40 text-[10px]", d.isToday ? "text-primary" : "text-subtle")}
                  style={{ width: DAY_W }}
                >
                  <span>{d.dow}</span>
                  <span
                    className={cn(
                      "grid h-[18px] w-[22px] place-items-center rounded-[5px] font-mono text-[11px]",
                      d.isToday ? "bg-primary text-white" : d.weekend ? "text-subtle" : "text-foreground/80"
                    )}
                  >
                    {d.num}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Corpo */}
          {groups.map((group) => (
            <div key={group.key} className="contents">
              <div className="sticky left-0 z-[2] flex h-9 items-center gap-2 border-b border-r bg-card px-4 text-xs font-semibold">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: group.project?.color || PINK }} />
                <span className="truncate">{group.project?.name ?? "Sem projeto"}</span>
                <span className="font-mono font-normal text-subtle">{group.bars.length}</span>
              </div>
              <div className="relative h-9 border-b bg-card">
                <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary/70" style={{ left: todayLeft }} />
              </div>

              {group.bars.map((bar) => {
                const { row } = bar;
                const color = row.project?.color || PINK;
                const from = bar.start < rangeStart ? rangeStart : bar.start;
                const to = bar.end > addDays(rangeStart, dayCount - 1) ? addDays(rangeStart, dayCount - 1) : bar.end;
                const left = diffDays(rangeStart, from) * DAY_W + 3;
                const barWidth = Math.max((diffDays(from, to) + 1) * DAY_W - 6, 18);
                const people = taskPeople(row.task);
                return (
                  <div key={row.task.id} className="contents">
                    <div
                      onClick={() => onOpen(row)}
                      className="sticky left-0 z-[2] flex h-11 cursor-pointer items-center gap-2.5 border-b border-r border-border/60 bg-surface pl-8 pr-4 transition-colors hover:bg-card"
                    >
                      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: row.stageColor }} />
                      <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", row.done && "text-subtle")}>{row.task.title}</span>
                      <div className="flex">
                        {people.slice(0, 2).map((p) => (
                          <UserAvatar key={p.id} user={p} className="-ml-[5px] h-5 w-5 border-2 border-surface text-[8px]" />
                        ))}
                      </div>
                    </div>
                    <div className="relative h-11 border-b border-border/60" style={{ backgroundImage: gridBackground, backgroundSize: `${DAY_W}px 100%` }}>
                      {days.map((d, i) =>
                        d.weekend ? <span key={i} className="absolute inset-y-0 bg-foreground/[0.03]" style={{ left: i * DAY_W, width: DAY_W }} /> : null
                      )}
                      <span className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-primary/70" style={{ left: todayLeft }} />
                      <div
                        onClick={() => onOpen(row)}
                        title={`${row.task.title} · ${row.progress}%`}
                        className="absolute top-2 flex h-7 cursor-pointer items-center overflow-hidden rounded-[7px] border px-2.5 transition-colors hover:border-foreground"
                        style={{
                          left,
                          width: barWidth,
                          backgroundColor: hexA(color, 0.2),
                          borderColor: hexA(color, 0.45),
                          opacity: row.done ? 0.5 : 1,
                        }}
                      >
                        <span className="absolute inset-y-0 left-0" style={{ width: `${row.progress}%`, backgroundColor: hexA(color, 0.45) }} />
                        <span className="relative truncate text-xs font-medium">{row.task.title}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Voltar duas semanas" onClick={() => scrollByDays(-14)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => scrollToToday()} className="h-7 rounded-md border border-border px-2.5 font-medium hover:text-foreground">
            Hoje
          </button>
          <button type="button" aria-label="Avançar duas semanas" onClick={() => scrollByDays(14)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 bg-primary" /> Hoje
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative h-2.5 w-[18px] overflow-hidden rounded-[3px] bg-primary/25">
            <span className="absolute inset-y-0 left-0 w-1/2 bg-primary/60" />
          </span>
          Preenchimento = progresso (checklist/subtarefas)
        </span>
        {withoutDue > 0 && <span className="text-subtle">{withoutDue} {withoutDue === 1 ? "tarefa fora do período ou sem prazo não aparece" : "tarefas fora do período ou sem prazo não aparecem"} aqui</span>}
      </div>
    </div>
  );
}
