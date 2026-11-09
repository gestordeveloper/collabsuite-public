import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { GOOGLE_FONTS, cleanFamilyName, ensureFontsPreview, registerCustomFonts } from "@/src/lib/design-studio/fonts";
import * as customFontService from "@/src/services/custom-font.service";
import * as uploadService from "@/src/services/upload.service";
import type { CustomFont } from "@/src/types";
import { cn } from "@/src/lib/utils";

const SYSTEM_FONTS = ["Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana", "Trebuchet MS", "Impact"];
const MAX_RESULTS = 80;

// Fontes personalizadas do usuário: buscadas uma vez e compartilhadas entre os seletores
let customCache: CustomFont[] | null = null;
const listeners = new Set<() => void>();

function loadCustomFonts() {
  if (customCache) return;
  customCache = [];
  customFontService
    .listCustomFonts()
    .then((f) => {
      customCache = f;
      registerCustomFonts(f);
      listeners.forEach((l) => l());
    })
    .catch(() => {
      customCache = null;
    });
}

export function useCustomFonts(): CustomFont[] {
  const [fonts, setFonts] = useState<CustomFont[]>(customCache ?? []);
  useEffect(() => {
    loadCustomFonts();
    const l = () => setFonts(customCache ?? []);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return fonts;
}

export function FontPicker({ value, onChange, className }: { value: string; onChange: (family: string) => void; className?: string }) {
  const custom = useCustomFonts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = cleanFamilyName(value);

  const customFamilies = useMemo(() => [...new Set(custom.map((f) => f.family))], [custom]);
  const google = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? GOOGLE_FONTS.filter((f) => f.family.toLowerCase().includes(q)) : GOOGLE_FONTS).slice(0, MAX_RESULTS);
  }, [query]);
  const system = SYSTEM_FONTS.filter((f) => f.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (open) ensureFontsPreview(google.map((f) => f.family));
  }, [open, google]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadService.uploadFile(file);
      const family = file.name.replace(/\.(ttf|otf|woff2?)$/i, "").replace(/[-_]+/g, " ").trim() || "Fonte personalizada";
      const font = await customFontService.createCustomFont({ family, url, weight: 400, style: "normal" });
      customCache = [...(customCache ?? []), font];
      registerCustomFonts(customCache);
      listeners.forEach((l) => l());
      onChange(font.family);
      setOpen(false);
    } catch (err) {
      console.error("Falha ao enviar fonte", err);
    } finally {
      setUploading(false);
    }
  }

  const item = (family: string) => (
    <button
      key={family}
      onClick={() => {
        onChange(family);
        setOpen(false);
      }}
      className={cn("flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent", family === current && "bg-accent")}
      style={{ fontFamily: `"${family}", sans-serif` }}
    >
      <span className="truncate">{family}</span>
      {family === current && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn("flex h-7 min-w-0 items-center justify-between gap-1 rounded border border-input bg-secondary px-2 text-xs hover:bg-input/60", className)}
          style={{ fontFamily: `"${current}", sans-serif` }}
          title="Fonte"
        >
          <span className="truncate">{current || "Fonte"}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[60] w-64 p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar fonte…"
            className="h-8 w-full rounded border border-input bg-secondary pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {customFamilies.length > 0 && (
            <>
              <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Suas fontes</div>
              {customFamilies.filter((f) => f.toLowerCase().includes(query.trim().toLowerCase())).map(item)}
            </>
          )}
          {system.length > 0 && (
            <>
              <div className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sistema</div>
              {system.map(item)}
            </>
          )}
          <div className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Google Fonts</div>
          {google.map((f) => item(f.family))}
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-input py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Enviar fonte (.ttf, .otf, .woff)
        </button>
        <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={upload} />
      </PopoverContent>
    </Popover>
  );
}
