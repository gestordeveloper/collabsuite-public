import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, Copy, Eye, EyeOff, Folder, FolderPlus, Layers, Lock, LockOpen, Plus, SlidersHorizontal, Sparkles, Trash2, VenetianMask,
} from "lucide-react";
import { getPixels, maskKey } from "@/src/lib/photosuite/engine";
import { findLayer } from "@/src/lib/photosuite/tree";
import { hasStyles } from "@/src/lib/photosuite/effects";
import { BLEND_GROUPS, BLEND_LABELS, type BlendMode, type GroupLayer, type Layer, type RasterLayer } from "@/src/lib/photosuite/types";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/src/components/ui/tooltip";
import { cn } from "@/src/lib/utils";

/** Miniatura que reflete o canvas da camada (redesenhada quando a revisão muda). */
function Thumb({ cacheKey, revision, checker = true }: { cacheKey: string; revision: number; checker?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const src = getPixels(cacheKey);
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!src) return;
    const scale = Math.min(c.width / src.width, c.height / src.height);
    const w = src.width * scale;
    const h = src.height * scale;
    const x = (c.width - w) / 2;
    const y = (c.height - h) / 2;
    if (checker) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#cfcfcf";
      for (let cy = 0; cy * 6 < h; cy++) for (let cx = cy % 2; cx * 6 < w; cx += 2) ctx.fillRect(x + cx * 6, y + cy * 6, Math.min(6, w - cx * 6), Math.min(6, h - cy * 6));
    }
    ctx.drawImage(src, x, y, w, h);
  }, [cacheKey, revision, checker]);
  return <canvas ref={ref} width={40} height={40} className="h-10 w-10 shrink-0 rounded-sm border border-border bg-black/30" />;
}

/** Miniatura da máscara: o alfa vira cinza (branco = revela). */
function MaskThumb({ layerId, revision }: { layerId: string; revision: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const src = getPixels(maskKey(layerId));
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!src) return;
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }, [layerId, revision]);
  return <canvas ref={ref} width={40} height={40} className="h-10 w-10 shrink-0 rounded-sm border border-border" />;
}

type DropPos = "above" | "below" | "inside";

function LayerRow({ layer, depth, revision }: { layer: Layer; depth: number; revision: number }) {
  const activeId = usePhotosuite((s) => s.activeId);
  const selectedIds = usePhotosuite((s) => s.selectedIds);
  const target = usePhotosuite((s) => s.target);
  const select = usePhotosuite((s) => s.selectLayer);
  const setTarget = usePhotosuite((s) => s.setTarget);
  const update = usePhotosuite((s) => s.updateLayer);
  const moveLayer = usePhotosuite((s) => s.moveLayer);
  const [drop, setDrop] = useState<DropPos | null>(null);
  const [editing, setEditing] = useState(false);

  const selected = selectedIds.includes(layer.id);
  const isActive = activeId === layer.id;
  const raster = layer.type === "raster" ? (layer as RasterLayer) : null;

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientY - r.top) / r.height;
    setDrop(layer.type === "group" && rel > 0.3 && rel < 0.7 ? "inside" : rel < 0.5 ? "above" : "below");
  }

  return (
    <>
      <div
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/photosuite-layer", layer.id)}
        onDragOver={onDragOver}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/photosuite-layer");
          if (id && drop) moveLayer(id, layer.id, drop);
          setDrop(null);
        }}
        onClick={(e) => select(layer.id, e.ctrlKey || e.metaKey || e.shiftKey)}
        className={cn(
          "relative flex cursor-pointer items-center gap-1.5 border-b border-border/40 py-1 pr-1.5 text-xs",
          selected ? "bg-primary/15" : "hover:bg-accent/60",
          isActive && "ring-1 ring-inset ring-primary/60",
          drop === "above" && "shadow-[inset_0_2px_0_0_var(--primary)]",
          drop === "below" && "shadow-[inset_0_-2px_0_0_var(--primary)]",
          drop === "inside" && "bg-primary/25",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            update(layer.id, { visible: !layer.visible }, { label: layer.visible ? "Ocultar camada" : "Mostrar camada" });
          }}
          aria-label={layer.visible ? "Ocultar camada" : "Mostrar camada"}
        >
          {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-50" />}
        </button>

        {layer.type === "group" ? (
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              update(layer.id, { collapsed: !(layer as GroupLayer).collapsed } as Partial<Layer>, { label: "Recolher grupo" });
            }}
          >
            {(layer as GroupLayer).collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}

        {layer.type === "group" ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-secondary">
            <Folder className="h-4 w-4 text-muted-foreground" />
          </div>
        ) : raster?.adjustment ? (
          <button
            className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-secondary", isActive && target === "layer" && "ring-2 ring-primary")}
            onClick={(e) => {
              e.stopPropagation();
              select(layer.id);
              setTarget("layer");
            }}
            title="Camada de ajuste"
          >
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          </button>
        ) : (
          <button
            className={cn("rounded-sm", isActive && target === "layer" && "ring-2 ring-primary")}
            onClick={(e) => {
              e.stopPropagation();
              select(layer.id);
              setTarget("layer");
            }}
          >
            <Thumb cacheKey={layer.id} revision={revision} />
          </button>
        )}

        {raster?.mask && (
          <button
            className={cn("rounded-sm", isActive && target === "mask" && "ring-2 ring-primary", !raster.mask.enabled && "opacity-40")}
            onClick={(e) => {
              e.stopPropagation();
              select(layer.id);
              setTarget("mask");
            }}
            title="Máscara de camada"
          >
            <MaskThumb layerId={layer.id} revision={revision} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              defaultValue={layer.name}
              className="w-full rounded bg-background px-1 text-xs outline-none ring-1 ring-primary"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                setEditing(false);
                const name = e.target.value.trim();
                if (name && name !== layer.name) update(layer.id, { name }, { label: "Renomear camada" });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <div className="truncate" onDoubleClick={() => setEditing(true)}>
              {layer.name}
            </div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {raster?.text ? "Texto · " : raster?.shape ? "Forma · " : ""}
            {BLEND_LABELS[layer.blend]} · {Math.round(layer.opacity * 100)}%
            {raster && hasStyles(raster.styles) && <Sparkles className="h-2.5 w-2.5 text-primary" aria-label="Tem estilos de camada" />}
          </div>
        </div>

        <button
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            update(layer.id, { locked: !layer.locked }, { label: layer.locked ? "Destravar camada" : "Travar camada" });
          }}
          aria-label="Travar camada"
        >
          {layer.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3 opacity-30" />}
        </button>
      </div>

      {layer.type === "group" && !layer.collapsed &&
        [...layer.children].reverse().map((c) => <LayerRow key={c.id} layer={c} depth={depth + 1} revision={revision} />)}
    </>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          aria-label={label}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function LayersPanel() {
  const layers = usePhotosuite((s) => s.layers);
  const activeId = usePhotosuite((s) => s.activeId);
  const revision = usePhotosuite((s) => s.revision);
  const s = usePhotosuite();

  const active = activeId ? findLayer(layers, activeId)?.layer ?? null : null;
  const raster = active?.type === "raster" ? active : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <select
          value={active?.blend ?? "normal"}
          disabled={!active}
          onChange={(e) => active && s.updateLayer(active.id, { blend: e.target.value as BlendMode }, { label: "Modo de mesclagem" })}
          className="h-7 min-w-0 flex-1 rounded border border-input bg-secondary px-1.5 text-xs outline-none disabled:opacity-40"
        >
          {active?.type === "group" && <option value="pass-through">{BLEND_LABELS["pass-through"]}</option>}
          {BLEND_GROUPS.map((group, i) => (
            <optgroup key={i} label={" "}>
              {group.map((m) => (
                <option key={m} value={m}>{BLEND_LABELS[m]}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground">Opacidade</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round((active?.opacity ?? 1) * 100)}
          disabled={!active}
          onChange={(e) => active && s.updateLayer(active.id, { opacity: Number(e.target.value) / 100 }, { label: "Opacidade da camada", coalesce: `opacity-${active.id}` })}
          className="h-1 flex-1 accent-[var(--primary)] disabled:opacity-40"
        />
        <span className="w-9 text-right text-[11px] tabular-nums">{Math.round((active?.opacity ?? 1) * 100)}%</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
            <Layers className="h-6 w-6 opacity-50" />
            Nenhuma camada
          </div>
        ) : (
          [...layers].reverse().map((l) => <LayerRow key={l.id} layer={l} depth={0} revision={revision} />)
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-1.5 py-1">
        <div className="flex">
          <IconBtn label="Adicionar máscara (revelar tudo)" disabled={!raster || !!raster.mask} onClick={() => active && s.addMask(active.id, true)}>
            <VenetianMask className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Novo grupo (Ctrl+G)" disabled={!active} onClick={s.groupSelected}>
            <FolderPlus className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Nova camada (Ctrl+Shift+N)" onClick={s.addLayer}>
            <Plus className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Duplicar camada (Ctrl+J)" disabled={!active} onClick={() => s.duplicateLayer()}>
            <Copy className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Estilos de camada…" disabled={!raster || !!raster.adjustment} onClick={() => s.setStyleDialogOpen(true)}>
            <Sparkles className="h-4 w-4" />
          </IconBtn>
        </div>
        <IconBtn label="Excluir camada" disabled={!active} onClick={s.deleteSelected}>
          <Trash2 className="h-4 w-4" />
        </IconBtn>
      </div>
    </div>
  );
}
