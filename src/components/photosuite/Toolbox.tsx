import {
  Blend, Brush, CircleDashed, Crop, Eraser, Hand, Lasso, Move, MousePointer2, PaintBucket, PenTool, Pipette, Shapes, SquareDashed, Stamp, Type, WandSparkles, ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { usePhotosuite, type Tool } from "@/src/store/photosuite.store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/src/components/ui/tooltip";
import { cn } from "@/src/lib/utils";

export const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon; group: number }[] = [
  { id: "move", label: "Mover", key: "V", icon: Move, group: 0 },
  { id: "marquee", label: "Seleção retangular", key: "M", icon: SquareDashed, group: 1 },
  { id: "ellipse", label: "Seleção elíptica", key: "Shift+M", icon: CircleDashed, group: 1 },
  { id: "lasso", label: "Laço", key: "L", icon: Lasso, group: 1 },
  { id: "wand", label: "Varinha mágica", key: "W", icon: WandSparkles, group: 1 },
  { id: "crop", label: "Recorte", key: "C", icon: Crop, group: 1 },
  { id: "brush", label: "Pincel", key: "B", icon: Brush, group: 2 },
  { id: "eraser", label: "Borracha", key: "E", icon: Eraser, group: 2 },
  { id: "clone", label: "Carimbo de clone", key: "S", icon: Stamp, group: 2 },
  { id: "gradient", label: "Degradê", key: "G", icon: Blend, group: 2 },
  { id: "bucket", label: "Balde de tinta", key: "Shift+G", icon: PaintBucket, group: 2 },
  { id: "text", label: "Texto", key: "T", icon: Type, group: 3 },
  { id: "pen", label: "Caneta", key: "P", icon: PenTool, group: 3 },
  { id: "direct", label: "Seleção direta", key: "A", icon: MousePointer2, group: 3 },
  { id: "shape", label: "Forma", key: "U", icon: Shapes, group: 3 },
  { id: "eyedropper", label: "Conta-gotas", key: "I", icon: Pipette, group: 4 },
  { id: "hand", label: "Mão", key: "H", icon: Hand, group: 4 },
  { id: "zoom", label: "Zoom", key: "Z", icon: ZoomIn, group: 4 },
];

export function Toolbox() {
  const tool = usePhotosuite((s) => s.tool);
  const setTool = usePhotosuite((s) => s.setTool);
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-2">
      {TOOLS.map((t, i) => (
        <div key={t.id} className="contents">
          {i > 0 && TOOLS[i - 1].group !== t.group && <div className="my-1 h-px w-6 bg-border" />}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTool(t.id)}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                  tool === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <t.icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t.label} ({t.key})
            </TooltipContent>
          </Tooltip>
        </div>
      ))}
    </nav>
  );
}
