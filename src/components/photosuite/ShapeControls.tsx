import { defaultGradient } from "@/src/lib/photosuite/gradient";
import { findLayer } from "@/src/lib/photosuite/tree";
import { DEFAULT_STROKE, type FillSpec, type StrokeSpec } from "@/src/lib/photosuite/vector";
import { usePhotosuite, type ShapeKind, type ShapeOpts } from "@/src/store/photosuite.store";
import { cn } from "@/src/lib/utils";

/** Alvo dos controles de forma: a camada de forma ativa ou os padrões das próximas formas. */
export function useShapeTarget(): { fill: FillSpec | null; stroke: StrokeSpec | null; layerId: string | null; apply: (patch: { fill?: FillSpec | null; stroke?: StrokeSpec | null }) => void } {
  const layers = usePhotosuite((s) => s.layers);
  const activeId = usePhotosuite((s) => s.activeId);
  const opts = usePhotosuite((s) => s.shapeOpts);
  const setShape = usePhotosuite((s) => s.setShape);
  const setShapeOpts = usePhotosuite((s) => s.setShapeOpts);
  const found = activeId ? findLayer(layers, activeId)?.layer : null;
  const shape = found && found.type === "raster" && !found.locked ? found.shape : undefined;
  if (shape && found) {
    return {
      fill: shape.fill,
      stroke: shape.stroke,
      layerId: found.id,
      apply: (patch) => {
        setShape(found.id, { ...shape, ...patch }, { label: "Estilo da forma", coalesce: `shapestyle-${found.id}-${Object.keys(patch).join(",")}` });
        setShapeOpts(patch);
      },
    };
  }
  return { fill: opts.fill, stroke: opts.stroke, layerId: null, apply: (patch) => setShapeOpts(patch) };
}

const KINDS: { id: ShapeKind; label: string }[] = [
  { id: "rect", label: "Retângulo" },
  { id: "rounded", label: "Retângulo arredondado" },
  { id: "ellipse", label: "Elipse" },
  { id: "polygon", label: "Polígono" },
  { id: "star", label: "Estrela" },
  { id: "line", label: "Linha" },
];

function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="h-7 w-14 rounded border border-input bg-secondary px-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
      />
    </label>
  );
}

/** Tipo de forma e parâmetros da ferramenta (só na barra de opções da ferramenta Forma). */
export function ShapeToolControls() {
  const opts = usePhotosuite((s) => s.shapeOpts);
  const set = usePhotosuite((s) => s.setShapeOpts);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <select value={opts.kind} onChange={(e) => set({ kind: e.target.value as ShapeKind })} className="h-7 rounded border border-input bg-secondary px-1.5 text-xs outline-none">
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>{k.label}</option>
        ))}
      </select>
      {opts.kind === "rounded" && <Num label="Raio" value={opts.radius} min={0} max={2000} onChange={(radius) => set({ radius })} />}
      {(opts.kind === "polygon" || opts.kind === "star") && <Num label="Lados" value={opts.sides} min={3} max={60} onChange={(sides) => set({ sides: Math.round(sides) })} />}
      {opts.kind === "star" && <Num label="Interior" value={opts.starInner} min={0.05} max={0.95} step={0.05} onChange={(starInner) => set({ starInner })} />}
    </div>
  );
}

/** Preenchimento e traço. `bar`: compacto; `panel`: completo. */
export function ShapeStyleControls({ layout }: { layout: "bar" | "panel" }) {
  const { fill, stroke, apply } = useShapeTarget();
  const bar = layout === "bar";
  const fillKind = fill ? fill.kind : "none";

  const setFillKind = (k: "none" | "color" | "gradient") => {
    if (k === "none") apply({ fill: null });
    else if (k === "color") apply({ fill: { kind: "color", color: fill?.kind === "color" ? fill.color : "#ec1889" } });
    else apply({ fill: { kind: "gradient", gradient: { ...defaultGradient(), stops: [{ pos: 0, color: "#ec1889" }, { pos: 1, color: "#6d28d9" }] } } });
  };
  const patchStroke = (patch: Partial<StrokeSpec>) => apply({ stroke: { ...(stroke ?? DEFAULT_STROKE), ...patch } });

  const sel = "h-7 rounded border border-input bg-secondary px-1.5 text-xs text-foreground outline-none";
  const wrap = (cls: string, children: React.ReactNode) => <div className={cn(bar ? "flex shrink-0 items-center gap-2" : "flex flex-wrap items-center gap-2", cls)}>{children}</div>;

  return (
    <div className={cn(bar ? "flex shrink-0 items-center gap-4" : "space-y-3")}>
      {wrap("", (
        <>
          <span className="text-[11px] text-muted-foreground">Preenchimento</span>
          <select value={fillKind} onChange={(e) => setFillKind(e.target.value as "none" | "color" | "gradient")} className={sel}>
            <option value="none">Nenhum</option>
            <option value="color">Cor</option>
            <option value="gradient">Degradê</option>
          </select>
          {fill?.kind === "color" && <input type="color" value={fill.color} onChange={(e) => apply({ fill: { kind: "color", color: e.target.value } })} className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent" />}
          {fill?.kind === "gradient" && (
            <>
              {fill.gradient.stops.slice(0, 2).map((st, i) => (
                <input
                  key={i}
                  type="color"
                  value={st.color}
                  onChange={(e) => apply({ fill: { kind: "gradient", gradient: { ...fill.gradient, stops: fill.gradient.stops.map((s2, k) => (k === i ? { ...s2, color: e.target.value } : s2)) } } })}
                  className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent"
                />
              ))}
              <Num label="∠" value={fill.gradient.angle} min={-180} max={180} onChange={(angle) => apply({ fill: { kind: "gradient", gradient: { ...fill.gradient, angle } } })} />
            </>
          )}
        </>
      ))}
      {wrap("", (
        <>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={!!stroke} onChange={(e) => apply({ stroke: e.target.checked ? { ...DEFAULT_STROKE } : null })} className="accent-[var(--primary)]" />
            Traço
          </label>
          {stroke && (
            <>
              <input type="color" value={stroke.color} onChange={(e) => patchStroke({ color: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent" />
              <Num label="Esp." value={stroke.width} min={0.5} max={500} step={0.5} onChange={(width) => patchStroke({ width })} />
              {!bar && (
                <>
                  <select value={stroke.align} onChange={(e) => patchStroke({ align: e.target.value as StrokeSpec["align"] })} className={sel} title="Alinhamento do traço">
                    <option value="center">Centro</option>
                    <option value="inside">Dentro</option>
                    <option value="outside">Fora</option>
                  </select>
                  <select value={stroke.cap} onChange={(e) => patchStroke({ cap: e.target.value as StrokeSpec["cap"] })} className={sel} title="Pontas">
                    <option value="butt">Ponta reta</option>
                    <option value="round">Ponta redonda</option>
                    <option value="square">Ponta quadrada</option>
                  </select>
                  <select value={stroke.join} onChange={(e) => patchStroke({ join: e.target.value as StrokeSpec["join"] })} className={sel} title="Cantos">
                    <option value="miter">Canto vivo</option>
                    <option value="round">Canto redondo</option>
                    <option value="bevel">Canto chanfrado</option>
                  </select>
                  <select value={stroke.dash ?? 0} onChange={(e) => patchStroke({ dash: Number(e.target.value) || null })} className={sel} title="Tracejado">
                    <option value={0}>Contínuo</option>
                    <option value={3}>Tracejado</option>
                    <option value={1}>Pontilhado</option>
                  </select>
                </>
              )}
            </>
          )}
        </>
      ))}
    </div>
  );
}

export type { ShapeOpts };
