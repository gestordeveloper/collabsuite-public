import { Clock, FolderKanban, ListChecks, Users } from "lucide-react";
import type { Habit } from "@/src/services/habit.service";
import { formatReminderDays } from "@/src/lib/habit-templates";

/** Detalhes de um hábito/rotina selecionado: lembrete, projeto, origem (equipe) e passos. */
export function HabitDetailPanel({ habit }: { habit: Habit }) {
  const hasAny = habit.reminder_time || habit.project || habit.team || habit.checklist.length > 0;
  if (!hasAny) return null;

  return (
    <div className="flex flex-col gap-3 border-t pt-4 text-[13px]">
      {habit.team && (
        <p className="flex items-start gap-2 text-muted-foreground">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            Atribuído por <strong className="text-foreground">{habit.team.creator_name}</strong>
          </span>
        </p>
      )}
      {habit.project && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <FolderKanban className="h-3.5 w-3.5 shrink-0" /> {habit.project.name}
        </p>
      )}
      {habit.reminder_time && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" /> Lembrete às {habit.reminder_time} · {formatReminderDays(habit.reminder_days)}
        </p>
      )}
      {habit.checklist.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="label-caps flex items-center gap-1.5">
            <ListChecks className="h-3 w-3" /> {habit.kind === "routine" ? "Passos da rotina" : "Passos"}
          </span>
          <ol className="flex flex-col gap-1 text-muted-foreground">
            {habit.checklist.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-subtle">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
