import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  curveLut, defaultLevels, identityCurve,
  type Adjustment, type CurvePoint, type GradientStop, type HueRange, type LevelsChannel,
} from "@/src/lib/photosuite/adjustments";
import { belowLayers, computeHistogram, type Histogram } from "@/src/lib/photosuite/histogram";
import { cn } from "@/src/lib/utils";
import { usePhotosuite } from "@/src/store/photosuite.store";

// ---------------------------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------------------------

function Row({ label, value, min, max, step = 1, onChange, suffix = "", decimals = 0 }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; decimals?: number;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
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
          className="h-5 w-16 rounded border border-input bg-secondary px-1 text-right text-[11px] tabular-nums outline-none focus:ring-1 focus:ring-primary"
        />
        {suffix && <span className="w-3 text-muted-foreground">{suffix}</span>}
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full accent-[var(--primary)]" />
    </div>
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

function Tabs<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          className={cn("rounded px-2 py-0.5 text-[11px]", value === o.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-accent")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const hexToRgb01 = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const rgb01ToHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

function ColorInput({ label, value, onChange }: { label: string; value: number[]; onChange: (c: [number, number, number]) => void }) {
  return (
    <label className="flex items-center justify-between text-[11px] text-muted-foreground">
      {label}
      <input type="color" value={rgb01ToHex(value)} onChange={(e) => onChange(hexToRgb01(e.target.value))} className="h-6 w-10 cursor-pointer rounded border border-input bg-transparent" />
    </label>
  );
}

/** Histograma das camadas abaixo do ajuste (recalculado quando os pixels mudam, não a cada slider). */
function useHistogram(layerId: string, enabled: boolean): Histogram | null {
  const [hist, setHist] = useState<Histogram | null>(null);
  // chave = passos de histórico que não são edições deste próprio ajuste
  const pixelKey = usePhotosuite((s) => s.past.filter((e) => !e.key?.startsWith("adj-")).length + s.future.length);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      const s = usePhotosuite.getState();
      const below = belowLayers(s.layers, layerId);
      if (below) setHist(computeHistogram(s.width, s.height, below));
    }, 150);
    return () => clearTimeout(t);
  }, [layerId, enabled, pixelKey]);
  return hist;
}

function HistogramBar({ data, height = 56 }: { data: Uint32Array | undefined; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!data) return;
    let max = 1;
    for (let i = 1; i < 255; i++) max = Math.max(max, data[i]); // ignora os extremos (picos de preto/branco puro)
    ctx.fillStyle = "rgba(160,160,170,0.55)";
    for (let i = 0; i < 256; i++) {
      const h = Math.min(1, data[i] / max) * c.height;
      ctx.fillRect(i, c.height - h, 1, h);
    }
  }, [data]);
  return <canvas ref={ref} width={256} height={height} className="h-14 w-full rounded border border-border bg-black/40" style={{ imageRendering: "pixelated" }} />;
}

const CHANNELS = [
  { id: 3, label: "RGB" },
  { id: 0, label: "R" },
  { id: 1, label: "G" },
  { id: 2, label: "B" },
];

// ---------------------------------------------------------------------------------------------
// Níveis
// ---------------------------------------------------------------------------------------------

function LevelsEditor({ adj, onChange, hist }: { adj: Extract<Adjustment, { kind: "levels" }>; onChange: (a: Adjustment) => void; hist: Histogram | null }) {
  const [ch, setCh] = useState<number>(3);
  const cur: LevelsChannel = ch === 3 ? adj.master : adj.channels[ch];
  const set = (patch: Partial<LevelsChannel>) => {
    const next = { ...cur, ...patch };
    if (ch === 3) onChange({ ...adj, master: next });
    else onChange({ ...adj, channels: adj.channels.map((c, i) => (i === ch ? next : c)) as typeof adj.channels });
  };
  const data = hist ? (ch === 0 ? hist.r : ch === 1 ? hist.g : ch === 2 ? hist.b : hist.l) : undefined;
  return (
    <div className="space-y-3">
      <Tabs value={ch} options={CHANNELS} onChange={(v) => setCh(v)} />
      <HistogramBar data={data} />
      <Row label="Entrada: preto" value={Math.round(cur.inBlack * 255)} min={0} max={253} onChange={(v) => set({ inBlack: Math.min(v / 255, cur.inWhite - 2 / 255) })} />
      <Row label="Tons médios (gama)" value={cur.gamma} min={0.1} max={9.99} step={0.01} decimals={2} onChange={(v) => set({ gamma: v })} />
      <Row label="Entrada: branco" value={Math.round(cur.inWhite * 255)} min={2} max={255} onChange={(v) => set({ inWhite: Math.max(v / 255, cur.inBlack + 2 / 255) })} />
      <Row label="Saída: preto" value={Math.round(cur.outBlack * 255)} min={0} max={255} onChange={(v) => set({ outBlack: v / 255 })} />
      <Row label="Saída: branco" value={Math.round(cur.outWhite * 255)} min={0} max={255} onChange={(v) => set({ outWhite: v / 255 })} />
      <button className="text-[11px] text-muted-foreground underline hover:text-foreground" onClick={() => set(defaultLevels())}>
        Redefinir canal
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Curvas
// ---------------------------------------------------------------------------------------------

const CURVE_SIZE = 256;

function CurveCanvas({ points, onChange, data }: { points: CurvePoint[]; onChange: (p: CurvePoint[]) => void; data?: Uint32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const S = CURVE_SIZE;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, S, S);
    if (data) {
      let max = 1;
      for (let i = 1; i < 255; i++) max = Math.max(max, data[i]);
      ctx.fillStyle = "rgba(160,160,170,0.35)";
      for (let i = 0; i < 256; i++) {
        const h = Math.min(1, data[i] / max) * S;
        ctx.fillRect(i, S - h, 1, h);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((S * i) / 4, 0); ctx.lineTo((S * i) / 4, S); ctx.moveTo(0, (S * i) / 4); ctx.lineTo(S, (S * i) / 4); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath(); ctx.moveTo(0, S); ctx.lineTo(S, 0); ctx.stroke();
    const lut = curveLut(points);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < S; x++) {
      const y = S - lut[Math.round((x / (S - 1)) * (lut.length - 1))] * S;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#ec1889";
    for (const p of points) {
      ctx.beginPath(); ctx.arc(p.x * S, S - p.y * S, 4, 0, Math.PI * 2); ctx.fill();
    }
  }, [points, data]);

  const toPoint = (e: React.PointerEvent): CurvePoint => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    };
  };

  function hit(p: CurvePoint): number {
    const tol = 8 / CURVE_SIZE;
    let best = -1, bd = Infinity;
    points.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < tol && d < bd) { best = i; bd = d; }
    });
    return best;
  }

  return (
    <canvas
      ref={ref}
      width={CURVE_SIZE}
      height={CURVE_SIZE}
      className="aspect-square w-full cursor-crosshair touch-none rounded border border-border"
      onPointerDown={(e) => {
        const p = toPoint(e);
        let i = hit(p);
        if (e.button === 2 || e.detail === 2) {
          // clique direito / duplo clique remove (menos as pontas)
          if (i > 0 && i < points.length - 1) onChange(points.filter((_, k) => k !== i));
          return;
        }
        let next = points;
        if (i < 0) {
          next = [...points, p].sort((a, b) => a.x - b.x);
          i = next.indexOf(p);
          onChange(next);
        }
        dragging.current = i;
        ref.current!.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const i = dragging.current;
        if (i === null) return;
        const p = toPoint(e);
        const prev = points[i - 1];
        const nextPt = points[i + 1];
        // mantém a ordem em x; as pontas só se movem em y
        const isEnd = i === 0 || i === points.length - 1;
        const x = isEnd ? points[i].x : Math.min((nextPt?.x ?? 1) - 0.004, Math.max((prev?.x ?? 0) + 0.004, p.x));
        onChange(points.map((q, k) => (k === i ? { x, y: p.y } : q)));
      }}
      onPointerUp={() => { dragging.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

function CurvesEditor({ adj, onChange, hist }: { adj: Extract<Adjustment, { kind: "curves" }>; onChange: (a: Adjustment) => void; hist: Histogram | null }) {
  const [ch, setCh] = useState<number>(3);
  const pts = ch === 3 ? adj.master : adj.channels[ch];
  const setPts = (p: CurvePoint[]) => {
    if (ch === 3) onChange({ ...adj, master: p });
    else onChange({ ...adj, channels: adj.channels.map((c, i) => (i === ch ? p : c)) as typeof adj.channels });
  };
  const data = hist ? (ch === 0 ? hist.r : ch === 1 ? hist.g : ch === 2 ? hist.b : hist.l) : undefined;
  return (
    <div className="space-y-3">
      <Tabs value={ch} options={CHANNELS} onChange={(v) => setCh(v)} />
      <CurveCanvas points={pts} onChange={setPts} data={data} />
      <p className="text-[10px] text-muted-foreground">Clique para adicionar um ponto, arraste para mover, duplo clique remove.</p>
      <button className="text-[11px] text-muted-foreground underline hover:text-foreground" onClick={() => setPts(identityCurve())}>
        Redefinir canal
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Matiz/Saturação
// ---------------------------------------------------------------------------------------------

const HUE_RANGES = ["Mestre", "Vermelhos", "Amarelos", "Verdes", "Cianos", "Azuis", "Magentas"];

function HueSatEditor({ adj, onChange }: { adj: Extract<Adjustment, { kind: "hue-saturation" }>; onChange: (a: Adjustment) => void }) {
  const [range, setRange] = useState(0);
  const master = range === 0;
  const r: Pick<HueRange, "hue" | "saturation" | "lightness"> = master ? adj : adj.ranges[range - 1];
  const set = (patch: Partial<Pick<HueRange, "hue" | "saturation" | "lightness">>) => {
    if (master) onChange({ ...adj, ...patch });
    else onChange({ ...adj, ranges: adj.ranges.map((x, i) => (i === range - 1 ? { ...x, ...patch } : x)) });
  };
  const colorize = adj.colorize && master;
  return (
    <div className="space-y-3">
      <Tabs value={range} options={HUE_RANGES.map((l, i) => ({ id: i, label: l }))} onChange={(v) => setRange(v)} />
      <Row label="Matiz" value={r.hue} min={colorize ? 0 : -180} max={colorize ? 360 : 180} suffix="°" onChange={(v) => set({ hue: v })} />
      <Row label="Saturação" value={r.saturation} min={colorize ? 0 : -100} max={100} onChange={(v) => set({ saturation: v })} />
      <Row label="Luminosidade" value={r.lightness} min={-100} max={100} onChange={(v) => set({ lightness: v })} />
      {master && (
        <Check
          label="Colorir"
          checked={adj.colorize}
          onChange={(v) => onChange({ ...adj, colorize: v, hue: v ? Math.max(0, adj.hue) : adj.hue, saturation: v && adj.saturation === 0 ? 25 : adj.saturation })}
        />
      )}
      {!master && <button className="text-[11px] text-muted-foreground underline hover:text-foreground" onClick={() => set({ hue: 0, saturation: 0, lightness: 0 })}>Redefinir faixa</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Demais ajustes
// ---------------------------------------------------------------------------------------------

function ColorBalanceEditor({ adj, onChange }: { adj: Extract<Adjustment, { kind: "color-balance" }>; onChange: (a: Adjustment) => void }) {
  const [tone, setTone] = useState<"shadows" | "midtones" | "highlights">("midtones");
  const v = adj[tone];
  const set = (i: number, value: number) => onChange({ ...adj, [tone]: v.map((x, k) => (k === i ? value : x)) as [number, number, number] });
  return (
    <div className="space-y-3">
      <Tabs value={tone} options={[{ id: "shadows", label: "Sombras" }, { id: "midtones", label: "Meios-tons" }, { id: "highlights", label: "Realces" }]} onChange={(v) => setTone(v)} />
      <Row label="Ciano ↔ Vermelho" value={v[0]} min={-100} max={100} onChange={(x) => set(0, x)} />
      <Row label="Magenta ↔ Verde" value={v[1]} min={-100} max={100} onChange={(x) => set(1, x)} />
      <Row label="Amarelo ↔ Azul" value={v[2]} min={-100} max={100} onChange={(x) => set(2, x)} />
      <Check label="Preservar luminosidade" checked={adj.preserveLuminosity} onChange={(x) => onChange({ ...adj, preserveLuminosity: x })} />
    </div>
  );
}

const BW_NAMES = ["Vermelhos", "Amarelos", "Verdes", "Cianos", "Azuis", "Magentas"];

function BlackWhiteEditor({ adj, onChange }: { adj: Extract<Adjustment, { kind: "black-white" }>; onChange: (a: Adjustment) => void }) {
  return (
    <div className="space-y-3">
      {BW_NAMES.map((n, i) => (
        <Row key={n} label={n} value={adj.weights[i]} min={-200} max={300} onChange={(v) => onChange({ ...adj, weights: adj.weights.map((w, k) => (k === i ? v : w)) })} />
      ))}
      <Check label="Tonalizar" checked={!!adj.tint} onChange={(on) => onChange({ ...adj, tint: on ? [0.88, 0.78, 0.6] : null })} />
      {adj.tint && <ColorInput label="Cor do tom" value={adj.tint} onChange={(c) => onChange({ ...adj, tint: c })} />}
    </div>
  );
}

const FILTER_PRESETS: { label: string; color: [number, number, number] }[] = [
  { label: "Aquecimento (85)", color: [236 / 255, 138 / 255, 0] },
  { label: "Resfriamento (80)", color: [0, 109 / 255, 1] },
  { label: "Sépia", color: [172 / 255, 122 / 255, 51 / 255] },
  { label: "Vermelho", color: [234 / 255, 26 / 255, 26 / 255] },
  { label: "Azul", color: [0, 93 / 255, 1] },
  { label: "Verde", color: [25 / 255, 201 / 255, 25 / 255] },
];

function PhotoFilterEditor({ adj, onChange }: { adj: Extract<Adjustment, { kind: "photo-filter" }>; onChange: (a: Adjustment) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {FILTER_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onChange({ ...adj, color: p.color })} className="rounded bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
            {p.label}
          </button>
        ))}
      </div>
      <ColorInput label="Cor" value={adj.color} onChange={(c) => onChange({ ...adj, color: c })} />
      <Row label="Densidade" value={Math.round(adj.density * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...adj, density: v / 100 })} />
      <Check label="Preservar luminosidade" checked={adj.preserveLuminosity} onChange={(x) => onChange({ ...adj, preserveLuminosity: x })} />
    </div>
  );
}

function ChannelMixerEditor({ adj, onChange }: { adj: Extract<Adjustment, { kind: "channel-mixer" }>; onChange: (a: Adjustment) => void }) {
  const [out, setOut] = useState(0);
  const row = adj.matrix[out];
  const set = (i: number, v: number) => onChange({ ...adj, matrix: adj.matrix.map((r, k) => (k === out ? r.map((x, j) => (j === i ? v / 100 : x)) : r)) });
  return (
    <div className="space-y-3">
      {!adj.monochrome && <Tabs value={out} options={[{ id: 0, label: "Saída: R" }, { id: 1, label: "Saída: G" }, { id: 2, label: "Saída: B" }]} onChange={(v) => setOut(v)} />}
      {[
        ["Vermelho", 0],
        ["Verde", 1],
        ["Azul", 2],
        ["Constante", 3],
      ].map(([label, i]) => (
        <Row key={label as string} label={label as string} value={Math.round(row[i as number] * 100)} min={i === 3 ? -100 : -200} max={i === 3 ? 100 : 200} suffix="%" onChange={(v) => set(i as number, v)} />
      ))}
      <Check label="Monocromático" checked={adj.monochrome} onChange={(x) => { setOut(0); onChange({ ...adj, monochrome: x }); }} />
    </div>
  );
}

const SELECTIVE_RANGES = ["Vermelhos", "Amarelos", "Verdes", "Cianos", "Azuis", "Magentas", "Brancos", "Neutros", "Pretos"];

function SelectiveColorEditor({ adj, onChange }: { adj: Extract<Adjustment, { kind: "selective-color" }>; onChange: (a: Adjustment) => void }) {
  const [range, setRange] = useState(0);
  const row = adj.adjustments[range];
  const set = (i: number, v: number) => onChange({ ...adj, adjustments: adj.adjustments.map((r, k) => (k === range ? r.map((x, j) => (j === i ? v : x)) : r)) });
  return (
    <div className="space-y-3">
      <Tabs value={range} options={SELECTIVE_RANGES.map((l, i) => ({ id: i, label: l }))} onChange={(v) => setRange(v)} />
      {["Ciano", "Magenta", "Amarelo", "Preto"].map((n, i) => (
        <Row key={n} label={n} value={row[i]} min={-100} max={100} suffix="%" onChange={(v) => set(i, v)} />
      ))}
      <Tabs value={adj.relative ? 1 : 0} options={[{ id: 1, label: "Relativo" }, { id: 0, label: "Absoluto" }]} onChange={(v) => onChange({ ...adj, relative: v === 1 })} />
    </div>
  );
}

const GRADIENT_PRESETS: { label: string; stops: GradientStop[] }[] = [
  { label: "Preto → Branco", stops: [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [1, 1, 1] }] },
  { label: "Sépia", stops: [{ pos: 0, color: [0.1, 0.05, 0] }, { pos: 0.5, color: [0.65, 0.45, 0.25] }, { pos: 1, color: [1, 0.95, 0.8] }] },
  { label: "Azul → Laranja", stops: [{ pos: 0, color: [0.05, 0.1, 0.4] }, { pos: 0.5, color: [0.7, 0.4, 0.5] }, { pos: 1, color: [1, 0.7, 0.2] }] },
  { label: "Duotone rosa", stops: [{ pos: 0, color: [0.08, 0.02, 0.15] }, { pos: 1, color: [0.93, 0.09, 0.53] }] },
];

function GradientMapEditor({ adj, onChange }: { adj: Extract<Adjustment, { kind: "gradient-map" }>; onChange: (a: Adjustment) => void }) {
  const sorted = [...adj.stops].sort((a, b) => a.pos - b.pos);
  const css = `linear-gradient(to right, ${sorted.map((s) => `${rgb01ToHex(s.color)} ${Math.round(s.pos * 100)}%`).join(", ")})`;
  const setStop = (i: number, patch: Partial<GradientStop>) => onChange({ ...adj, stops: adj.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="space-y-3">
      <div className="h-5 w-full rounded border border-border" style={{ background: css }} />
      <div className="flex flex-wrap gap-1">
        {GRADIENT_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onChange({ ...adj, stops: p.stops })} className="rounded bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
            {p.label}
          </button>
        ))}
      </div>
      {adj.stops.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="color" value={rgb01ToHex(s.color)} onChange={(e) => setStop(i, { color: hexToRgb01(e.target.value) })} className="h-6 w-9 shrink-0 cursor-pointer rounded border border-input bg-transparent" />
          <input type="range" min={0} max={100} value={Math.round(s.pos * 100)} onChange={(e) => setStop(i, { pos: Number(e.target.value) / 100 })} className="h-1 min-w-0 flex-1 accent-[var(--primary)]" />
          <span className="w-8 text-right text-[11px] tabular-nums">{Math.round(s.pos * 100)}%</span>
          <button disabled={adj.stops.length <= 2} onClick={() => onChange({ ...adj, stops: adj.stops.filter((_, k) => k !== i) })} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Remover ponto">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onChange({ ...adj, stops: [...adj.stops, { pos: 0.5, color: [0.5, 0.5, 0.5] }] })}>
        <Plus className="h-3 w-3" /> Adicionar ponto
      </button>
      <Check label="Inverter" checked={adj.reverse} onChange={(x) => onChange({ ...adj, reverse: x })} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------------------------

/**
 * Editor dos parâmetros de um ajuste. `layerId` serve ao histograma (camadas abaixo da camada de
 * ajuste); no diálogo destrutivo passa-se o id da camada ativa.
 */
export function AdjustmentEditor({ adjustment, onChange, layerId }: { adjustment: Adjustment; onChange: (a: Adjustment) => void; layerId: string }) {
  const needsHist = adjustment.kind === "levels" || adjustment.kind === "curves";
  const hist = useHistogram(layerId, needsHist);
  const a = adjustment;
  switch (a.kind) {
    case "brightness-contrast":
      return (
        <div className="space-y-3">
          <Row label="Brilho" value={a.brightness} min={-150} max={150} onChange={(v) => onChange({ ...a, brightness: v })} />
          <Row label="Contraste" value={a.contrast} min={a.legacy ? -100 : -50} max={a.legacy ? 100 : 100} onChange={(v) => onChange({ ...a, contrast: v })} />
          <Check label="Usar modo legado" checked={a.legacy} onChange={(v) => onChange({ ...a, legacy: v })} />
        </div>
      );
    case "levels": return <LevelsEditor adj={a} onChange={onChange} hist={hist} />;
    case "curves": return <CurvesEditor adj={a} onChange={onChange} hist={hist} />;
    case "exposure":
      return (
        <div className="space-y-3">
          <Row label="Exposição" value={a.exposure} min={-20} max={20} step={0.01} decimals={2} onChange={(v) => onChange({ ...a, exposure: v })} />
          <Row label="Deslocamento" value={a.offset} min={-0.5} max={0.5} step={0.0001} decimals={4} onChange={(v) => onChange({ ...a, offset: v })} />
          <Row label="Correção de gama" value={a.gamma} min={0.01} max={9.99} step={0.01} decimals={2} onChange={(v) => onChange({ ...a, gamma: v })} />
        </div>
      );
    case "vibrance":
      return (
        <div className="space-y-3">
          <Row label="Vibração" value={a.vibrance} min={-100} max={100} onChange={(v) => onChange({ ...a, vibrance: v })} />
          <Row label="Saturação" value={a.saturation} min={-100} max={100} onChange={(v) => onChange({ ...a, saturation: v })} />
        </div>
      );
    case "hue-saturation": return <HueSatEditor adj={a} onChange={onChange} />;
    case "color-balance": return <ColorBalanceEditor adj={a} onChange={onChange} />;
    case "black-white": return <BlackWhiteEditor adj={a} onChange={onChange} />;
    case "photo-filter": return <PhotoFilterEditor adj={a} onChange={onChange} />;
    case "channel-mixer": return <ChannelMixerEditor adj={a} onChange={onChange} />;
    case "selective-color": return <SelectiveColorEditor adj={a} onChange={onChange} />;
    case "gradient-map": return <GradientMapEditor adj={a} onChange={onChange} />;
    case "posterize": return <Row label="Níveis" value={a.levels} min={2} max={255} onChange={(v) => onChange({ ...a, levels: Math.round(v) })} />;
    case "threshold": return <Row label="Nível do limiar" value={Math.round(a.level * 255)} min={1} max={255} onChange={(v) => onChange({ ...a, level: v / 255 })} />;
    case "invert": return <p className="text-xs text-muted-foreground">Inverter não tem parâmetros.</p>;
  }
}

