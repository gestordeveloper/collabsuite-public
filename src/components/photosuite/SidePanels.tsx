import { useState } from "react";
import { ArrowLeftRight, History, Palette } from "lucide-react";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { findLayer } from "@/src/lib/photosuite/tree";
import { ADJUSTMENT_LABELS } from "@/src/lib/photosuite/adjustments";
import { AdjustmentEditor } from "./AdjustmentEditor";
import { ShapeStyleControls } from "./ShapeControls";
import { TextControls } from "./TextControls";
import { LayersPanel } from "./LayersPanel";
import { cn } from "@/src/lib/utils";

function ColorPanel() {
  const fg = usePhotosuite((s) => s.fg);
  const bg = usePhotosuite((s) => s.bg);
  const setFg = usePhotosuite((s) => s.setFg);
  const setBg = usePhotosuite((s) => s.setBg);
  const swap = usePhotosuite((s) => s.swapColors);
  const reset = usePhotosuite((s) => s.resetColors);

  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
      <div className="relative h-10 w-12 shrink-0">
        <label className="absolute bottom-0 right-0 h-6 w-6 cursor-pointer overflow-hidden rounded-sm border border-border" style={{ background: bg }} title="Cor de fundo">
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-0 w-0 opacity-0" />
        </label>
        <label className="absolute left-0 top-0 z-10 h-6 w-6 cursor-pointer overflow-hidden rounded-sm border-2 border-white/80" style={{ background: fg }} title="Cor de frente">
          <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="h-0 w-0 opacity-0" />
        </label>
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <button onClick={swap} className="flex items-center gap-1 hover:text-foreground" title="Trocar cores (X)">
          <ArrowLeftRight className="h-3 w-3" /> Trocar
        </button>
        <button onClick={reset} className="text-left hover:text-foreground" title="Cores padrão (D)">
          Padrão
        </button>
      </div>
      <div className="ml-auto font-mono text-[11px] uppercase text-muted-foreground">{fg}</div>
    </div>
  );
}

function HistoryPanel() {
  const past = usePhotosuite((s) => s.past);
  const future = usePhotosuite((s) => s.future);
  const undo = usePhotosuite((s) => s.undo);
  const redo = usePhotosuite((s) => s.redo);

  // Clicar num passo desfaz/refaz até ele.
  const steps = [
    { label: "Documento aberto", index: -1 },
    ...past.map((e, i) => ({ label: e.label, index: i })),
    ...future.map((e, i) => ({ label: e.label, index: past.length + i })),
  ];
  const current = past.length - 1;

  function goTo(index: number) {
    let delta = index - current;
    while (delta < 0) {
      undo();
      delta++;
    }
    while (delta > 0) {
      redo();
      delta--;
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {steps.map((s) => (
        <button
          key={s.index}
          onClick={() => goTo(s.index)}
          className={cn(
            "block w-full truncate border-b border-border/40 px-3 py-1.5 text-left text-xs",
            s.index === current ? "bg-primary/15 text-foreground" : s.index > current ? "text-muted-foreground/50" : "text-muted-foreground hover:bg-accent/60",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** Parâmetros da camada de ajuste ativa. */
function AdjustmentProperties() {
  const layers = usePhotosuite((s) => s.layers);
  const activeId = usePhotosuite((s) => s.activeId);
  const setAdjustment = usePhotosuite((s) => s.setAdjustment);
  const layer = activeId ? findLayer(layers, activeId)?.layer : null;
  if (!layer || layer.type !== "raster" || !layer.adjustment) {
    return <div className="p-4 text-xs text-muted-foreground">Selecione uma camada de ajuste para editar os parâmetros.</div>;
  }
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="text-xs font-semibold">{ADJUSTMENT_LABELS[layer.adjustment.kind]}</div>
      <AdjustmentEditor key={layer.id} adjustment={layer.adjustment} layerId={layer.id} onChange={(a) => setAdjustment(layer.id, a)} />
    </div>
  );
}

/** Propriedades da camada de texto ou de forma ativa (como o painel Propriedades do Photoshop). */
function VectorProperties() {
  const layers = usePhotosuite((s) => s.layers);
  const activeId = usePhotosuite((s) => s.activeId);
  const rasterize = usePhotosuite((s) => s.rasterizeLayer);
  const layer = activeId ? findLayer(layers, activeId)?.layer : null;
  if (!layer || layer.type !== "raster" || (!layer.text && !layer.shape)) return null;
  return (
    <div className="flex max-h-[55%] shrink-0 flex-col border-t border-border">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{layer.text ? "Texto" : "Forma"}</span>
          <button className="text-[11px] text-muted-foreground underline hover:text-foreground" onClick={() => rasterize(layer.id)} title="Converte em pixels para poder pintar e filtrar">
            Rasterizar
          </button>
        </div>
        {layer.text ? <TextControls layout="panel" /> : <ShapeStyleControls layout="panel" />}
      </div>
    </div>
  );
}

export function SidePanels() {
  const [tab, setTab] = useState<"layers" | "history">("layers");
  const layers = usePhotosuite((s) => s.layers);
  const activeId = usePhotosuite((s) => s.activeId);
  const active = activeId ? findLayer(layers, activeId)?.layer : null;
  const isAdjustment = active?.type === "raster" && !!active.adjustment;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Palette className="h-3.5 w-3.5" /> Cor
      </div>
      <ColorPanel />
      <div className="flex border-b border-border">
        {([
          ["layers", "Camadas"],
          ["history", "Histórico"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors",
              tab === id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {id === "history" && <History className="h-3.5 w-3.5" />}
            {label}
          </button>
        ))}
      </div>
      {tab === "layers" ? (
        <>
          <LayersPanel />
          {/* parâmetros da camada de ajuste ativa, logo abaixo da lista (como o painel Propriedades do Photoshop) */}
          {isAdjustment && (
            <div className="flex max-h-[55%] shrink-0 flex-col border-t border-border">
              <AdjustmentProperties />
            </div>
          )}
          <VectorProperties />
        </>
      ) : (
        <HistoryPanel />
      )}
    </aside>
  );
}
