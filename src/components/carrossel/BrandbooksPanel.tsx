import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { SlidePreview } from "./SlidePreview";
import { ARCHETYPE_LABELS, blankSlide } from "@/src/lib/carrossel";
import * as service from "@/src/services/carrossel.service";
import type { BrandbookSummary } from "@/src/services/carrossel.service";

const SWATCHES: [string, string][] = [
  ["primary_600", "Primária"], ["primary_200", "Primária média"], ["primary_100", "Primária clara"], ["neutral_950", "Grafite"],
  ["neutral_dark", "Título"], ["neutral_50", "Papel"], ["neutral_600", "Apoio"],
];

interface Props {
  brandbooks: BrandbookSummary[];
  onChanged: () => void | Promise<void>;
}

export function BrandbooksPanel({ brandbooks, onChanged }: Props) {
  const [open, setOpen] = useState<string | null>(brandbooks.find((b) => b.is_default)?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<BrandbookSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      await onChanged();
      setMessage({ kind: "ok", text: okText });
    } catch (e) {
      setMessage({ kind: "error", text: service.errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const doImport = (file: File) =>
    run("import", async () => {
      const bb = await service.importBrandbook(file);
      setOpen(bb.id);
      const warns = (bb.import_report?.warnings as string[] | undefined) || [];
      if (warns.length) setMessage({ kind: "error", text: warns.join(" ") });
    }, "Brand book importado.");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Cada marca guarda cores, fontes, regras de escrita e os modelos reais de slide do brand book. A IA só escolhe entre esses modelos.
        </p>
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy === "import"}>
          {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importar brand book (.zip)
        </Button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void doImport(f); }} />
      </div>
      {message && (
        <p className={message.kind === "ok" ? "rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-300" : "rounded-md bg-destructive/10 p-2 text-xs text-destructive"}>{message.text}</p>
      )}

      {brandbooks.map((b) => {
        const isOpen = open === b.id;
        const withHtml = b.slide_templates.filter((t) => t.has_html && !t.builtin);
        return (
          <div key={b.id} className="overflow-hidden rounded-xl border border-border bg-card">
            <button type="button" onClick={() => setOpen(isOpen ? null : b.id)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/40">
              {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div className="flex gap-1">
                {SWATCHES.slice(0, 4).map(([k]) => <span key={k} className="h-5 w-5 rounded-full border border-white/10" style={{ background: b.colors[k] }} />)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{b.name} <span className="font-normal text-muted-foreground">{b.handle}</span></div>
                <div className="truncate text-xs text-muted-foreground">{b.description}</div>
              </div>
              {b.is_default && <Badge variant="secondary">Padrão</Badge>}
              <span className="text-xs text-muted-foreground">{withHtml.length} modelos</span>
            </button>
            {isOpen && (
              <div className="space-y-4 border-t border-border p-4">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(b)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
                  <Button size="sm" variant="outline" disabled={busy === `re:${b.id}`} onClick={() => run(`re:${b.id}`, () => service.reanalyzeBrandbook(b.id), "Brand book reanalisado.")} title="Refaz a análise a partir do HTML guardado na importação">
                    {busy === `re:${b.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reanalisar
                  </Button>
                  {!b.is_default && (
                    <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => window.confirm(`Excluir a marca "${b.name}"?`) && run(`del:${b.id}`, () => service.deleteBrandbook(b.id), "Marca excluída.")}>
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cores</h4>
                    <div className="flex flex-wrap gap-2">
                      {SWATCHES.map(([k, label]) => (
                        <div key={k} className="flex items-center gap-1.5 text-[11px]">
                          <span className="h-5 w-5 rounded border border-white/10" style={{ background: b.colors[k] }} />
                          {label}
                        </div>
                      ))}
                    </div>
                    <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipografia</h4>
                    <ul className="space-y-0.5 text-[13px]">
                      <li>Título: <b>{b.typography.title_font}</b></li>
                      <li>Corpo: <b>{b.typography.body_font}</b></li>
                      <li>Mono: <b>{b.typography.mono_font}</b></li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Regras de escrita</h4>
                    <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-muted-foreground">
                      {b.writing_rules.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modelos de slide</h4>
                  {withHtml.length === 0 ? (
                    <p className="text-xs text-destructive">Esta marca não tem modelos de slide importados.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                      {withHtml.map((t) => (
                        <div key={t.code}>
                          <SlidePreview brandbookId={b.id} slide={{ ...blankSlide(1, t), id: "preview" }} total={8} isSingle={false} width="fluid" debounceMs={0} />
                          <div className="mt-1 text-[11px] font-medium">{t.code} · {t.name}</div>
                          <div className="text-[10px] text-muted-foreground">{ARCHETYPE_LABELS[t.archetype] || t.archetype}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <EditDialog brand={editing} onClose={() => setEditing(null)} onSave={(patch) => run("edit", () => service.updateBrandbook(editing!.id, patch), "Marca atualizada.").then(() => setEditing(null))} saving={busy === "edit"} />
    </div>
  );
}

function EditDialog({ brand, onClose, onSave, saving }: { brand: BrandbookSummary | null; onClose: () => void; onSave: (p: { name: string; handle: string; description: string; writing_rules: string[]; default_theme: "dark" | "light" }) => void; saving: boolean }) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [loadedId, setLoadedId] = useState<string | null>(null);

  if (brand && loadedId !== brand.id) {
    setLoadedId(brand.id);
    setName(brand.name);
    setHandle(brand.handle);
    setDescription(brand.description || "");
    setRules(brand.writing_rules.join("\n"));
    setTheme(brand.default_theme);
  }
  if (!brand && loadedId) setLoadedId(null);

  return (
    <Dialog open={!!brand} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Editar marca</DialogTitle>
          <DialogDescription>Cores, fontes e modelos vêm do brand book; para mudá-los, importe um novo .zip da mesma marca.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-xs text-muted-foreground">Nome</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="mb-1 block text-xs text-muted-foreground">@ da marca</label><Input value={handle} onChange={(e) => setHandle(e.target.value)} /></div>
        </div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Descrição</label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Tema padrão</label>
          <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
            <option value="dark">Escuro</option><option value="light">Claro</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Regras de escrita (uma por linha)</label>
          <Textarea rows={8} value={rules} onChange={(e) => setRules(e.target.value)} className="text-[13px]" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving || !name.trim()} onClick={() => onSave({ name, handle, description, writing_rules: rules.split("\n").map((r) => r.trim()).filter(Boolean), default_theme: theme })}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
