import { Palette, Image as ImageIcon, Blend, Grid2x2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { ImageUpload } from "@/src/components/common/ImageUpload";
import { useDesignEditorStore } from "@/src/store/design-editor.store";
import {
  PAGE_SIZE_PRESETS,
  editorBackgroundCss,
  type DesignPage,
  type PageBackground,
} from "@/src/lib/design-studio/types";
import { cn } from "@/src/lib/utils";

interface Props {
  page: DesignPage;
}

export function PagePropertiesPanel({ page }: Props) {
  const updatePageBackground = useDesignEditorStore((s) => s.updatePageBackground);
  const updatePageSize = useDesignEditorStore((s) => s.updatePageSize);

  const bg = page.background;

  function setBackground(next: PageBackground) {
    updatePageBackground(page.id, next);
  }

  return (
    <aside className="flex w-72 flex-shrink-0 flex-col gap-5 overflow-y-auto border-l bg-card p-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Página</p>
        <div className="h-16 w-full rounded-lg border" style={editorBackgroundCss(bg)} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold">Plano de fundo</Label>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant={bg.type === "solid" ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setBackground({ type: "solid", color: bg.type === "solid" ? bg.color : "#ffffff" })}
          >
            <Palette className="h-3.5 w-3.5" /> Cor
          </Button>
          <Button
            variant={bg.type === "gradient" ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() =>
              setBackground(
                bg.type === "gradient" ? bg : { type: "gradient", angle: 135, from: "#4f46e5", to: "#a855f7" }
              )
            }
          >
            <Blend className="h-3.5 w-3.5" /> Degradê
          </Button>
          <Button
            variant={bg.type === "image" ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() =>
              setBackground(bg.type === "image" ? bg : { type: "image", url: "", size: "cover" })
            }
          >
            <ImageIcon className="h-3.5 w-3.5" /> Imagem
          </Button>
          <Button
            variant={bg.type === "transparent" ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setBackground({ type: "transparent" })}
          >
            <Grid2x2 className="h-3.5 w-3.5" /> Transparente
          </Button>
        </div>
        {bg.type === "transparent" && (
          <p className="text-[11px] text-muted-foreground">
            Sem cor de fundo — ao exportar em PNG, a página sai com fundo transparente.
          </p>
        )}
      </div>

      {bg.type === "solid" && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Cor</Label>
          <div className="flex gap-2">
            <input
              type="color"
              value={bg.color}
              onChange={(e) => setBackground({ type: "solid", color: e.target.value })}
              className="h-9 w-14 rounded-md border border-input p-0.5"
            />
            <Input value={bg.color} onChange={(e) => setBackground({ type: "solid", color: e.target.value })} className="h-9 flex-1" />
          </div>
        </div>
      )}

      {bg.type === "gradient" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">De</Label>
              <input
                type="color"
                value={bg.from}
                onChange={(e) => setBackground({ ...bg, from: e.target.value })}
                className="h-9 w-full rounded-md border border-input p-0.5"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Para</Label>
              <input
                type="color"
                value={bg.to}
                onChange={(e) => setBackground({ ...bg, to: e.target.value })}
                className="h-9 w-full rounded-md border border-input p-0.5"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Ângulo</Label>
            <input
              type="range"
              min={0}
              max={360}
              value={bg.angle}
              onChange={(e) => setBackground({ ...bg, angle: Number(e.target.value) })}
              className="w-full"
            />
          </div>
        </div>
      )}

      {bg.type === "image" && (
        <div className="space-y-3">
          <ImageUpload label="Imagem de fundo" value={bg.url} onChange={(url) => setBackground({ ...bg, url })} previewClass="h-24 w-full" />
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Ajuste</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["cover", "contain", "repeat"] as const).map((size) => (
                <Button
                  key={size}
                  variant={bg.size === size ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setBackground({ ...bg, size })}
                >
                  {size === "cover" ? "Preencher" : size === "contain" ? "Ajustar" : "Repetir"}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t pt-4">
        <Label className="text-xs font-semibold">Tamanho da página</Label>
        <div className="grid grid-cols-1 gap-1">
          {PAGE_SIZE_PRESETS.map((preset) => {
            const active = page.width === preset.width && page.height === preset.height;
            return (
              <button
                key={preset.label}
                onClick={() => updatePageSize(page.id, preset.width, preset.height)}
                className={cn(
                  "flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-accent",
                  active && "bg-accent font-medium"
                )}
              >
                <span>{preset.label}</span>
                <span className="text-muted-foreground">{preset.width}×{preset.height}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Largura</Label>
            <Input
              type="number"
              min={1}
              value={page.width}
              onChange={(e) => updatePageSize(page.id, Number(e.target.value) || 1, page.height)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Altura</Label>
            <Input
              type="number"
              min={1}
              value={page.height}
              onChange={(e) => updatePageSize(page.id, page.width, Number(e.target.value) || 1)}
              className="h-9"
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
