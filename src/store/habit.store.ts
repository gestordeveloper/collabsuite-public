import { create } from "zustand";
import * as habitService from "../services/habit.service";
import type { Habit, HabitPayload } from "../services/habit.service";

interface HabitState {
  habits: Habit[];
  loaded: boolean;
  isLoading: boolean;
  error: string | null;

  loadHabits: () => Promise<void>;
  createHabit: (payload: HabitPayload) => Promise<Habit>;
  updateHabit: (habitId: number, payload: Partial<HabitPayload>) => Promise<void>;
  archiveHabit: (habitId: number) => Promise<void>;
  deleteHabit: (habitId: number) => Promise<void>;
  /** Marca/desmarca o hábito em um dia (otimista; reverte se a API falhar). */
  toggleDay: (habitId: number, day: string) => Promise<void>;
}

// Evita duas chamadas simultâneas para o mesmo hábito/dia (cliques rápidos) chegarem fora de ordem.
const inFlight = new Set<string>();

function replaceHabit(habits: Habit[], habit: Habit): Habit[] {
  return habits.map((h) => (h.id === habit.id ? habit : h));
}

export const useHabitStore = create<HabitState>((set, get) => ({
  habits: [],
  loaded: false,
  isLoading: false,
  error: null,

  loadHabits: async () => {
    set({ isLoading: true, error: null });
    try {
      const habits = await habitService.fetchHabits();
      set({ habits, loaded: true, isLoading: false });
    } catch (err: any) {
      set({ isLoading: false, error: err.response?.data?.error ?? "Não foi possível carregar os hábitos." });
    }
  },

  createHabit: async (payload) => {
    const habit = await habitService.createHabit(payload);
    set((state) => ({ habits: [...state.habits, habit] }));
    return habit;
  },

  updateHabit: async (habitId, payload) => {
    const habit = await habitService.updateHabit(habitId, payload);
    set((state) => ({ habits: replaceHabit(state.habits, habit) }));
  },

  archiveHabit: async (habitId) => {
    await habitService.updateHabit(habitId, { archived: true });
    set((state) => ({ habits: state.habits.filter((h) => h.id !== habitId) }));
  },

  deleteHabit: async (habitId) => {
    await habitService.deleteHabit(habitId);
    set((state) => ({ habits: state.habits.filter((h) => h.id !== habitId) }));
  },

  toggleDay: async (habitId, day) => {
    const key = `${habitId}:${day}`;
    if (inFlight.has(key)) return;
    const previous = get().habits.find((h) => h.id === habitId);
    if (!previous) return;
    inFlight.add(key);
    const done = !previous.logs.includes(day);

    // Otimista: o círculo responde na hora; a resposta do servidor traz sequência/taxa recalculadas.
    const optimistic: Habit = {
      ...previous,
      logs: done ? [...previous.logs, day].sort() : previous.logs.filter((d) => d !== day),
    };
    set((state) => ({ habits: replaceHabit(state.habits, optimistic) }));

    try {
      const habit = await habitService.setHabitLog(habitId, day, done);
      set((state) => ({ habits: replaceHabit(state.habits, habit) }));
    } catch (err: any) {
      set((state) => ({
        habits: replaceHabit(state.habits, previous),
        error: err.response?.data?.error ?? "Não foi possível registrar o hábito.",
      }));
    } finally {
      inFlight.delete(key);
    }
  },
}));

/** Rótulo curto da sequência: "12d" / "3 sem". */
export function formatStreak(habit: Pick<Habit, "streak" | "streak_unit">, long = false): string {
  if (habit.streak_unit === "weeks") return long ? `${habit.streak} ${habit.streak === 1 ? "semana" : "semanas"}` : `${habit.streak} sem`;
  return long ? `${habit.streak} ${habit.streak === 1 ? "dia" : "dias"}` : `${habit.streak}d`;
}

export function formatBestStreak(habit: Pick<Habit, "best_streak" | "streak_unit">): string {
  const n = habit.best_streak;
  if (habit.streak_unit === "weeks") return `${n} ${n === 1 ? "semana" : "semanas"}`;
  return `${n} ${n === 1 ? "dia" : "dias"}`;
}

/** Descrição da meta: "Diário" / "4x por semana". */
export function goalLabel(targetPerWeek: number): string {
  return targetPerWeek >= 7 ? "Diário" : `${targetPerWeek}x por semana`;
}
