import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { HabitCheck } from "@/src/components/habits/HabitCheck";
import { formatStreak, useHabitStore } from "@/src/store/habit.store";
import { toDayString } from "@/src/services/habit.service";
import { SEMANTIC } from "@/src/lib/design";

/** Card "Hábitos de hoje" do dashboard: check-in rápido de cada hábito + sequência. */
export function HabitsTodayCard() {
  const { habits, loaded, loadHabits, toggleDay } = useHabitStore();
  const today = toDayString();

  useEffect(() => {
    if (!loaded) loadHabits();
  }, [loaded, loadHabits]);

  const doneCount = habits.filter((h) => h.logs.includes(today)).length;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold">Hábitos de hoje</h3>
        {habits.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {doneCount} de {habits.length}
          </span>
        ) : (
          <Link to="/habitos" className="text-[13px] text-primary hover:underline">
            Criar
          </Link>
        )}
      </div>

      {!loaded ? (
        <div className="space-y-3 py-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : habits.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-sm text-muted-foreground">Acompanhe rotinas diárias e mantenha sequências.</p>
          <Link
            to="/habitos"
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-secondary px-3 py-1.5 text-[13px] font-medium hover:bg-input/60"
          >
            <Plus className="h-3.5 w-3.5" /> Novo hábito
          </Link>
        </div>
      ) : (
        <div className="flex flex-col">
          {habits.map((habit) => {
            const done = habit.logs.includes(today);
            return (
              <div key={habit.id} className="flex items-center gap-3 py-2">
                <HabitCheck
                  done={done}
                  color={habit.color}
                  label={`${done ? "Desmarcar" : "Marcar"} "${habit.name}" hoje`}
                  onClick={() => toggleDay(habit.id, today)}
                />
                <span className={done ? "flex-1 truncate text-sm text-muted-foreground" : "flex-1 truncate text-sm"}>{habit.name}</span>
                {habit.streak > 0 && (
                  <span className="font-mono text-xs" style={{ color: SEMANTIC.warning }}>
                    {formatStreak(habit)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
