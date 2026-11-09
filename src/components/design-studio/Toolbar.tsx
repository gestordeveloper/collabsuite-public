import { useRef, useState } from "react";
import {
  Type, Image as ImageIcon, Square, Circle, Minus, Smile, Undo2, Redo2,
  Download, ChevronDown, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Loader2,
  Triangle, Diamond, Pentagon, Hexagon, Star, Heart, MessageSquare, FileText, FileImage,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/src/components/ui/dropdown-menu";
import { useDesignEditorStore, genId } from "@/src/store/design-editor.store";
import { DEFAULT_TEXT, DEFAULT_SHAPE, DEFAULT_ICON, DEFAULT_IMAGE, SHAPE_LABELS, type ShapeKind } from "@/src/lib/design-studio/types";
import { DESIGN_ICONS, DESIGN_ICON_NAMES } from "@/src/lib/design-studio/icons";
import * as uploadService from "@/src/services/upload.service";

export type ExportFormat = "pdf" | "png" | "jpg";

const SHAPE_CATEGORIES: { label: string; shapes: { kind: ShapeKind; icon: LucideIcon }[] }[] = [
  {
    label: "Básicas",
    shapes: [
      { kind: "rect", icon: Square },
      { kind: "ellipse", icon: Circle },
      { kind: "triangle", icon: Triangle },
      { kind: "diamond", icon: Diamond },
      { kind: "pentagon", icon: Pentagon },
      { kind: "hexagon", icon: Hexagon },
    ],
  },
  {
    label: "Estrela e coração",
    shapes: [
      { kind: "star", icon: Star },
      { kind: "heart", icon: Heart },
    ],
  },
  {
    label: "Setas",
    shapes: [
      { kind: "arrow-right", icon: ArrowRight },
      { kind: "arrow-left", icon: ArrowLeft },
      { kind: "arrow-up", icon: ArrowUp },
      { kind: "arrow-down", icon: ArrowDown },
    ],
  },
  {
    label: "Fala e linha",
    shapes: [
      { kind: "speech-bubble", icon: MessageSquare },
      { kind: "line", icon: Minus },
    ],
  },
];

const SHAPE_DEFAULT_SIZE: Partial<Record<ShapeKind, { w: number; h: number }>> = {
  line: { w: 300, h: 6 },
  triangle: { w: 200, h: 180 },
  diamond: { w: 200, h: 200 },
  pentagon: { w: 200, h: 190 },
  hexagon: { w: 220, h: 190 },
  star: { w: 200, h: 200 },
  "arrow-right": { w: 220, h: 120 },
  "arrow-left": { w: 220, h: 120 },
  "arrow-up": { w: 120, h: 220 },
  "arrow-down": { w: 120, h: 220 },
  "speech-bubble": { w: 220, h: 180 },
  heart: { w: 200, h: 180 },
};

interface ToolbarProps {
  name: string;
  onRename: (name: string) => void;
  onBack: () => void;
  onExport: (format: ExportFormat) => Promise<void>;
  saving?: boolean;
}

export function Toolbar({ name, onRename, onBack, onExport, saving }: ToolbarProps) {
  const doc = useDesignEditorStore((s) => s.doc);
  const currentPageId = useDesignEditorStore((s) => s.currentPageId);
  const addElement = useDesignEditorStore((s) => s.addElement);
  const history = useDesignEditorStore((s) => s.history);
  const future = useDesignEditorStore((s) => s.future);
  const undo = useDesignEditorStore((s) => s.undo);
  const redo = useDesignEditorStore((s) => s.redo);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const page = doc?.pages.find((p) => p.id === currentPageId);

  function nextZIndex(): number {
    if (!page || page.elements.length === 0) return 0;
    return Math.max(...page.elements.map((e) => e.zIndex)) + 1;
  }

  function centerFor(width: number, height: number) {
    if (!page) return { x: 0, y: 0 };
    return { x: (page.width - width) / 2, y: (page.height - height) / 2 };
  }

  function handleAddText() {
    if (!page) return;
    const pos = centerFor(DEFAULT_TEXT.width, DEFAULT_TEXT.height);
    addElement(page.id, { id: genId(), ...pos, zIndex: nextZIndex(), ...DEFAULT_TEXT });
  }

  function handleAddShape(shape: ShapeKind) {
    if (!page) return;
    const size = SHAPE_DEFAULT_SIZE[shape];
    const width = size?.w ?? DEFAULT_SHAPE.width;
    const height = size?.h ?? DEFAULT_SHAPE.height;
    const pos = centerFor(width, height);
    addElement(page.id, { id: genId(), ...pos, zIndex: nextZIndex(), ...DEFAULT_SHAPE, width, height, shape });
  }

  function handleAddIcon(iconName: string) {
    if (!page) return;
    const pos = centerFor(DEFAULT_ICON.width, DEFAULT_ICON.height);
    addElement(page.id, { id: genId(), ...pos, zIndex: nextZIndex(), ...DEFAULT_ICON, name: iconName });
  }

  async function handleAddImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !page) return;
    setUploading(true);
    try {
      const url = await uploadService.uploadImage(file);
      const pos = centerFor(DEFAULT_IMAGE.width, DEFAULT_IMAGE.height);
      addElement(page.id, { id: genId(), ...pos, zIndex: nextZIndex(), ...DEFAULT_IMAGE, url });
    } catch (err) {
      console.error("Falha no upload da imagem", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleExport(format: ExportFormat) {
    setExporting(true);
    try {
      await onExport(format);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-14 flex-shrink-0 items-center gap-2 border-b bg-card px-3">
      <Button variant="ghost" size="icon" onClick={onBack} title="Voltar">
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <Input
        value={name}
        onChange={(e) => onRename(e.target.value)}
        className="h-8 w-48 border-none bg-transparent text-sm font-semibold shadow-none focus-visible:ring-1"
      />

      <div className="mx-1 h-6 w-px bg-border" />

      <Button variant="ghost" size="icon" onClick={handleAddText} title="Adicionar texto">
        <Type className="h-4 w-4" />
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" title="Adicionar forma">
            <Square className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-3 p-3">
          {SHAPE_CATEGORIES.map((category) => (
            <div key={category.label} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{category.label}</p>
              <div className="flex flex-wrap gap-1">
                {category.shapes.map(({ kind, icon: Icon }) => (
                  <button
                    key={kind}
                    onClick={() => handleAddShape(kind)}
                    className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
                    title={SHAPE_LABELS[kind]}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" title="Adicionar ícone">
            <Smile className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="grid grid-cols-6 gap-1">
            {DESIGN_ICON_NAMES.map((iconName) => {
              const Icon = DESIGN_ICONS[iconName];
              return (
                <button
                  key={iconName}
                  onClick={() => handleAddIcon(iconName)}
                  className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
                  title={iconName}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} title="Adicionar imagem" disabled={uploading}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
      </Button>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAddImage} className="hidden" />

      <div className="mx-1 h-6 w-px bg-border" />

      <Button variant="ghost" size="icon" onClick={undo} disabled={history.length === 0} title="Desfazer">
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={redo} disabled={future.length === 0} title="Refazer">
        <Redo2 className="h-4 w-4" />
      </Button>

      <div className="flex-1" />

      {saving && <span className="text-xs text-muted-foreground animate-pulse">Salvando...</span>}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport("pdf")}>
            <FileText className="h-4 w-4" /> PDF — todas as páginas
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport("png")}>
            <FileImage className="h-4 w-4" /> PNG — página atual{page?.background.type === "transparent" ? " (fundo transparente)" : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport("jpg")}>
            <FileImage className="h-4 w-4" /> JPG — página atual
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
