import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, Strikethrough, Underline } from "lucide-react";
import { FONT_WEIGHTS } from "@/src/lib/design-studio/fonts";
import { findLayer } from "@/src/lib/photosuite/tree";
import type { TextAlign, TextData } from "@/src/lib/photosuite/text";
import { usePhotosuite, type TextStyle } from "@/src/store/photosuite.store";
import { cn } from "@/src/lib/utils";
import { FontPicker } from "./FontPicker";

/**
 * Alvo dos controles de texto: a camada de texto ativa (cada mudança vira um passo de histórico
 * coalescido) ou, sem camada de texto ativa, os padrões usados nos próximos textos.
 */
export function useTextTarget(): { style: TextStyle; layerId: string | null; apply: (patch: Partial<TextStyle>) => void } {
  const layers = usePhotosuite((s) => s.layers);
  const activeId = usePhotosuite((s) => s.activeId);
  const defaults = usePhotosuite((s) => s.textStyle);
  const setText = usePhotosuite((s) => s.setText);
  const setTextStyle = usePhotosuite((s) => s.setTextStyle);
  const found = activeId ? findLayer(layers, activeId)?.layer : null;
  const text: TextData | undefined = found && found.type === "raster" && !found.locked ? found.text : undefined;
  if (text && found) {
    return {
      style: text,
      layerId: found.id,
      apply: (patch) => {
        setText(found.id, patch, { label: "Texto", coalesce: `textstyle-${found.id}-${Object.keys(patch).join(",")}` });
        setTextStyle(patch); // o próximo texto herda o último ajuste
      },
    };
  }
  return { style: defaults, layerId: null, apply: setTextStyle };
}

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input", on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-accent")}
    >
      {children}
    </button>
  );
}

function Num({ label, value, onChange, min, max, step = 1, width = "w-14" }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: string }) {
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
        className={cn("h-7 rounded border border-input bg-secondary px-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary", width)}
      />
    </label>
  );
}

const ALIGNS: { id: TextAlign; icon: typeof AlignLeft; title: string }[] = [
  { id: "left", icon: AlignLeft, title: "Alinhar à esquerda" },
  { id: "center", icon: AlignCenter, title: "Centralizar" },
  { id: "right", icon: AlignRight, title: "Alinhar à direita" },
  { id: "justify", icon: AlignJustify, title: "Justificar (texto de parágrafo)" },
];

/** `bar`: uma linha compacta na barra de opções; `panel`: coluna completa no painel lateral. */
export function TextControls({ layout }: { layout: "bar" | "panel" }) {
  const { style, apply } = useTextTarget();
  const bar = layout === "bar";

  const row = (children: React.ReactNode) => <div className={cn("flex items-center gap-2", !bar && "flex-wrap")}>{children}</div>;

  return (
    <div className={cn(bar ? "flex shrink-0 items-center gap-2" : "space-y-2.5")}>
      {row(
        <>
          <FontPicker value={style.family} onChange={(family) => apply({ family })} className={bar ? "w-36" : "flex-1"} />
          <select
            value={style.weight}
            onChange={(e) => apply({ weight: Number(e.target.value) })}
            className="h-7 shrink-0 rounded border border-input bg-secondary px-1 text-xs outline-none"
            title="Peso"
          >
            {FONT_WEIGHTS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
          <Num label="Tam." value={style.size} min={1} max={2000} onChange={(size) => apply({ size })} />
        </>,
      )}
      {row(
        <>
          <Toggle on={style.weight >= 700} title="Negrito" onClick={() => apply({ weight: style.weight >= 700 ? 400 : 700 })}><Bold className="h-3.5 w-3.5" /></Toggle>
          <Toggle on={style.italic} title="Itálico" onClick={() => apply({ italic: !style.italic })}><Italic className="h-3.5 w-3.5" /></Toggle>
          <Toggle on={style.underline} title="Sublinhado" onClick={() => apply({ underline: !style.underline })}><Underline className="h-3.5 w-3.5" /></Toggle>
          <Toggle on={style.strikethrough} title="Tachado" onClick={() => apply({ strikethrough: !style.strikethrough })}><Strikethrough className="h-3.5 w-3.5" /></Toggle>
          <span className={bar ? "mx-0.5 h-5 w-px bg-border" : "w-2"} />
          {ALIGNS.map((a) => (
            <Toggle key={a.id} on={style.align === a.id} title={a.title} onClick={() => apply({ align: a.id })}><a.icon className="h-3.5 w-3.5" /></Toggle>
          ))}
          <input
            type="color"
            value={style.color}
            onChange={(e) => apply({ color: e.target.value })}
            title="Cor do texto"
            className="h-7 w-8 shrink-0 cursor-pointer rounded border border-input bg-transparent"
          />
        </>,
      )}
      {!bar && (
        <>
          {row(
            <>
              <Num label="Tracking" value={style.tracking} min={-500} max={2000} step={5} width="w-16" onChange={(tracking) => apply({ tracking })} />
              <Num label="Entrelinha" value={style.leading ?? style.size * 1.2} min={1} max={4000} width="w-16" onChange={(leading) => apply({ leading })} />
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={style.leading === null} onChange={(e) => apply({ leading: e.target.checked ? null : style.size * 1.2 })} className="accent-[var(--primary)]" />
                Auto
              </label>
            </>,
          )}
          {row(
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              Caixa
              <select value={style.caps} onChange={(e) => apply({ caps: e.target.value as TextStyle["caps"] })} className="h-7 rounded border border-input bg-secondary px-1 text-xs text-foreground outline-none">
                <option value="normal">Normal</option>
                <option value="upper">TUDO MAIÚSCULO</option>
                <option value="small">Versalete</option>
              </select>
            </label>,
          )}
        </>
      )}
    </div>
  );
}
