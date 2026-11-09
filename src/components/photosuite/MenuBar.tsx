import { useState } from "react";
import { ArrowLeft, Check, Cloud, CloudOff, Loader2, Redo2, Undo2 } from "lucide-react";
import { CanvasSizeDialog, ImageSizeDialog } from "./SizeDialogs";
import { ApplyAdjustmentDialog, FilterDialog } from "./FilterDialogs";
import { ADJUSTMENT_LABELS, ADJUSTMENT_ORDER } from "@/src/lib/photosuite/adjustments";
import { FILTERS, type FilterId } from "@/src/lib/photosuite/filters";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { findLayer } from "@/src/lib/photosuite/tree";
import type { ExportFormat } from "@/src/lib/photosuite/session";
import type { VectorExportFormat } from "@/src/lib/photosuite/formats";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/src/components/ui/tooltip";

export type SaveState = "saved" | "saving" | "dirty" | "error";

interface Props {
  onBack: () => void;
  onSave: () => void;
  onExport: (format: ExportFormat | VectorExportFormat) => void;
  onOpenImage: () => void;
  onShare: () => void;
  saveState: SaveState;
}

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded px-2.5 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const STATE_LABEL: Record<SaveState, string> = {
  saved: "Salvo",
  saving: "Salvando…",
  dirty: "Alterações não salvas",
  error: "Falha ao salvar",
};

/** Pede um número ao usuário (raios de pena/expandir/contrair). */
function askNumber(message: string, initial: number, apply: (v: number) => void) {
  const raw = window.prompt(message, String(initial));
  if (raw === null) return;
  const v = Number(raw.replace(",", "."));
  if (Number.isFinite(v) && v > 0) apply(v);
}

export function MenuBar({ onBack, onSave, onExport, onOpenImage, onShare, saveState }: Props) {
  const s = usePhotosuite();
  const [dialog, setDialog] = useState<"image" | "canvas" | null>(null);
  const [filter, setFilter] = useState<FilterId | null>(null);
  const [applyAdj, setApplyAdj] = useState(false);
  const active = s.activeId ? findLayer(s.layers, s.activeId)?.layer ?? null : null;
  const raster = active?.type === "raster" ? active : null;
  const group = active?.type === "group" ? active : null;
  /** camada de pixels editável (filtros e ajustes destrutivos) */
  const pixelLayer = !!raster && !raster.adjustment && !raster.locked;
  const filterGroups = FILTERS.reduce<Record<string, typeof FILTERS>>((acc, f) => ((acc[f.group] ??= []).push(f), acc), {});

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Voltar para documentos</TooltipContent>
      </Tooltip>

      <span className="mx-1 font-display text-sm font-semibold tracking-tight">Photosuite</span>

      <Menu label="Arquivo">
        <DropdownMenuItem onClick={onSave}>
          Salvar <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onShare}>Compartilhar / anexar a tarefa…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenImage}>
          Inserir arquivo como camadas… <DropdownMenuShortcut>PSD · SVG · imagem</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onExport("png")}>Exportar como PNG</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("jpeg")}>Exportar como JPEG</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("webp")}>Exportar como WebP</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onExport("psd")}>Exportar como PSD (camadas)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("svg")}>Exportar como SVG</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("photosuite")}>Salvar cópia (.photosuite)</DropdownMenuItem>
      </Menu>

      <Menu label="Editar">
        <DropdownMenuItem disabled={!s.past.length} onClick={s.undo}>
          Desfazer <DropdownMenuShortcut>Ctrl+Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.future.length} onClick={s.redo}>
          Refazer <DropdownMenuShortcut>Ctrl+Shift+Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!raster} onClick={() => s.copySelection({ merged: false, cut: true })}>
          Recortar <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.copySelection({ merged: false, cut: false })}>
          Copiar <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.copySelection({ merged: true, cut: false })}>
          Copiar mesclado <DropdownMenuShortcut>Ctrl+Shift+C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.fillSelection("fg")}>
          Preencher com a cor de frente <DropdownMenuShortcut>Alt+Backspace</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.fillSelection("bg")}>
          Preencher com a cor de fundo <DropdownMenuShortcut>Ctrl+Backspace</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster || !s.hasSelection} onClick={s.clearSelection}>
          Limpar <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!raster} onClick={s.startTransform}>
          Transformação livre <DropdownMenuShortcut>Ctrl+T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.flipLayer("h")}>Espelhar camada horizontalmente</DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.flipLayer("v")}>Espelhar camada verticalmente</DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.rotateLayer(90)}>Girar camada 90° horário</DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.rotateLayer(-90)}>Girar camada 90° anti-horário</DropdownMenuItem>
        <DropdownMenuItem disabled={!raster} onClick={() => s.rotateLayer(180)}>Girar camada 180°</DropdownMenuItem>
      </Menu>

      <Menu label="Selecionar">
        <DropdownMenuItem onClick={s.selectAll}>
          Tudo <DropdownMenuShortcut>Ctrl+A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.hasSelection} onClick={s.deselect}>
          Desmarcar <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.hasSelection} onClick={s.invertSelection}>
          Inverter <DropdownMenuShortcut>Ctrl+Shift+I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!s.hasSelection} onClick={() => askNumber("Raio da pena (px):", 5, s.featherSelection)}>
          Suavizar bordas…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.hasSelection} onClick={() => askNumber("Expandir em (px):", 5, (v) => s.growSelection(v, true))}>
          Expandir…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.hasSelection} onClick={() => askNumber("Contrair em (px):", 5, (v) => s.growSelection(v, false))}>
          Contrair…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!raster || !s.hasSelection} onClick={() => s.layerViaCopy(false)}>
          Camada via cópia <DropdownMenuShortcut>Ctrl+J</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster || !s.hasSelection} onClick={() => s.layerViaCopy(true)}>
          Camada via recorte <DropdownMenuShortcut>Ctrl+Shift+J</DropdownMenuShortcut>
        </DropdownMenuItem>
      </Menu>

      <Menu label="Imagem">
        <DropdownMenuItem onClick={() => setDialog("image")}>Tamanho da imagem…</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDialog("canvas")}>Tamanho da tela…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => s.rotateCanvas("cw")}>Girar tela 90° horário</DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.rotateCanvas("ccw")}>Girar tela 90° anti-horário</DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.rotateCanvas("180")}>Girar tela 180°</DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.flipCanvas("h")}>Espelhar tela horizontalmente</DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.flipCanvas("v")}>Espelhar tela verticalmente</DropdownMenuItem>
      </Menu>

      <Menu label="Camada">
        <DropdownMenuItem onClick={s.addLayer}>
          Nova camada <DropdownMenuShortcut>Ctrl+Shift+N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!active} onClick={() => s.duplicateLayer()}>
          Duplicar camada <DropdownMenuShortcut>Ctrl+J</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!active} onClick={s.deleteSelected}>
          Excluir camada <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!active} onClick={s.groupSelected}>
          Agrupar camadas <DropdownMenuShortcut>Ctrl+G</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!group} onClick={() => group && s.ungroup(group.id)}>
          Desagrupar <DropdownMenuShortcut>Ctrl+Shift+G</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!raster || !!raster.mask} onClick={() => raster && s.addMask(raster.id, true)}>
          Máscara: revelar tudo
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster || !!raster.mask} onClick={() => raster && s.addMask(raster.id, false)}>
          Máscara: esconder tudo
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster?.mask} onClick={() => raster && s.applyMask(raster.id)}>
          Aplicar máscara
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster?.mask} onClick={() => raster && s.deleteMask(raster.id)}>
          Excluir máscara
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!active} onClick={() => active && s.moveLayerBy(active.id, 1)}>
          Trazer para frente
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!active} onClick={() => active && s.moveLayerBy(active.id, -1)}>
          Enviar para trás
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!raster || !!raster.adjustment} onClick={() => s.setStyleDialogOpen(true)}>
          Estilo de camada…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!raster || (!raster.text && !raster.shape)} onClick={() => s.rasterizeLayer()}>
          Rasterizar camada
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!raster} onClick={s.mergeDown}>
          Mesclar para baixo <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={s.stampVisible}>
          Carimbar visível <DropdownMenuShortcut>Ctrl+Alt+Shift+E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={s.flatten}>Achatar imagem</DropdownMenuItem>
      </Menu>

      <Menu label="Ajustes">
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nova camada de ajuste</DropdownMenuLabel>
        {ADJUSTMENT_ORDER.map((k) => (
          <DropdownMenuItem key={k} onClick={() => s.addAdjustmentLayer(k)}>
            {ADJUSTMENT_LABELS[k]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!pixelLayer} onClick={() => setApplyAdj(true)}>
          Aplicar ajuste à camada…
        </DropdownMenuItem>
      </Menu>

      <Menu label="Filtro">
        {Object.entries(filterGroups).map(([groupName, items], gi) => (
          <div key={groupName}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{groupName}</DropdownMenuLabel>
            {items.map((f) => (
              <DropdownMenuItem key={f.id} disabled={!pixelLayer} onClick={() => setFilter(f.id)}>
                {f.label}
                {f.params.length > 0 ? "…" : ""}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </Menu>

      <Menu label="Visualizar">
        <DropdownMenuItem onClick={() => s.requestView("in")}>
          Ampliar <DropdownMenuShortcut>Ctrl++</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.requestView("out")}>
          Reduzir <DropdownMenuShortcut>Ctrl+-</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.requestView("fit")}>
          Ajustar à tela <DropdownMenuShortcut>Ctrl+0</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => s.requestView("actual")}>
          Tamanho real <DropdownMenuShortcut>Ctrl+1</DropdownMenuShortcut>
        </DropdownMenuItem>
      </Menu>

      <div className="mx-2 flex items-center">
        <input
          value={s.name}
          onChange={(e) => s.setName(e.target.value)}
          className="h-7 w-56 rounded bg-transparent px-2 text-center text-sm font-medium outline-none hover:bg-accent/60 focus:bg-secondary focus:ring-1 focus:ring-primary"
          aria-label="Nome do documento"
        />
        <span className="ml-1 text-[11px] text-muted-foreground">{s.width}×{s.height}</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button disabled={!s.past.length} onClick={s.undo} className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30" aria-label="Desfazer">
              <Undo2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Desfazer (Ctrl+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button disabled={!s.future.length} onClick={s.redo} className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30" aria-label="Refazer">
              <Redo2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refazer (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>
        <button
          onClick={onSave}
          className="ml-2 flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Salvar (Ctrl+S)"
        >
          {saveState === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveState === "error" ? <CloudOff className="h-3.5 w-3.5 text-destructive" /> : saveState === "saved" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Cloud className="h-3.5 w-3.5" />}
          {STATE_LABEL[saveState]}
        </button>
      </div>
      <FilterDialog filterId={filter} onClose={() => setFilter(null)} />
      <ApplyAdjustmentDialog open={applyAdj} onClose={() => setApplyAdj(false)} />
      <ImageSizeDialog open={dialog === "image"} onOpenChange={(o) => setDialog(o ? "image" : null)} />
      <CanvasSizeDialog open={dialog === "canvas"} onOpenChange={(o) => setDialog(o ? "canvas" : null)} />
    </header>
  );
}
