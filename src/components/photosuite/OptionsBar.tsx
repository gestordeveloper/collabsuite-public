import { Check, X } from "lucide-react";
import { usePhotosuite, type ToolOpts } from "@/src/store/photosuite.store";
import type { SelMode } from "@/src/lib/photosuite/selection";
import type { GradientType } from "@/src/lib/photosuite/fill";
import { cn } from "@/src/lib/utils";
import { TOOLS } from "./Toolbox";
import { TextControls } from "./TextControls";
import { ShapeStyleControls, ShapeToolControls } from "./ShapeControls";

function Slider({ label, value, min, max, onChange, suffix = "" }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
      {label}
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-24 accent-[var(--primary)]" />
      <span className="w-10 text-foreground tabular-nums">
        {value}
        {suffix}
      </span>
    </label>
  );
}

function Check2({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--primary)]" />
      {label}
    </label>
  );
}

const SEL_MODES: { id: SelMode; label: string; title: string }[] = [
  { id: "new", label: "Nova", title: "Nova seleção" },
  { id: "add", label: "+", title: "Somar à seleção (Shift)" },
  { id: "sub", label: "−", title: "Subtrair da seleção (Alt)" },
  { id: "int", label: "∩", title: "Interseção (Shift+Alt)" },
];

function ModeButtons({ value, onChange }: { value: SelMode; onChange: (m: SelMode) => void }) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded border border-input">
      {SEL_MODES.map((m) => (
        <button
          key={m.id}
          title={m.title}
          onClick={() => onChange(m.id)}
          className={cn("px-2 py-0.5 text-[11px]", value === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function NumField({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="h-6 w-16 rounded border border-input bg-secondary px-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
      />
      {suffix}
    </label>
  );
}

function ConfirmButtons({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  return (
    <div className="flex shrink-0 gap-1">
      <button onClick={onOk} title="Confirmar (Enter)" className="flex h-6 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground">
        <Check className="h-3.5 w-3.5" /> Confirmar
      </button>
      <button onClick={onCancel} title="Cancelar (Esc)" className="flex h-6 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-accent">
        <X className="h-3.5 w-3.5" /> Cancelar
      </button>
    </div>
  );
}

/** Opções da ferramenta ativa (equivalente à barra de opções do Photoshop). */
export function OptionsBar() {
  const tool = usePhotosuite((s) => s.tool);
  const brush = usePhotosuite((s) => s.brush);
  const setBrush = usePhotosuite((s) => s.setBrush);
  const opts = usePhotosuite((s) => s.opts);
  const setOpts = usePhotosuite((s) => s.setOpts);
  const transform = usePhotosuite((s) => s.transform);
  const setTransform = usePhotosuite((s) => s.setTransform);
  const commitTransform = usePhotosuite((s) => s.commitTransform);
  const cancelTransform = usePhotosuite((s) => s.cancelTransform);
  const crop = usePhotosuite((s) => s.crop);
  const setCrop = usePhotosuite((s) => s.setCrop);
  const commitCrop = usePhotosuite((s) => s.commitCrop);
  const zoom = usePhotosuite((s) => s.view.zoom);
  const requestView = usePhotosuite((s) => s.requestView);
  const current = TOOLS.find((t) => t.id === tool);
  const set = <K extends keyof ToolOpts>(k: K, v: ToolOpts[K]) => setOpts({ [k]: v } as Partial<ToolOpts>);

  const brushLike = tool === "brush" || tool === "eraser" || tool === "clone";
  const selTool = tool === "marquee" || tool === "ellipse" || tool === "lasso" || tool === "wand";

  return (
    <div className="flex h-9 shrink-0 items-center gap-5 overflow-x-auto border-b border-border bg-card px-3">
      {transform ? (
        <>
          <span className="shrink-0 text-xs font-medium">Transformação livre</span>
          <NumField label="X" value={transform.cx} onChange={(v) => setTransform({ ...transform, cx: v })} />
          <NumField label="Y" value={transform.cy} onChange={(v) => setTransform({ ...transform, cy: v })} />
          <NumField label="L" suffix="%" value={transform.sx * 100} onChange={(v) => v !== 0 && setTransform({ ...transform, sx: v / 100 })} />
          <NumField label="A" suffix="%" value={transform.sy * 100} onChange={(v) => v !== 0 && setTransform({ ...transform, sy: v / 100 })} />
          <NumField label="∠" suffix="°" step={0.5} value={(transform.rot * 180) / Math.PI} onChange={(v) => setTransform({ ...transform, rot: (v * Math.PI) / 180 })} />
          <ConfirmButtons onOk={commitTransform} onCancel={cancelTransform} />
        </>
      ) : (
        <>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
            {current && <current.icon className="h-3.5 w-3.5 text-muted-foreground" />}
            {current?.label}
          </span>

          {selTool && <ModeButtons value={opts.selMode} onChange={(m) => set("selMode", m)} />}
          {(tool === "marquee" || tool === "ellipse" || tool === "lasso" || tool === "wand") && (
            <Slider label="Pena" value={opts.feather} min={0} max={100} suffix="px" onChange={(v) => set("feather", v)} />
          )}
          {tool === "wand" && (
            <>
              <Slider label="Tolerância" value={opts.wandTolerance} min={0} max={255} onChange={(v) => set("wandTolerance", v)} />
              <Check2 label="Contíguo" checked={opts.wandContiguous} onChange={(v) => set("wandContiguous", v)} />
              <Check2 label="Todas as camadas" checked={opts.wandSampleAll} onChange={(v) => set("wandSampleAll", v)} />
            </>
          )}

          {tool === "bucket" && (
            <>
              <Slider label="Tolerância" value={opts.bucketTolerance} min={0} max={255} onChange={(v) => set("bucketTolerance", v)} />
              <Slider label="Opacidade" value={Math.round(opts.bucketOpacity * 100)} min={1} max={100} suffix="%" onChange={(v) => set("bucketOpacity", v / 100)} />
              <Check2 label="Contíguo" checked={opts.bucketContiguous} onChange={(v) => set("bucketContiguous", v)} />
              <Check2 label="Todas as camadas" checked={opts.bucketSampleAll} onChange={(v) => set("bucketSampleAll", v)} />
            </>
          )}

          {tool === "gradient" && (
            <>
              <select
                value={opts.gradientType}
                onChange={(e) => set("gradientType", e.target.value as GradientType)}
                className="h-6 shrink-0 rounded border border-input bg-secondary px-1.5 text-xs outline-none"
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
                <option value="angle">Angular</option>
                <option value="reflected">Refletido</option>
              </select>
              <Check2 label="Cor de frente → transparente" checked={opts.gradientToTransparent} onChange={(v) => set("gradientToTransparent", v)} />
              <Slider label="Opacidade" value={Math.round(opts.gradientOpacity * 100)} min={1} max={100} suffix="%" onChange={(v) => set("gradientOpacity", v / 100)} />
              <span className="shrink-0 text-[11px] text-muted-foreground">Arraste na imagem (Shift = 45°).</span>
            </>
          )}

          {brushLike && (
            <>
              <Slider label="Tamanho" value={brush.size} min={1} max={500} suffix="px" onChange={(size) => setBrush({ size })} />
              <Slider label="Dureza" value={Math.round(brush.hardness * 100)} min={0} max={100} suffix="%" onChange={(v) => setBrush({ hardness: v / 100 })} />
              <Slider label="Opacidade" value={Math.round(brush.opacity * 100)} min={1} max={100} suffix="%" onChange={(v) => setBrush({ opacity: v / 100 })} />
              <Slider label="Fluxo" value={Math.round(brush.flow * 100)} min={1} max={100} suffix="%" onChange={(v) => setBrush({ flow: v / 100 })} />
            </>
          )}
          {tool === "clone" && (
            <>
              <Check2 label="Alinhado" checked={opts.cloneAligned} onChange={(v) => set("cloneAligned", v)} />
              <span className="shrink-0 text-[11px] text-muted-foreground">Alt+clique define a origem.</span>
            </>
          )}

          {tool === "crop" && (
            <>
              {crop ? (
                <>
                  <NumField label="X" value={crop.x} onChange={(v) => setCrop({ ...crop, x: v })} />
                  <NumField label="Y" value={crop.y} onChange={(v) => setCrop({ ...crop, y: v })} />
                  <NumField label="L" value={crop.w} onChange={(v) => v > 0 && setCrop({ ...crop, w: v })} />
                  <NumField label="A" value={crop.h} onChange={(v) => v > 0 && setCrop({ ...crop, h: v })} />
                  <ConfirmButtons onOk={commitCrop} onCancel={() => setCrop(null)} />
                </>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground">Arraste para definir a área; Enter ou duplo clique confirma.</span>
              )}
            </>
          )}

          {tool === "text" && (
            <>
              <TextControls layout="bar" />
              <span className="shrink-0 text-[11px] text-muted-foreground">Clique para texto de ponto; arraste para texto de parágrafo.</span>
            </>
          )}
          {tool === "shape" && (
            <>
              <ShapeToolControls />
              <ShapeStyleControls layout="bar" />
            </>
          )}
          {tool === "pen" && (
            <>
              <ShapeStyleControls layout="bar" />
              <span className="shrink-0 text-[11px] text-muted-foreground">Clique = ponto de canto; arraste = ponto suave. Clique no 1º ponto fecha; Enter termina.</span>
            </>
          )}
          {tool === "direct" && <span className="shrink-0 text-[11px] text-muted-foreground">Arraste pontos e alças. Alt+clique converte o ponto; duplo clique no traço adiciona; Delete exclui.</span>}
          {tool === "move" && <span className="shrink-0 text-[11px] text-muted-foreground">Arraste para mover a camada (ou grupo). Ctrl+clique escolhe a camada sob o cursor.</span>}
          {tool === "eyedropper" && <span className="shrink-0 text-[11px] text-muted-foreground">Clique para amostrar a cor (Shift = cor de fundo).</span>}
          {tool === "zoom" && <span className="shrink-0 text-[11px] text-muted-foreground">Clique para ampliar, Alt+clique para reduzir.</span>}
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
        <button onClick={() => requestView("fit")} className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
          Ajustar
        </button>
        <button onClick={() => requestView("actual")} className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
          100%
        </button>
        <span className="w-12 text-right tabular-nums text-foreground">{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
