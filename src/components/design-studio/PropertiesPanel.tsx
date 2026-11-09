import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, BringToFront, SendToBack, ChevronUp, ChevronDown, Copy, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { ImageUpload } from "@/src/components/common/ImageUpload";
import { useDesignEditorStore } from "@/src/store/design-editor.store";
import { DESIGN_ICONS, DESIGN_ICON_NAMES } from "@/src/lib/design-studio/icons";
import { FRAME_KINDS, FRAME_LABELS, frameToClipPath, type DesignElement, type FrameKind } from "@/src/lib/design-studio/types";
import { FONT_WEIGHTS } from "@/src/lib/design-studio/fonts";
import { cn } from "@/src/lib/utils";
import { PagePropertiesPanel } from "./PagePropertiesPanel";
import { FontPicker } from "./FontPicker";

export function PropertiesPanel() {
  const doc = useDesignEditorStore((s) => s.doc);
  const currentPageId = useDesignEditorStore((s) => s.currentPageId);
  const selectedElementIds = useDesignEditorStore((s) => s.selectedElementIds);
  const updateElement = useDesignEditorStore((s) => s.updateElement);
  const removeElements = useDesignEditorStore((s) => s.removeElements);
  const duplicateElement = useDesignEditorStore((s) => s.duplicateElement);
  const reorderElement = useDesignEditorStore((s) => s.reorderElement);
  const snapshot = useDesignEditorStore((s) => s.snapshot);

  const page = doc?.pages.find((p) => p.id === currentPageId);
  const selected = page?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];

  if (!page) return null;

  if (selected.length === 0) {
    return <PagePropertiesPanel page={page} />;
  }

  function patch(patchValue: Partial<DesignElement>, withSnapshot = false) {
    if (withSnapshot) snapshot();
    selected.forEach((el) => updateElement(page!.id, el.id, patchValue));
  }

  const single = selected.length === 1 ? selected[0] : null;

  return (
    <aside className="flex w-72 flex-shrink-0 flex-col gap-4 overflow-y-auto border-l bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {selected.length > 1 ? `${selected.length} elementos` : single?.kind}
        </p>
        <div className="flex items-center gap-1">
          {single && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateElement(page.id, single.id)} title="Duplicar">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() => removeElements(page.id, selected.map((el) => el.id))}
            title="Excluir"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {single?.kind === "text" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Fonte</Label>
            <FontPicker value={single.fontFamily} onChange={(fontFamily) => patch({ fontFamily }, true)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Estilo</Label>
              <select
                value={single.fontWeight ?? 400}
                onChange={(e) => patch({ fontWeight: Number(e.target.value) }, true)}
                className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
              >
                {FONT_WEIGHTS.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Tamanho</Label>
              <Input
                type="number"
                value={single.fontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) || 1 }, true)}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <input type="color" value={single.color} onChange={(e) => patch({ color: e.target.value }, true)} className="h-9 w-9 rounded-md border border-input p-0.5" />
            <div className="mx-1 h-6 w-px bg-border" />
            <Button
              variant={(single.fontWeight ?? 400) >= 700 ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              title="Negrito"
              onClick={() => patch({ fontWeight: (single.fontWeight ?? 400) >= 700 ? 400 : 700 }, true)}
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              variant={single.italic ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              title="Itálico"
              onClick={() => patch({ italic: !single.italic }, true)}
            >
              <Italic className="h-4 w-4" />
            </Button>
            <Button
              variant={single.underline ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              title="Sublinhado"
              onClick={() => patch({ underline: !single.underline }, true)}
            >
              <Underline className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <Button variant={single.align === "left" ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => patch({ align: "left" }, true)}>
              <AlignLeft className="h-4 w-4" />
            </Button>
            <Button variant={single.align === "center" ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => patch({ align: "center" }, true)}>
              <AlignCenter className="h-4 w-4" />
            </Button>
            <Button variant={single.align === "right" ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => patch({ align: "right" }, true)}>
              <AlignRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {single?.kind === "image" && (
        <div className="space-y-3">
          <ImageUpload label="Imagem" value={single.url} onChange={(url) => patch({ url }, true)} previewClass="h-24 w-full" />
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Ajuste</Label>
            <div className="flex gap-1.5">
              <Button variant={single.objectFit === "cover" ? "secondary" : "outline"} size="sm" className="flex-1" onClick={() => patch({ objectFit: "cover" }, true)}>
                Preencher
              </Button>
              <Button variant={single.objectFit === "contain" ? "secondary" : "outline"} size="sm" className="flex-1" onClick={() => patch({ objectFit: "contain" }, true)}>
                Ajustar
              </Button>
            </div>
          </div>
          {!single.frame && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Raio da borda</Label>
              <Input type="number" min={0} value={single.borderRadius ?? 0} onChange={(e) => patch({ borderRadius: Number(e.target.value) || 0 }, true)} className="h-9" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Moldura</Label>
            <div className="grid grid-cols-5 gap-1.5">
              <button
                onClick={() => patch({ frame: undefined }, true)}
                className={cn(
                  "flex h-9 items-center justify-center rounded-md border text-[10px] text-muted-foreground hover:bg-accent",
                  !single.frame && "border-primary bg-accent"
                )}
                title="Livre (retangular)"
              >
                Livre
              </button>
              {FRAME_KINDS.map((frame) => (
                <button
                  key={frame}
                  onClick={() => patch({ frame }, true)}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-md border hover:bg-accent",
                    single.frame === frame && "border-primary bg-accent"
                  )}
                  title={FRAME_LABELS[frame]}
                >
                  <span className="block h-5 w-5 bg-foreground/70" style={{ clipPath: frameToClipPath(frame) }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {single?.kind === "shape" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Preenchimento</Label>
            <input type="color" value={single.fill} onChange={(e) => patch({ fill: e.target.value }, true)} className="h-9 w-full rounded-md border border-input p-0.5" />
          </div>
          {(single.shape === "rect" || single.shape === "ellipse") && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Borda</Label>
                <input type="color" value={single.stroke || "#000000"} onChange={(e) => patch({ stroke: e.target.value }, true)} className="h-9 w-full rounded-md border border-input p-0.5" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Espessura da borda</Label>
                <Input type="number" min={0} value={single.strokeWidth ?? 0} onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 0 }, true)} className="h-9" />
              </div>
              {single.shape === "rect" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Raio da borda</Label>
                  <Input type="number" min={0} value={single.borderRadius ?? 0} onChange={(e) => patch({ borderRadius: Number(e.target.value) || 0 }, true)} className="h-9" />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {single?.kind === "icon" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Cor</Label>
            <input type="color" value={single.color} onChange={(e) => patch({ color: e.target.value }, true)} className="h-9 w-full rounded-md border border-input p-0.5" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Ícone</Label>
            <div className="grid grid-cols-6 gap-1">
              {DESIGN_ICON_NAMES.map((iconName) => {
                const Icon = DESIGN_ICONS[iconName];
                return (
                  <button
                    key={iconName}
                    onClick={() => patch({ name: iconName }, true)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent",
                      single.name === iconName && "bg-accent"
                    )}
                    title={iconName}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5 border-t pt-3">
        <Label className="text-xs font-semibold">Opacidade</Label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={single?.opacity ?? 1}
          onChange={(e) => patch({ opacity: Number(e.target.value) }, true)}
          className="w-full"
        />
      </div>

      {single && (
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">X</Label>
            <Input type="number" value={Math.round(single.x)} onChange={(e) => patch({ x: Number(e.target.value) || 0 }, true)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Y</Label>
            <Input type="number" value={Math.round(single.y)} onChange={(e) => patch({ y: Number(e.target.value) || 0 }, true)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Largura</Label>
            <Input type="number" value={Math.round(single.width)} onChange={(e) => patch({ width: Number(e.target.value) || 1 }, true)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Altura</Label>
            <Input type="number" value={Math.round(single.height)} onChange={(e) => patch({ height: Number(e.target.value) || 1 }, true)} className="h-9" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs font-semibold">Rotação</Label>
            <Input type="number" value={Math.round(single.rotation)} onChange={(e) => patch({ rotation: Number(e.target.value) || 0 }, true)} className="h-9" />
          </div>
        </div>
      )}

      {single && (
        <div className="space-y-1.5 border-t pt-3">
          <Label className="text-xs font-semibold">Camada</Label>
          <div className="grid grid-cols-4 gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => reorderElement(page.id, single.id, "back")} title="Enviar para trás">
              <SendToBack className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => reorderElement(page.id, single.id, "backward")} title="Recuar">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => reorderElement(page.id, single.id, "forward")} title="Avançar">
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => reorderElement(page.id, single.id, "front")} title="Trazer para frente">
              <BringToFront className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
