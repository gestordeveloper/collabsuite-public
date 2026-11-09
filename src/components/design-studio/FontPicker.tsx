import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Upload, Trash2, Check, Loader2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { useDesignEditorStore } from "@/src/store/design-editor.store";
import { GOOGLE_FONTS, cleanFamilyName, ensureFontsPreview } from "@/src/lib/design-studio/fonts";
import * as uploadService from "@/src/services/upload.service";
import * as customFontService from "@/src/services/custom-font.service";
import { cn } from "@/src/lib/utils";

const MAX_RESULTS = 80;

interface Props {
  value: string;
  onChange: (family: string) => void;
}

export function FontPicker({ value, onChange }: Props) {
  const customFonts = useDesignEditorStore((s) => s.customFonts);
  const addCustomFont = useDesignEditorStore((s) => s.addCustomFont);
  const removeCustomFont = useDesignEditorStore((s) => s.removeCustomFont);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFamily = cleanFamilyName(value);
  const customFamilies = useMemo(() => {
    const seen = new Map<string, number>();
    customFonts.forEach((f) => seen.set(f.family, f.id));
    return Array.from(seen.entries()).map(([family, id]) => ({ family, id }));
  }, [customFonts]);

  const filteredGoogleFonts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? GOOGLE_FONTS.filter((f) => f.family.toLowerCase().includes(q)) : GOOGLE_FONTS;
    return matches.slice(0, MAX_RESULTS);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    ensureFontsPreview(filteredGoogleFonts.map((f) => f.family));
  }, [open, filteredGoogleFonts]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadService.uploadFile(file);
      const family = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, "").replace(/[-_]+/g, " ").trim() || "Fonte personalizada";
      const font = await customFontService.createCustomFont({ family, url, weight: 400, style: "normal" });
      addCustomFont(font);
      onChange(font.family);
      setOpen(false);
    } catch (err) {
      console.error("Falha ao enviar fonte", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteCustomFont(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    try {
      await customFontService.deleteCustomFont(id);
      removeCustomFont(id);
    } catch (err) {
      console.error("Falha ao excluir fonte", err);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-surface px-3 text-sm"
          style={{ fontFamily: `"${currentFamily}", sans-serif` }}
        >
          <span className="truncate">{currentFamily}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center gap-2 border-b p-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar fonte..."
            className="h-7 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-1">
          {customFamilies.length > 0 && (
            <div className="mb-1 border-b pb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Suas fontes</p>
              {customFamilies
                .filter((f) => f.family.toLowerCase().includes(query.trim().toLowerCase()))
                .map((f) => (
                  <button
                    key={f.family}
                    onClick={() => { onChange(f.family); setOpen(false); }}
                    className="group flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate" style={{ fontFamily: `"${f.family}", sans-serif` }}>{f.family}</span>
                    <span className="flex items-center gap-1">
                      {currentFamily === f.family && <Check className="h-3.5 w-3.5 text-primary" />}
                      <span
                        onClick={(e) => handleDeleteCustomFont(e, f.id)}
                        className="hidden rounded p-1 text-destructive hover:bg-destructive/10 group-hover:block"
                        title="Excluir fonte"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          )}

          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Google Fonts</p>
          {filteredGoogleFonts.map((f) => (
            <button
              key={f.family}
              onClick={() => { onChange(f.family); setOpen(false); }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                currentFamily === f.family && "bg-accent"
              )}
            >
              <span className="truncate" style={{ fontFamily: `"${f.family}", sans-serif` }}>{f.family}</span>
              {currentFamily === f.family && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </button>
          ))}
          {filteredGoogleFonts.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhuma fonte encontrada.</p>
          )}
        </div>

        <div className="border-t p-2">
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Enviar fonte (.ttf, .otf, .woff)
          </Button>
          <input ref={fileInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleUpload} className="hidden" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
