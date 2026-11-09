import { Clock, ListChecks, User, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { PO_TEMPLATES, formatReminderDays, type HabitTemplate } from "@/src/lib/habit-templates";
import { hexA } from "@/src/lib/design";

interface Props {
  open: boolean;
  onClose: () => void;
  /** "me" cria direto para o usuário; "team" abre o formulário já pré-preenchido para atribuir. */
  onPick: (template: HabitTemplate, mode: "me" | "team") => void;
  /** Ids de rotinas que o usuário já tem (mostra "já adicionada"). */
  ownedNames: string[];
}

/** Catálogo de rotinas prontas para PO: cada uma já traz dias, horário de lembrete e passos. */
export function RoutineTemplatesDialog({ open, onClose, onPick, ownedNames }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rotinas prontas para PO</DialogTitle>
          <DialogDescription>
            Escolha uma rotina para você ou para a equipe. Você ajusta horário, dias e passos antes de salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PO_TEMPLATES.map((t) => {
            const owned = ownedNames.includes(t.payload.name);
            const p = t.payload;
            return (
              <div key={t.id} className="flex flex-col gap-3 rounded-xl border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: p.color }} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-semibold">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.blurb}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
                  <span>{p.target_per_week && p.target_per_week >= 7 ? "Diário" : `${p.target_per_week}x por semana`}</span>
                  {p.reminder_time && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {p.reminder_time} · {formatReminderDays(p.reminder_days ?? null)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="h-3 w-3" /> {p.checklist.length} passos
                  </span>
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={owned} onClick={() => onPick(t, "me")}>
                    <User className="h-3.5 w-3.5" /> {owned ? "Já adicionada" : "Para mim"}
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    style={{ backgroundColor: hexA(p.color ?? "#EC1889", 1) }}
                    onClick={() => onPick(t, "team")}
                  >
                    <Users className="h-3.5 w-3.5" /> Para a equipe
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
