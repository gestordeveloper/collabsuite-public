import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
  CONTOUR_LABELS, STYLE_LABELS, STYLE_ORDER, defaultStyle, styleEnabled,
  type BevelFx, type ContourId, type FxCommon, type FxPaint, type GlowFx, type LayerStyles, type SatinFx, type ShadowFx, type StrokeFx, type StyleKey,
} from "@/src/lib/photosuite/effects";
import { defaultGradient, type GradientSpec, type GradientStyle } from "@/src/lib/photosuite/gradient";
import { findLayer } from "@/src/lib/photosuite/tree";
import { BLEND_GROUPS, BLEND_LABELS, type BlendMode } from "@/src/lib/photosuite/types";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { cn } from "@/src/lib/utils";

// ---------------------------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------------------------

function Row({ label, value, min, max, step = 1, onChange, suffix = "", decimals = 0 }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; decimals?: number;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(decimals))}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
            className="h-5 w-14 rounded border border-input bg-secondary px-1 text-right text-[11px] tabular-nums outline-none focus:ring-1 focus:ring-primary"
          />
          {suffix && <span className="w-3 text-muted-foreground">{suffix}</span>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full accent-[var(--primary)]" />
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-6 max-w-[170px] rounded border border-input bg-secondary px-1 text-[11px] text-foreground outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between text-[11px] text-muted-foreground">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-10 cursor-pointer rounded border border-input bg-transparent" />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--primary)]" />
      {label}
    </label>
  );
}

const BLEND_OPTIONS = BLEND_GROUPS.flat().map((m) => ({ value: m as BlendMode, label: BLEND_LABELS[m] }));
const CONTOUR_OPTIONS = (Object.keys(CONTOUR_LABELS) as ContourId[]).map((c) => ({ value: c, label: CONTOUR_LABELS[c] }));

function CommonEditor({ common, onChange }: { common: FxCommon; onChange: (c: FxCommon) => void }) {
  return (
    <>
      <Select label="Modo de mesclagem" value={common.blend} options={BLEND_OPTIONS} onChange={(blend) => onChange({ ...common, blend })} />
      <Row label="Opacidade" value={Math.round(common.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...common, opacity: v / 100 })} />
    </>
  );
}

function GradientEditor({ g, onChange }: { g: GradientSpec; onChange: (g: GradientSpec) => void }) {
  const sorted = [...g.stops].sort((a, b) => a.pos - b.pos);
  const css = `linear-gradient(to right, ${sorted.map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(", ")})`;
  const setStop = (i: number, patch: Partial<GradientSpec["stops"][number]>) => onChange({ ...g, stops: g.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="space-y-2">
      <div className="h-4 w-full rounded border border-border" style={{ background: css }} />
      {g.stops.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="color" value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} className="h-6 w-9 shrink-0 cursor-pointer rounded border border-input bg-transparent" />
          <input type="range" min={0} max={100} value={Math.round(s.pos * 100)} onChange={(e) => setStop(i, { pos: Number(e.target.value) / 100 })} className="h-1 min-w-0 flex-1 accent-[var(--primary)]" />
          <button disabled={g.stops.length <= 2} onClick={() => onChange({ ...g, stops: g.stops.filter((_, k) => k !== i) })} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Remover cor">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onChange({ ...g, stops: [...g.stops, { pos: 0.5, color: "#888888" }] })}>
        <Plus className="h-3 w-3" /> Adicionar cor
      </button>
      <Select<GradientStyle>
        label="Estilo"
        value={g.style}
        options={[
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" },
          { value: "angle", label: "Angular" },
          { value: "reflected", label: "Refletido" },
          { value: "diamond", label: "Diamante" },
        ]}
        onChange={(style) => onChange({ ...g, style })}
      />
      <Row label="Ângulo" value={g.angle} min={-180} max={180} suffix="°" onChange={(angle) => onChange({ ...g, angle })} />
      <Row label="Escala" value={Math.round(g.scale * 100)} min={10} max={150} suffix="%" onChange={(v) => onChange({ ...g, scale: v / 100 })} />
      <Check label="Inverter" checked={g.reverse} onChange={(reverse) => onChange({ ...g, reverse })} />
    </div>
  );
}

function PaintEditor({ paint, onChange }: { paint: FxPaint; onChange: (p: FxPaint) => void }) {
  return (
    <div className="space-y-2">
      <Select<"color" | "gradient">
        label="Tipo de preenchimento"
        value={paint.kind}
        options={[{ value: "color", label: "Cor" }, { value: "gradient", label: "Degradê" }]}
        onChange={(k) => onChange(k === "color" ? { kind: "color", color: "#ffffbe" } : { kind: "gradient", gradient: { ...defaultGradient(), stops: [{ pos: 0, color: "#ffffbe" }, { pos: 1, color: "#ff8800" }] } })}
      />
      {paint.kind === "color" ? <Color label="Cor" value={paint.color} onChange={(color) => onChange({ kind: "color", color })} /> : <GradientEditor g={paint.gradient} onChange={(gradient) => onChange({ kind: "gradient", gradient })} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Editores por efeito
// ---------------------------------------------------------------------------------------------

function ShadowEditor({ fx, inner, onChange }: { fx: ShadowFx; inner: boolean; onChange: (f: ShadowFx) => void }) {
  return (
    <div className="space-y-2.5">
      <CommonEditor common={fx.common} onChange={(common) => onChange({ ...fx, common })} />
      <Color label="Cor" value={fx.color} onChange={(color) => onChange({ ...fx, color })} />
      <Row label="Ângulo" value={fx.angle} min={-180} max={180} suffix="°" onChange={(angle) => onChange({ ...fx, angle, useGlobalLight: false })} />
      <Check label="Usar luz global" checked={fx.useGlobalLight} onChange={(useGlobalLight) => onChange({ ...fx, useGlobalLight })} />
      <Row label="Distância" value={fx.distance} min={0} max={250} suffix="px" onChange={(distance) => onChange({ ...fx, distance })} />
      <Row label={inner ? "Contração (choke)" : "Propagação (spread)"} value={Math.round(fx.spread * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...fx, spread: v / 100 })} />
      <Row label="Tamanho" value={fx.size} min={0} max={250} suffix="px" onChange={(size) => onChange({ ...fx, size })} />
      <Select<ContourId> label="Contorno" value={fx.contour} options={CONTOUR_OPTIONS} onChange={(contour) => onChange({ ...fx, contour })} />
      <Row label="Ruído" value={Math.round(fx.noise * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...fx, noise: v / 100 })} />
    </div>
  );
}

function GlowEditor({ fx, inner, onChange }: { fx: GlowFx; inner: boolean; onChange: (f: GlowFx) => void }) {
  return (
    <div className="space-y-2.5">
      <CommonEditor common={fx.common} onChange={(common) => onChange({ ...fx, common })} />
      <PaintEditor paint={fx.paint} onChange={(paint) => onChange({ ...fx, paint })} />
      <Select<"softer" | "precise"> label="Técnica" value={fx.technique} options={[{ value: "softer", label: "Suave" }, { value: "precise", label: "Preciso" }]} onChange={(technique) => onChange({ ...fx, technique })} />
      {inner && <Select<"center" | "edge"> label="Origem" value={fx.source} options={[{ value: "edge", label: "Borda" }, { value: "center", label: "Centro" }]} onChange={(source) => onChange({ ...fx, source })} />}
      <Row label={inner ? "Contração (choke)" : "Propagação (spread)"} value={Math.round(fx.spread * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...fx, spread: v / 100 })} />
      <Row label="Tamanho" value={fx.size} min={0} max={250} suffix="px" onChange={(size) => onChange({ ...fx, size })} />
      <Select<ContourId> label="Contorno" value={fx.contour} options={CONTOUR_OPTIONS} onChange={(contour) => onChange({ ...fx, contour })} />
      <Row label="Alcance" value={Math.round(fx.range * 100)} min={1} max={100} suffix="%" onChange={(v) => onChange({ ...fx, range: v / 100 })} />
      <Row label="Ruído" value={Math.round(fx.noise * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...fx, noise: v / 100 })} />
    </div>
  );
}

function StrokeEditor({ fx, onChange }: { fx: StrokeFx; onChange: (f: StrokeFx) => void }) {
  return (
    <div className="space-y-2.5">
      <Row label="Tamanho" value={fx.size} min={1} max={250} suffix="px" onChange={(size) => onChange({ ...fx, size })} />
      <Select<StrokeFx["position"]> label="Posição" value={fx.position} options={[{ value: "outside", label: "Fora" }, { value: "inside", label: "Dentro" }, { value: "center", label: "Centro" }]} onChange={(position) => onChange({ ...fx, position })} />
      <CommonEditor common={fx.common} onChange={(common) => onChange({ ...fx, common })} />
      <PaintEditor paint={fx.paint} onChange={(paint) => onChange({ ...fx, paint })} />
    </div>
  );
}

function SatinEditor({ fx, onChange }: { fx: SatinFx; onChange: (f: SatinFx) => void }) {
  return (
    <div className="space-y-2.5">
      <CommonEditor common={fx.common} onChange={(common) => onChange({ ...fx, common })} />
      <Color label="Cor" value={fx.color} onChange={(color) => onChange({ ...fx, color })} />
      <Row label="Ângulo" value={fx.angle} min={-180} max={180} suffix="°" onChange={(angle) => onChange({ ...fx, angle })} />
      <Row label="Distância" value={fx.distance} min={1} max={250} suffix="px" onChange={(distance) => onChange({ ...fx, distance })} />
      <Row label="Tamanho" value={fx.size} min={0} max={250} suffix="px" onChange={(size) => onChange({ ...fx, size })} />
      <Select<ContourId> label="Contorno" value={fx.contour} options={CONTOUR_OPTIONS} onChange={(contour) => onChange({ ...fx, contour })} />
      <Check label="Inverter" checked={fx.invert} onChange={(invert) => onChange({ ...fx, invert })} />
    </div>
  );
}

function BevelEditor({ fx, onChange }: { fx: BevelFx; onChange: (f: BevelFx) => void }) {
  return (
    <div className="space-y-2.5">
      <Select<BevelFx["style"]>
        label="Estilo"
        value={fx.style}
        options={[
          { value: "inner", label: "Chanfro interno" },
          { value: "outer", label: "Chanfro externo" },
          { value: "emboss", label: "Relevo" },
          { value: "pillow", label: "Relevo de almofada" },
        ]}
        onChange={(style) => onChange({ ...fx, style })}
      />
      <Row label="Profundidade" value={Math.round(fx.depth * 100)} min={1} max={1000} suffix="%" onChange={(v) => onChange({ ...fx, depth: v / 100 })} />
      <Select<"up" | "down"> label="Direção" value={fx.up ? "up" : "down"} options={[{ value: "up", label: "Para cima" }, { value: "down", label: "Para baixo" }]} onChange={(d) => onChange({ ...fx, up: d === "up" })} />
      <Row label="Tamanho" value={fx.size} min={0} max={250} suffix="px" onChange={(size) => onChange({ ...fx, size })} />
      <Row label="Suavizar" value={fx.soften} min={0} max={16} suffix="px" onChange={(soften) => onChange({ ...fx, soften })} />
      <Row label="Ângulo" value={fx.angle} min={-180} max={180} suffix="°" onChange={(angle) => onChange({ ...fx, angle, useGlobalLight: false })} />
      <Row label="Altitude" value={fx.altitude} min={0} max={90} suffix="°" onChange={(altitude) => onChange({ ...fx, altitude, useGlobalLight: false })} />
      <Check label="Usar luz global" checked={fx.useGlobalLight} onChange={(useGlobalLight) => onChange({ ...fx, useGlobalLight })} />
      <div className="space-y-2 rounded border border-border p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Realce</div>
        <Select label="Modo" value={fx.highlight.blend} options={BLEND_OPTIONS} onChange={(blend) => onChange({ ...fx, highlight: { ...fx.highlight, blend } })} />
        <Color label="Cor" value={fx.highlight.color} onChange={(color) => onChange({ ...fx, highlight: { ...fx.highlight, color } })} />
        <Row label="Opacidade" value={Math.round(fx.highlight.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...fx, highlight: { ...fx.highlight, opacity: v / 100 } })} />
      </div>
      <div className="space-y-2 rounded border border-border p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sombra</div>
        <Select label="Modo" value={fx.shadow.blend} options={BLEND_OPTIONS} onChange={(blend) => onChange({ ...fx, shadow: { ...fx.shadow, blend } })} />
        <Color label="Cor" value={fx.shadow.color} onChange={(color) => onChange({ ...fx, shadow: { ...fx.shadow, color } })} />
        <Row label="Opacidade" value={Math.round(fx.shadow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...fx, shadow: { ...fx.shadow, opacity: v / 100 } })} />
      </div>
    </div>
  );
}

function EffectEditor({ k, styles, update }: { k: StyleKey; styles: LayerStyles; update: (key: StyleKey, value: unknown) => void }) {
  const fx = styles[k];
  if (!fx) return <p className="text-xs text-muted-foreground">Marque o efeito para editar.</p>;
  switch (k) {
    case "dropShadow": return <ShadowEditor fx={styles.dropShadow!} inner={false} onChange={(f) => update(k, f)} />;
    case "innerShadow": return <ShadowEditor fx={styles.innerShadow!} inner onChange={(f) => update(k, f)} />;
    case "outerGlow": return <GlowEditor fx={styles.outerGlow!} inner={false} onChange={(f) => update(k, f)} />;
    case "innerGlow": return <GlowEditor fx={styles.innerGlow!} inner onChange={(f) => update(k, f)} />;
    case "stroke": return <StrokeEditor fx={styles.stroke!} onChange={(f) => update(k, f)} />;
    case "satin": return <SatinEditor fx={styles.satin!} onChange={(f) => update(k, f)} />;
    case "bevel": return <BevelEditor fx={styles.bevel!} onChange={(f) => update(k, f)} />;
    case "colorOverlay": {
      const f = styles.colorOverlay!;
      return (
        <div className="space-y-2.5">
          <CommonEditor common={f.common} onChange={(common) => update(k, { ...f, common })} />
          <Color label="Cor" value={f.color} onChange={(color) => update(k, { ...f, color })} />
        </div>
      );
    }
    case "gradientOverlay": {
      const f = styles.gradientOverlay!;
      return (
        <div className="space-y-2.5">
          <CommonEditor common={f.common} onChange={(common) => update(k, { ...f, common })} />
          <GradientEditor g={f.gradient} onChange={(gradient) => update(k, { ...f, gradient })} />
        </div>
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Diálogo
// ---------------------------------------------------------------------------------------------

/** Painel flutuante de Estilo de camada: edições ao vivo, Cancelar desfaz tudo o que foi feito nele. */
export function LayerStyleDialog() {
  const open = usePhotosuite((s) => s.styleDialogOpen);
  const layers = usePhotosuite((s) => s.layers);
  const activeId = usePhotosuite((s) => s.activeId);
  const found = activeId ? findLayer(layers, activeId)?.layer : null;
  if (!open || !found || found.type !== "raster" || found.adjustment) return null;
  return <Panel key={found.id} layerId={found.id} />;
}

function Panel({ layerId }: { layerId: string }) {
  const layers = usePhotosuite((s) => s.layers);
  const setLayerStyles = usePhotosuite((s) => s.setLayerStyles);
  const close = usePhotosuite((s) => s.setStyleDialogOpen);
  const light = usePhotosuite((s) => s.globalLight);
  const setLight = usePhotosuite((s) => s.setGlobalLight);
  const layer = findLayer(layers, layerId)?.layer;
  const styles: LayerStyles = (layer?.type === "raster" ? layer.styles : undefined) ?? {};
  const initial = useRef<LayerStyles | undefined>(layer?.type === "raster" ? structuredClone(layer.styles) : undefined);
  const initialLight = useRef(light);
  const [sel, setSel] = useState<StyleKey>(() => STYLE_ORDER.find((k) => styleEnabled(styles, k)) ?? "dropShadow");

  const cancel = () => {
    setLayerStyles(layerId, initial.current, { label: "Estilo de camada" });
    setLight(initialLight.current);
    close(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = (next: LayerStyles) => setLayerStyles(layerId, Object.keys(next).length ? next : undefined, { coalesce: `styles-${layerId}` });
  const update = (key: StyleKey, value: unknown) => write({ ...styles, [key]: value });
  const toggle = (key: StyleKey, on: boolean) => {
    const cur = styles[key] as { common?: FxCommon; enabled?: boolean } | undefined;
    if (!cur) {
      if (on) write({ ...styles, [key]: defaultStyle(key) });
    } else if (key === "bevel") update(key, { ...cur, enabled: on });
    else update(key, { ...cur, common: { ...cur.common!, enabled: on } });
    if (on) setSel(key);
  };

  return (
    <div className="fixed right-[296px] top-24 z-50 flex max-h-[calc(100vh-8rem)] w-[560px] flex-col rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-sm font-semibold">Estilo de camada — {layer?.name}</div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>Luz global</span>
          <input type="number" value={light.angle} min={-180} max={180} onChange={(e) => setLight({ ...light, angle: Number(e.target.value) })} className="h-6 w-14 rounded border border-input bg-secondary px-1 text-right text-foreground outline-none" title="Ângulo" />°
          <input type="number" value={light.altitude} min={0} max={90} onChange={(e) => setLight({ ...light, altitude: Number(e.target.value) })} className="h-6 w-14 rounded border border-input bg-secondary px-1 text-right text-foreground outline-none" title="Altitude" />°
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-48 shrink-0 overflow-y-auto border-r border-border py-1">
          {STYLE_ORDER.map((k) => (
            <div key={k} className={cn("flex items-center gap-2 px-3 py-1.5 text-xs", sel === k ? "bg-primary/15" : "hover:bg-accent/60")}>
              <input type="checkbox" checked={styleEnabled(styles, k)} onChange={(e) => toggle(k, e.target.checked)} className="accent-[var(--primary)]" aria-label={STYLE_LABELS[k]} />
              <button className="flex-1 text-left" onClick={() => setSel(k)}>{STYLE_LABELS[k]}</button>
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 text-xs font-semibold">{STYLE_LABELS[sel]}</div>
          <EffectEditor k={sel} styles={styles} update={update} />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={cancel}>Cancelar</Button>
        <Button size="sm" onClick={() => close(false)}>OK</Button>
      </div>
    </div>
  );
}
