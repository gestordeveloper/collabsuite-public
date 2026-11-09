import { useEffect, useState } from "react";
import { Check, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import * as habitService from "@/src/services/habit.service";
import type { Habit, HabitKind, HabitPayload, HealthMetric, TeamBoardHabit, TeamCandidate, TeamHabitPayload } from "@/src/services/habit.service";
import { WEEKDAY_LABELS } from "@/src/lib/habit-templates";
import { ACCENT_COLORS, PINK } from "@/src/lib/design";
import { useAuthStore } from "@/src/store/auth.store";
import { cn } from "@/src/lib/utils";

interface HabitFormModalProps {
  open: boolean;
  /** Hábito pessoal sendo editado (null = criação). */
  habit: Habit | null;
  /** Hábito de equipe sendo editado pelo gestor (a partir do quadro). */
  teamEdit?: TeamBoardHabit | null;
  /** Valores iniciais na criação (ex.: uma rotina pronta). */
  initial?: Partial<HabitPayload> | null;
  /** Abre já com "atribuir à equipe" ligado. */
  startAsTeam?: boolean;
  projects: { id: number; name: string }[];
  onClose: () => void;
  onSubmit: (payload: HabitPayload) => Promise<void>;
  onSubmitTeam?: (payload: TeamHabitPayload, teamId: number | null) => Promise<void>;
  onArchive?: (habit: Habit) => Promise<void>;
  onDelete?: (habit: Habit) => Promise<void>;
  onDeleteTeam?: (team: TeamBoardHabit) => Promise<void>;
}

const HABIT_COLORS = ACCENT_COLORS.slice(0, 7);
const WEEKLY_OPTIONS = [1, 2, 3, 4, 5, 6];

interface FormState {
  name: string;
  description: string;
  color: string;
  target_per_week: number;
  kind: HabitKind;
  project_id: string;
  remind: boolean;
  reminder_time: string;
  reminder_days: number[];
  checklist: string;
  health_metric: HealthMetric | "";
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  color: PINK,
  target_per_week: 7,
  kind: "habit",
  project_id: "",
  remind: false,
  reminder_time: "09:00",
  reminder_days: [],
  checklist: "",
  health_metric: "",
};

function toForm(src: Partial<HabitPayload> & { project_id?: number | null }): FormState {
  return {
    name: src.name ?? "",
    description: src.description ?? "",
    color: src.color ?? PINK,
    target_per_week: src.target_per_week ?? 7,
    kind: src.kind ?? "habit",
    project_id: src.project_id ? String(src.project_id) : "",
    remind: !!src.reminder_time,
    reminder_time: src.reminder_time ?? "09:00",
    reminder_days: src.reminder_days ?? [],
    checklist: (src.checklist ?? []).join("\n"),
    health_metric: src.health_metric ?? "",
  };
}

export function HabitFormModal({
  open, habit, teamEdit, initial, startAsTeam, projects, onClose, onSubmit, onSubmitTeam, onArchive, onDelete, onDeleteTeam,
}: HabitFormModalProps) {
  const me = useAuthStore((s) => s.user);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [assignToTeam, setAssignToTeam] = useState(false);
  const [assignees, setAssignees] = useState<number[]>([]);
  const [candidates, setCandidates] = useState<TeamCandidate[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamAvailable = !!onSubmitTeam && !habit; // atribuir só ao criar (ou ao editar um hábito de equipe)
  const isTeam = teamAvailable && assignToTeam;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (teamEdit) {
      setForm(toForm({ ...teamEdit, project_id: teamEdit.project?.id ?? null }));
      setAssignToTeam(true);
      setAssignees(teamEdit.members.map((m) => m.user.id));
    } else if (habit) {
      setForm(toForm(habit));
      setAssignToTeam(false);
      setAssignees([]);
    } else {
      setForm(initial ? toForm(initial) : EMPTY_FORM);
      setAssignToTeam(!!startAsTeam);
      setAssignees([]);
    }
  }, [open, habit, teamEdit, initial, startAsTeam]);

  useEffect(() => {
    if (open && onSubmitTeam && candidates.length === 0) {
      habitService.fetchTeamCandidates().then(setCandidates).catch(() => {});
    }
  }, [open, onSubmitTeam, candidates.length]);

  async function run(action: () => Promise<void>, fallback: string) {
    setSaving(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || fallback);
    } finally {
      setSaving(false);
    }
  }

  function buildPayload(): HabitPayload {
    const steps = form.checklist.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      name: form.name.trim(),
      description: form.description.trim() || null,
      color: form.color,
      target_per_week: form.target_per_week,
      kind: form.kind,
      project_id: form.project_id ? Number(form.project_id) : null,
      reminder_time: form.remind ? form.reminder_time : null,
      reminder_days: form.remind && form.reminder_days.length ? form.reminder_days : null,
      checklist: steps.length ? steps : null,
      health_metric: form.health_metric || null,
    };
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.name.trim()) {
      setError("Dê um nome.");
      return;
    }
    if (isTeam) {
      if (assignees.length === 0) {
        setError("Escolha ao menos uma pessoa da equipe.");
        return;
      }
      run(() => onSubmitTeam!({ ...buildPayload(), assignee_ids: assignees }, teamEdit?.id ?? null), "Não foi possível salvar.");
      return;
    }
    run(() => onSubmit(buildPayload()), "Não foi possível salvar o hábito.");
  }

  const isDaily = form.target_per_week >= 7;
  const isRoutine = form.kind === "routine";
  const title = teamEdit ? "Editar hábito da equipe" : habit ? "Editar hábito" : isRoutine ? "Nova rotina" : "Novo hábito";

  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, reminder_days: f.reminder_days.includes(d) ? f.reminder_days.filter((x) => x !== d) : [...f.reminder_days, d].sort() }));
  const toggleAssignee = (id: number) => setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col items-start gap-2">
            <Label>Tipo</Label>
            <Segmented
              options={[
                { label: "Hábito", active: !isRoutine, onClick: () => setForm((f) => ({ ...f, kind: "habit" })) },
                { label: "Rotina de trabalho", active: isRoutine, onClick: () => setForm((f) => ({ ...f, kind: "routine" })) },
              ]}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="habit-name">Nome</Label>
            <Input
              id="habit-name"
              autoFocus
              value={form.name}
              maxLength={150}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={isRoutine ? "Ex.: Revisão do backlog" : "Ex.: Beber 2L de água"}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="habit-description">Descrição (opcional)</Label>
            <Input
              id="habit-description"
              value={form.description}
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Ex.: Uma garrafa antes do almoço"
            />
          </div>

          <div className="flex flex-col items-start gap-2">
            <Label>Frequência</Label>
            <Segmented
              options={[
                { label: "Todos os dias", active: isDaily, onClick: () => setForm((f) => ({ ...f, target_per_week: 7 })) },
                { label: "Vezes por semana", active: !isDaily, onClick: () => setForm((f) => ({ ...f, target_per_week: isDaily ? 3 : f.target_per_week })) },
              ]}
            />
            {!isDaily && (
              <div className="flex items-center gap-1.5">
                {WEEKLY_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, target_per_week: n }))}
                    className={cn(
                      "h-8 w-8 rounded-md border font-mono text-[13px] transition-colors",
                      form.target_per_week === n ? "border-primary/50 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {n}x
                  </button>
                ))}
                <span className="ml-1 text-xs text-subtle">por semana</span>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border bg-surface p-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" checked={form.remind} onChange={(e) => setForm((f) => ({ ...f, remind: e.target.checked }))} />
              Lembrar no horário
            </label>
            {form.remind && (
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="time"
                  value={form.reminder_time}
                  onChange={(e) => setForm((f) => ({ ...f, reminder_time: e.target.value }))}
                  className="h-8 w-28"
                  aria-label="Horário do lembrete"
                />
                <div className="flex gap-1">
                  {WEEKDAY_LABELS.map((label, d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      title={label}
                      className={cn(
                        "h-7 rounded-md border px-1.5 text-[11px] transition-colors",
                        form.reminder_days.includes(d) ? "border-primary/50 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-subtle">
                  {form.reminder_days.length ? "nos dias marcados" : "todos os dias"} · horário de Brasília
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="habit-checklist">{isRoutine ? "Passos da rotina" : "Passos (opcional)"}</Label>
            <Textarea
              id="habit-checklist"
              rows={isRoutine ? 5 : 3}
              value={form.checklist}
              onChange={(e) => setForm((f) => ({ ...f, checklist: e.target.value }))}
              placeholder={"Um passo por linha\nEx.: Priorizar o topo do backlog"}
            />
          </div>

          {!isRoutine && !isTeam && (
            <div className="space-y-1.5">
              <Label htmlFor="habit-health">Ligar à Saúde (opcional)</Label>
              <select
                id="habit-health"
                value={form.health_metric}
                onChange={(e) => setForm((f) => ({ ...f, health_metric: e.target.value as HealthMetric | "" }))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none"
              >
                <option value="">Marcar manualmente</option>
                <option value="water">Meta de água do dia</option>
                <option value="steps">Meta de passos do dia</option>
                <option value="sleep">Meta de sono da noite</option>
                <option value="workout">Fez um treino no dia</option>
              </select>
              {form.health_metric && (
                <p className="text-[11px] text-subtle">É marcado sozinho quando a meta é batida na página Saúde.</p>
              )}
            </div>
          )}

          {projects.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="habit-project">Projeto (opcional)</Label>
              <select
                id="habit-project"
                value={form.project_id}
                onChange={(e) => setForm((f) => ({ ...f, project_id: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none"
              >
                <option value="">Sem projeto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col items-start gap-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2 p-0.5">
              {HABIT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Cor ${color}`}
                  onClick={() => setForm((f) => ({ ...f, color }))}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg ring-offset-2 ring-offset-popover transition-shadow",
                    form.color === color ? "ring-2 ring-foreground" : "ring-0"
                  )}
                  style={{ backgroundColor: color }}
                >
                  {form.color === color && <Check className="h-3.5 w-3.5 text-[#0B0B0D]" strokeWidth={3.5} />}
                </button>
              ))}
            </div>
          </div>

          {(teamAvailable || teamEdit) && (
            <div className="space-y-2 rounded-lg border bg-surface p-3">
              {!teamEdit && (
                <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                  <input type="checkbox" checked={assignToTeam} onChange={(e) => setAssignToTeam(e.target.checked)} />
                  <Users className="h-3.5 w-3.5" /> Atribuir à equipe
                </label>
              )}
              {isTeam && (
                <>
                  <p className="text-[11px] text-subtle">
                    Cada pessoa recebe o seu próprio registro, e você acompanha a aderência na aba Equipe. Aparecem pessoas dos seus projetos.
                  </p>
                  {candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma pessoa encontrada nos seus projetos.</p>
                  ) : (
                    <div className="max-h-44 space-y-0.5 overflow-y-auto">
                      {candidates.map((c) => (
                        <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-[13px] hover:bg-accent">
                          <input type="checkbox" checked={assignees.includes(c.id)} onChange={() => toggleAssignee(c.id)} />
                          <UserAvatar user={c} className="h-6 w-6 text-[10px]" />
                          <span className="truncate">
                            {c.first_name} {c.last_name ?? ""}
                            {c.id === me?.id && <span className="ml-1 text-subtle">(você)</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="items-center gap-2 pt-2 sm:justify-between sm:space-x-0">
            <div className="flex gap-2">
              {habit && onArchive && (
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => run(() => onArchive(habit), "Não foi possível arquivar.")}>
                  Arquivar
                </Button>
              )}
              {habit && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    if (!confirm(`Excluir o hábito "${habit.name}" e todo o seu histórico? Essa ação não pode ser desfeita.`)) return;
                    run(() => onDelete(habit), "Não foi possível excluir.");
                  }}
                >
                  Excluir
                </Button>
              )}
              {teamEdit && onDeleteTeam && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    if (!confirm(`Remover "${teamEdit.name}" da equipe? Cada pessoa mantém o hábito como pessoal, com o histórico.`)) return;
                    run(() => onDeleteTeam(teamEdit), "Não foi possível remover.");
                  }}
                >
                  Remover da equipe
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : isTeam && !teamEdit ? "Atribuir" : "Salvar"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Segmented({ options }: { options: { label: string; active: boolean; onClick: () => void }[] }) {
  return (
    <div className="inline-flex gap-1 rounded-[9px] border bg-surface p-[3px]">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={option.onClick}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
            option.active ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
