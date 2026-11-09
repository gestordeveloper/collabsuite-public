import { useState } from "react";
import { useNodes, useReactFlow } from "@xyflow/react";
import {
  Workflow,
  Square,
  Diamond,
  Rows3,
  Plus,
  Minus,
  ChevronUp,
  ChevronDown,
  Trash2,
  Check,
  Download,
  Loader2,
  Image as ImageIcon,
  FileText,
  ArrowLeftRight,
  SquareStack,
  StickyNote,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/src/components/ui/dropdown-menu";
import { LANE_COLOR_PRESETS, getLaneColorPreset, type FlowLane, type FlowNodeKind } from "./types";
import { downloadFlowchartPdf, downloadFlowchartPng } from "./export";

let laneCounter = 0;
function nextLaneId() {
  laneCounter += 1;
  return `lane-${Date.now()}-${laneCounter}`;
}

interface FlowchartToolbarProps {
  title: string;
  onAddNode: (kind: FlowNodeKind) => void;
  lanes: FlowLane[];
  onLanesChange: (lanes: FlowLane[]) => void;
  onDeleteSelection: () => void;
  hasSelection: boolean;
  readOnly?: boolean;
}

function ExportMenu({ title, lanes }: { title: string; lanes: FlowLane[] }) {
  const instance = useReactFlow();
  const nodes = useNodes();
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);

  const handleExport = async (kind: "png" | "pdf") => {
    setExporting(kind);
    try {
      if (kind === "pdf") await downloadFlowchartPdf(instance, lanes, title);
      else await downloadFlowchartPng(instance, lanes, title);
    } catch (err) {
      console.error("Export flowchart error", err);
      window.alert(err instanceof Error ? err.message : "Não foi possível exportar o fluxograma.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={nodes.length === 0 || exporting !== null}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("png")}>
          <ImageIcon className="h-4 w-4" /> Baixar PNG
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("pdf")}>
          <FileText className="h-4 w-4" /> Baixar PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FlowchartToolbar({
  title,
  onAddNode,
  lanes,
  onLanesChange,
  onDeleteSelection,
  hasSelection,
  readOnly = false,
}: FlowchartToolbarProps) {
  const [lanesOpen, setLanesOpen] = useState(false);

  const addLane = () => {
    const color = LANE_COLOR_PRESETS[lanes.length % LANE_COLOR_PRESETS.length].id;
    onLanesChange([...lanes, { id: nextLaneId(), label: `Raia ${lanes.length + 1}`, height: 160, color }]);
  };
  const renameLane = (id: string, label: string) => {
    onLanesChange(lanes.map((l) => (l.id === id ? { ...l, label } : l)));
  };
  const recolorLane = (id: string, color: string) => {
    onLanesChange(lanes.map((l) => (l.id === id ? { ...l, color } : l)));
  };
  const resizeLane = (id: string, delta: number) => {
    onLanesChange(lanes.map((l) => (l.id === id ? { ...l, height: Math.max(80, l.height + delta) } : l)));
  };
  const removeLane = (id: string) => {
    onLanesChange(lanes.filter((l) => l.id !== id));
  };
  const moveLane = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= lanes.length) return;
    const next = [...lanes];
    [next[index], next[target]] = [next[target], next[index]];
    onLanesChange(next);
  };

  if (readOnly) {
    return (
      <div className="flex items-center justify-between border-b bg-background/95 px-3 py-2">
        <span className="text-xs text-muted-foreground">Visualização de fluxograma</span>
        <ExportMenu title={title} lanes={lanes} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddNode("terminal")} title="Adicionar início/fim">
          <Workflow className="h-3.5 w-3.5" /> Início/Fim
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddNode("process")} title="Adicionar processo">
          <Square className="h-3.5 w-3.5" /> Processo
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddNode("decision")} title="Adicionar decisão">
          <Diamond className="h-3.5 w-3.5" /> Decisão
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddNode("io")} title="Adicionar entrada/saída">
          <ArrowLeftRight className="h-3.5 w-3.5" /> Entrada/Saída
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddNode("document")} title="Adicionar documento">
          <FileText className="h-3.5 w-3.5" /> Documento
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddNode("subprocess")} title="Adicionar subprocesso">
          <SquareStack className="h-3.5 w-3.5" /> Subprocesso
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddNode("annotation")} title="Adicionar anotação">
          <StickyNote className="h-3.5 w-3.5" /> Anotação
        </Button>
      </div>

      <Popover open={lanesOpen} onOpenChange={setLanesOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Rows3 className="h-3.5 w-3.5" /> Raias ({lanes.length})
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raias / setores</p>
          {lanes.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma raia ainda — o fluxograma é exibido de forma simples (linear). Adicione raias para organizar por setor
              (ex.: Vendas, Financeiro, Expedição).
            </p>
          )}
          {lanes.length > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {lanes.map((lane, index) => {
                const activePreset = getLaneColorPreset(lane.color);
                return (
                  <div key={lane.id} className="space-y-1.5 rounded-md border p-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="flex flex-col">
                        <button
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={index === 0}
                          onClick={() => moveLane(index, -1)}
                          title="Mover para cima"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={index === lanes.length - 1}
                          onClick={() => moveLane(index, 1)}
                          title="Mover para baixo"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-full border"
                        style={{ backgroundColor: activePreset.fill, borderColor: activePreset.accent }}
                      />
                      <Input value={lane.label} onChange={(e) => renameLane(lane.id, e.target.value)} className="h-7 flex-1 text-xs" />
                      <div className="flex items-center gap-0.5">
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          onClick={() => resizeLane(lane.id, -20)}
                          title="Diminuir altura"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          onClick={() => resizeLane(lane.id, 20)}
                          title="Aumentar altura"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <button
                        className="rounded p-1 text-destructive hover:bg-destructive/10"
                        onClick={() => removeLane(lane.id)}
                        title="Remover raia"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 pl-5">
                      {LANE_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => recolorLane(lane.id, preset.id)}
                          title={preset.label}
                          className="flex h-5 w-5 items-center justify-center rounded-full border transition-transform hover:scale-110"
                          style={{ backgroundColor: preset.fill, borderColor: preset.accent }}
                        >
                          {lane.color === preset.id && <Check className="h-3 w-3" style={{ color: preset.accent }} />}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={addLane}>
            <Plus className="h-3.5 w-3.5" /> Nova raia
          </Button>
        </PopoverContent>
      </Popover>

      {hasSelection && (
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={onDeleteSelection}>
          <Trash2 className="h-3.5 w-3.5" /> Excluir seleção
        </Button>
      )}

      <div className="ml-auto">
        <ExportMenu title={title} lanes={lanes} />
      </div>
    </div>
  );
}
