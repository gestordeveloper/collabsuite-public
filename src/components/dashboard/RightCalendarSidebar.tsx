import { CalendarDays } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { PINK, hexA } from "@/src/lib/design";
import type { Task, Project } from "@/src/types";

interface RightCalendarSidebarProps {
  tasks: Task[];
  currentDate: Date;
  projects: Project[];
}

export function RightCalendarSidebar({ tasks, currentDate, projects }: RightCalendarSidebarProps) {
  const today = new Date(currentDate);
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  function labelForDay(d: Date) {
    if (sameDay(d, today)) return "Hoje";
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (sameDay(d, tomorrow)) return "Amanhã";
    return d.toLocaleDateString("pt-BR", { weekday: "long" });
  }

  function sameDay(a: Date, b: Date) {
    return a.toDateString() === b.toDateString();
  }

  function tasksForDay(day: Date) {
    return tasks
      .filter((t) => {
        if (!t.due_at || t.deleted_at) return false;
        return sameDay(new Date(t.due_at), day);
      })
      .sort((a, b) => (a.hour_at ?? "99:99").localeCompare(b.hour_at ?? "99:99"));
  }

  function projectColor(task: Task) {
    const project = projects.find((p) => p.funnels.some((f) => f.id === task.funnel_id));
    return project?.color ?? PINK;
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h3 className="font-display text-[15px] font-semibold">Próximos eventos</h3>
      </div>
      <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
        {days.map((day) => {
          const list = tasksForDay(day);
          return (
            <div key={day.toISOString()} className="space-y-2">
              <p className="label-caps capitalize">{labelForDay(day)}</p>
              {list.length === 0 ? (
                <p className="text-sm text-subtle">Nenhum evento.</p>
              ) : (
                list.map((t) => {
                  const color = projectColor(t);
                  return (
                    <div key={t.id} className="flex items-center gap-3">
                      <span className="w-11 shrink-0 font-mono text-xs text-subtle">{t.hour_at ?? "—"}</span>
                      <div
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[9px] px-3 py-[9px]"
                        style={{ backgroundColor: hexA(color, 0.16) }}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">{t.title}</p>
                          {t.description && <p className="truncate text-[11px] text-muted-foreground">{t.description}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
