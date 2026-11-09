import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Sparkles, X, NotebookPen } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { HabitCheck } from "@/src/components/habits/HabitCheck";
import { useDashboard } from "@/src/context/dashboard.context";
import { useAuthStore } from "@/src/store/auth.store";
import * as habitService from "@/src/services/habit.service";
import type { FocusItem } from "@/src/services/habit.service";
import { PINK } from "@/src/lib/design";

const MAX_ITEMS = 3;
const SAVE_DELAY_MS = 600;

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * "Foco do dia": até 3 prioridades escolhidas de manhã e uma revisão à noite.
 * Salva sozinho (com atraso curto) a cada alteração.
 */
export function FocusCard() {
  const { tasks } = useDashboard();
  const me = useAuthStore((s) => s.user);
  const today = habitService.toDayString();

  const [items, setItems] = useState<FocusItem[]>([]);
  const [review, setReview] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    habitService
      .fetchFocus(today)
      .then((f) => {
        setItems(f.items);
        setReview(f.review ?? "");
        setShowReview(!!f.review);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [today]);

  const persist = useCallback(
    (nextItems: FocusItem[], nextReview: string) => {
      if (timer.current) window.clearTimeout(timer.current);
      setStatus("saving");
      timer.current = window.setTimeout(async () => {
        try {
          await habitService.saveFocus(today, nextItems, nextReview.trim() || null);
          setStatus("saved");
        } catch {
          setStatus("error");
        }
      }, SAVE_DELAY_MS);
    },
    [today]
  );

  function updateItems(next: FocusItem[]) {
    setItems(next);
    persist(next, review);
  }

  function addItem(text: string, taskId?: number | null) {
    const clean = text.trim();
    if (!clean || items.length >= MAX_ITEMS) return;
    updateItems([...items, { id: newId(), text: clean, done: false, task_id: taskId ?? null }]);
  }

  // Sugestões: minhas tarefas abertas que vencem hoje ou já estão atrasadas.
  const suggestions = useMemo(() => {
    if (!me) return [];
    const taken = new Set(items.map((i) => i.task_id).filter(Boolean));
    return tasks
      .filter(
        (t) =>
          t.user_id === me.id &&
          t.status !== "done" &&
          t.due_at &&
          habitService.toDayString(new Date(t.due_at)) <= today &&
          !taken.has(t.id)
      )
      .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""))
      .slice(0, 4);
  }, [tasks, me, items, today]);

  const doneCount = items.filter((i) => i.done).length;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-display text-[15px] font-semibold">Foco do dia</h3>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {status === "saving" && <span>Salvando…</span>}
          {status === "saved" && <span>Salvo</span>}
          {status === "error" && <span className="text-destructive">Não foi possível salvar</span>}
          {items.length > 0 && (
            <span>
              {doneCount} de {items.length}
            </span>
          )}
        </div>
      </div>

      {!loaded ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : (
        <>
          {items.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              Escolha até {MAX_ITEMS} prioridades para hoje. O que não for foco, espera.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="group flex items-center gap-3">
                <HabitCheck
                  done={item.done}
                  color={PINK}
                  label={item.text}
                  onClick={() => updateItems(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
                />
                <span className={item.done ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm"}>{item.text}</span>
                <button
                  type="button"
                  aria-label={`Remover ${item.text}`}
                  onClick={() => updateItems(items.filter((i) => i.id !== item.id))}
                  className="rounded p-1 text-subtle opacity-0 transition-opacity hover:bg-input/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          {items.length < MAX_ITEMS && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addItem(draft);
                setDraft("");
              }}
              className="flex items-center gap-2"
            >
              <input
                value={draft}
                maxLength={200}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={items.length === 0 ? "Qual é a prioridade número 1 de hoje?" : "Mais uma prioridade…"}
                className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label="Adicionar prioridade"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </form>
          )}

          {items.length < MAX_ITEMS && suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-caps">De hoje/atrasadas</span>
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => addItem(t.title, t.id)}
                  title={t.title}
                  className="max-w-[16rem] truncate rounded-full border border-input px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  + {t.title}
                </button>
              ))}
            </div>
          )}

          {items.length > 0 && (
            <div className="border-t pt-3">
              {showReview ? (
                <textarea
                  value={review}
                  rows={2}
                  maxLength={2000}
                  onChange={(e) => {
                    setReview(e.target.value);
                    persist(items, e.target.value);
                  }}
                  placeholder="Revisão do dia: o que andou, o que travou, o que fica para amanhã?"
                  className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowReview(true)}
                  className="flex items-center gap-1.5 text-[13px] text-subtle transition-colors hover:text-foreground"
                >
                  <NotebookPen className="h-3.5 w-3.5" /> Fazer a revisão do dia
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
