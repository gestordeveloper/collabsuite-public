import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/src/components/ui/button";
import {
  ADJUSTMENT_LABELS, ADJUSTMENT_ORDER, applyAdjustment, defaultAdjustment, type Adjustment, type AdjustmentKind,
} from "@/src/lib/photosuite/adjustments";
import { FILTERS, defaultParams, runFilter, type FilterId, type ParamDef } from "@/src/lib/photosuite/filters";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { AdjustmentEditor } from "./AdjustmentEditor";

/**
 * Painel flutuante sem escurecer a tela: o resultado aparece ao vivo no canvas. Uma camada
 * transparente bloqueia o resto da interface enquanto a edição está pendente.
 */
function FloatingPanel({ title, children, onApply, onCancel, applyDisabled }: {
  title: string; children: React.ReactNode; onApply: () => void; onCancel: () => void; applyDisabled?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <>
      <div className="fixed inset-0 z-40" />
      <div className="fixed right-6 top-24 z-50 flex max-h-[calc(100vh-8rem)] w-80 flex-col rounded-xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" onClick={onApply} disabled={applyDisabled}>Aplicar</Button>
        </div>
      </div>
    </>
  );
}

function ParamControl({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
  if (def.type === "check") {
    return (
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={value === 1} onChange={(e) => onChange(e.target.checked ? 1 : 0)} className="accent-[var(--primary)]" />
        {def.label}
      </label>
    );
  }
  if (def.type === "select") {
    return (
      <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {def.label}
        <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-7 rounded border border-input bg-secondary px-1.5 text-xs text-foreground outline-none">
          {def.options!.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{def.label}</span>
        <span className="tabular-nums">
          {Number(value.toFixed(2))}
          {def.suffix ?? ""}
        </span>
      </div>
      <input type="range" min={def.min} max={def.max} step={def.step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full accent-[var(--primary)]" />
    </div>
  );
}

/** Filtro destrutivo com pré-visualização ao vivo sobre a camada ativa (dentro da seleção, se houver). */
export function FilterDialog({ filterId, onClose }: { filterId: FilterId | null; onClose: () => void }) {
  if (!filterId) return null;
  return <FilterPanel key={filterId} filterId={filterId} onClose={onClose} />;
}

function FilterPanel({ filterId, onClose }: { filterId: FilterId; onClose: () => void }) {
  const def = useMemo(() => FILTERS.find((f) => f.id === filterId)!, [filterId]);
  const [params, setParams] = useState(() => defaultParams(def));
  const [preview, setPreview] = useState(true);
  const [ready, setReady] = useState(false);
  const committed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ok = usePhotosuite.getState().beginPixelEdit();
    if (!ok) {
      alert("Selecione uma camada de pixels destravada para aplicar o filtro.");
      onClose();
      return;
    }
    setReady(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (!committed.current) usePhotosuite.getState().cancelPixelEdit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pré-visualização com debounce: filtros pesados não rodam a cada pixel do slider
  useEffect(() => {
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      usePhotosuite.getState().previewPixelEdit((img) => (preview ? runFilter(filterId, params, img) : img));
    }, 60);
  }, [params, preview, ready, filterId]);

  function apply() {
    if (timer.current) clearTimeout(timer.current);
    const s = usePhotosuite.getState();
    s.previewPixelEdit((img) => runFilter(filterId, params, img));
    committed.current = true;
    s.commitPixelEdit(def.label);
    onClose();
  }

  return (
    <FloatingPanel title={def.label} onApply={apply} onCancel={onClose} applyDisabled={!ready}>
      {def.params.length === 0 && <p className="text-xs text-muted-foreground">Este filtro não tem parâmetros.</p>}
      {def.params.map((p) => (
        <ParamControl key={p.key} def={p} value={params[p.key]} onChange={(v) => setParams((prev) => ({ ...prev, [p.key]: v }))} />
      ))}
      <label className="flex cursor-pointer items-center gap-1.5 pt-1 text-xs text-muted-foreground">
        <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--primary)]" />
        Pré-visualizar
      </label>
    </FloatingPanel>
  );
}

/** Aplica um ajuste diretamente aos pixels da camada ativa (versão destrutiva das camadas de ajuste). */
export function ApplyAdjustmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <ApplyAdjustmentPanel onClose={onClose} />;
}

function ApplyAdjustmentPanel({ onClose }: { onClose: () => void }) {
  const activeId = usePhotosuite((s) => s.activeId) ?? "";
  const [kind, setKind] = useState<AdjustmentKind>("brightness-contrast");
  const [adj, setAdj] = useState<Adjustment>(() => defaultAdjustment("brightness-contrast"));
  const [ready, setReady] = useState(false);
  const committed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ok = usePhotosuite.getState().beginPixelEdit();
    if (!ok) {
      alert("Selecione uma camada de pixels destravada para aplicar o ajuste.");
      onClose();
      return;
    }
    setReady(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (!committed.current) usePhotosuite.getState().cancelPixelEdit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      usePhotosuite.getState().previewPixelEdit((img) => {
        applyAdjustment(adj, img.data);
        return img;
      });
    }, 40);
  }, [adj, ready]);

  function apply() {
    if (timer.current) clearTimeout(timer.current);
    const s = usePhotosuite.getState();
    s.previewPixelEdit((img) => {
      applyAdjustment(adj, img.data);
      return img;
    });
    committed.current = true;
    s.commitPixelEdit(`Ajuste: ${ADJUSTMENT_LABELS[adj.kind]}`);
    onClose();
  }

  return (
    <FloatingPanel title="Aplicar ajuste à camada" onApply={apply} onCancel={onClose} applyDisabled={!ready}>
      <select
        value={kind}
        onChange={(e) => {
          const k = e.target.value as AdjustmentKind;
          setKind(k);
          setAdj(defaultAdjustment(k));
        }}
        className="h-8 w-full rounded border border-input bg-secondary px-2 text-xs outline-none"
      >
        {ADJUSTMENT_ORDER.map((k) => (
          <option key={k} value={k}>{ADJUSTMENT_LABELS[k]}</option>
        ))}
      </select>
      <AdjustmentEditor key={kind} adjustment={adj} onChange={setAdj} layerId={activeId} />
    </FloatingPanel>
  );
}
