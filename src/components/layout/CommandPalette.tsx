import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, CheckSquare, FolderKanban } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { useDashboard } from "@/src/context/dashboard.context";
import { NAV_SECTIONS } from "./nav-items";
import { cn } from "@/src/lib/utils";

/** Minúsculas e sem acentos, para "hab" encontrar "Hábitos". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  run: () => void;
}

/** Busca global (Ctrl/Cmd + K): navega entre telas e localiza tarefas e projetos já carregados. */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { tasks, projects, funnels, setSelectedFunnelId } = useDashboard();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const q = fold(query.trim());
    const close = () => onOpenChange(false);
    const list: Command[] = [];

    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (item.external) continue;
        if (q && !fold(item.label).includes(q)) continue;
        list.push({
          id: `nav:${item.to}`,
          group: "Ir para",
          label: item.label,
          icon: item.icon,
          run: () => { navigate(item.to); close(); },
        });
      }
    }

    if (q) {
      projects
        .filter((p) => fold(p.name).includes(q))
        .slice(0, 5)
        .forEach((p) => {
          const defaultFunnel = p.funnels.find((f) => f.is_default) || p.funnels[0];
          list.push({
            id: `project:${p.id}`,
            group: "Projetos",
            label: p.name,
            icon: FolderKanban,
            color: p.color ?? undefined,
            run: () => {
              if (defaultFunnel) setSelectedFunnelId(defaultFunnel.id);
              navigate("/kanban");
              close();
            },
          });
        });

      tasks
        .filter((t) => !t.deleted_at && (fold(t.title).includes(q) || String(t.id) === q))
        .slice(0, 8)
        .forEach((t) => {
          const funnel = funnels.find((f) => f.id === t.funnel_id);
          list.push({
            id: `task:${t.id}`,
            group: "Tarefas",
            label: t.title,
            hint: funnel?.prefix ? `${funnel.prefix}-${t.id}` : `#${t.id}`,
            icon: CheckSquare,
            run: () => { navigate(`/task/${t.id}`); close(); },
          });
        });
    }
    return list;
  }, [query, tasks, projects, funnels, navigate, onOpenChange, setSelectedFunnelId]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commands[active]?.run();
    }
  }

  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">Busca global</DialogTitle>
        <DialogDescription className="sr-only">Pesquise telas, tarefas e projetos.</DialogDescription>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar telas, tarefas e projetos..."
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <kbd className="rounded border border-input px-1.5 py-0.5 font-mono text-[11px] text-subtle">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-2">
          {commands.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nada encontrado para &ldquo;{query}&rdquo;.</p>
          ) : (
            commands.map((cmd, index) => {
              const showGroup = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              return (
                <div key={cmd.id}>
                  {showGroup && <p className="label-caps px-3 pb-1 pt-3 first:pt-1">{cmd.group}</p>}
                  <button
                    type="button"
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={cmd.run}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      index === active ? "bg-border/70 text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <cmd.icon className={cn("h-4 w-4 shrink-0", index === active && !cmd.color && "text-primary")} />
                    {cmd.color && <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: cmd.color }} />}
                    <span className="flex-1 truncate">{cmd.label}</span>
                    {cmd.hint && <span className="font-mono text-[11px] text-subtle">{cmd.hint}</span>}
                    {index === active && <CornerDownLeft className="h-3.5 w-3.5 text-subtle" />}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
