import { LayoutGrid, Table2, FileText, FileSignature, Workflow, MessageCircle, PenTool, ChevronDown } from "lucide-react";
import { Button } from "@/src/components/ui/button";

export type TaskTemplate = "default" | "spreadsheet" | "form" | "proposal" | "flowchart" | "whatsapp" | "whiteboard";

interface Template {
  id: TaskTemplate;
  label: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
}

const templates: Template[] = [
  {
    id: "default",
    label: "Documento",
    description: "Editor rico estilo Notion com propriedades",
    icon: FileText,
    gradient: "from-indigo-500 to-violet-600",
  },
  {
    id: "spreadsheet",
    label: "Planilha",
    description: "Todas as tarefas do projeto em grade editável",
    icon: Table2,
    gradient: "from-emerald-500 to-teal-600",
  },
  {
    id: "form",
    label: "Formulário",
    description: "Formulário configurável com URL pública",
    icon: LayoutGrid,
    gradient: "from-orange-500 to-rose-600",
  },
  {
    id: "proposal",
    label: "Proposta",
    description: "Proposta comercial em páginas A4",
    icon: FileSignature,
    gradient: "from-violet-500 to-purple-600",
  },
  {
    id: "flowchart",
    label: "Fluxograma",
    description: "Desenhe fluxos de processo com raias, decisões e conexões",
    icon: Workflow,
    gradient: "from-cyan-500 to-blue-600",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "Programe uma mensagem para um grupo, lista ou número específico",
    icon: MessageCircle,
    gradient: "from-emerald-500 to-green-600",
  },
  {
    id: "whiteboard",
    label: "Quadro Branco",
    description: "Desenho livre estilo Excalidraw — formas, texto e anotações",
    icon: PenTool,
    gradient: "from-fuchsia-500 to-pink-600",
  },
];

interface TemplateSelectorProps {
  current: TaskTemplate;
  onChange: (template: TaskTemplate) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  dropSide?: "down" | "up";
  mobileCenter?: boolean;
}

export function TemplateSelector({ current, onChange, open, setOpen, dropSide = "down", mobileCenter = false }: TemplateSelectorProps) {
  const active = templates.find((t) => t.id === current) ?? templates[0];
  const ActiveIcon = active.icon;

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="gap-2 h-8"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        title="Mudar tipo de visualização"
      >
        <ActiveIcon className="h-3.5 w-3.5" />
        <span className={`${mobileCenter ? "inline" : "hidden sm:inline"} text-xs`}>{active.label}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} />
          <div
            className={
              mobileCenter
                ? "fixed left-1/2 z-50 w-[calc(100vw-2rem)] max-w-72 -translate-x-1/2 rounded-xl border bg-popover p-2 shadow-xl"
                : dropSide === "up"
                  ? "absolute right-0 bottom-10 z-50 w-72 rounded-xl border bg-popover p-2 shadow-xl"
                  : "absolute right-0 top-10 z-50 w-72 rounded-xl border bg-popover p-2 shadow-xl"
            }
            style={mobileCenter ? { bottom: "calc(8rem + env(safe-area-inset-bottom))" } : undefined}
          >
            <p className="mb-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Tipo de página
            </p>
            {templates.map((tmpl) => {
              const Icon = tmpl.icon;
              const isActive = tmpl.id === current;
              return (
                <button
                  key={tmpl.id}
                  onClick={() => {
                    onChange(tmpl.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                    isActive ? "bg-accent" : ""
                  }`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${tmpl.gradient} text-white flex-shrink-0`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{tmpl.label}</span>
                      {isActive && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          Ativo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{tmpl.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
