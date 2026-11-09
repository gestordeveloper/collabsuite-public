import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import * as service from "@/src/services/carrossel.service";
import type { Person } from "@/src/services/carrossel.service";

const FIELDS: { key: keyof Person; label: string; placeholder: string; rows?: number }[] = [
  { key: "description", label: "Aparência", placeholder: "Idade aproximada, cabelo, barba, óculos, traços marcantes", rows: 3 },
  { key: "style", label: "Estilo e roupas", placeholder: "Camisa social escura, jaqueta de couro…" },
  { key: "mood", label: "Expressão e presença", placeholder: "Sorriso leve e confiante, olhar direto…" },
  { key: "scenarios", label: "Cenários que combinam", placeholder: "Escritório com luz quente, mesa de xadrez…", rows: 2 },
  { key: "avoid", label: "Evitar nas imagens", placeholder: "Sem sorriso exagerado, sem terno…" },
  { key: "notes", label: "Tom de voz e observações (para a IA que escreve)", placeholder: "Direto, provocador, fala em primeira pessoa…", rows: 3 },
];

const EMPTY: Person = { id: "", name: "", description: "", style: "", mood: "", scenarios: "", avoid: "", notes: "", photos: [] };

/** Mapa da pessoa: perfil + fotos de referência de quem aparece nos carrosséis "Imagem e Texto". */
export function PeoplePanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await service.listPeople());
    } catch (e) {
      setError(service.errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(service.errorMessage(e)); } finally { setBusy(false); }
  };

  const save = () => run(async () => {
    if (!editing) return;
    const saved = await service.savePerson(editing);
    setEditing(saved);
    await load();
  });

  const remove = (p: Person) => window.confirm(`Excluir ${p.name}?`) && run(async () => {
    await service.deletePerson(p.id);
    if (editing?.id === p.id) setEditing(null);
    await load();
  });

  const addPhotos = (files: FileList) => run(async () => {
    if (!editing?.id) { setError("Salve a pessoa antes de enviar as fotos."); return; }
    let cur = editing;
    for (const f of Array.from(files)) cur = await service.addPersonPhoto(cur.id, f);
    setEditing(cur);
    await load();
  });

  const removePhoto = (url: string) => run(async () => {
    if (!editing) return;
    setEditing(await service.removePersonPhoto(editing.id, url));
    await load();
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        <Button className="w-full" variant="outline" onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" /> Nova pessoa</Button>
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : people.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma pessoa cadastrada. Cadastre quem aparece nas fotos dos carrosséis "Imagem e Texto".</p>
        ) : people.map((p) => (
          <div key={p.id} className={cn("flex items-center gap-2 rounded-lg border p-2 transition-colors", editing?.id === p.id ? "border-primary bg-primary/10" : "border-input hover:bg-accent")}>
            <button type="button" onClick={() => setEditing(p)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {p.photos[0] ? <img src={p.photos[0]} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"><UserRound className="h-4 w-4" /></span>}
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="text-[11px] text-muted-foreground">{p.photos.length} foto(s)</span></span>
            </button>
            <button type="button" onClick={() => remove(p)} className="text-muted-foreground hover:text-destructive" aria-label="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        {!editing ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Escolha uma pessoa ao lado ou cadastre uma nova.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Nome</label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Samuel" />
            </div>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs text-muted-foreground">{f.label}</label>
                {f.rows ? (
                  <Textarea rows={f.rows} value={editing[f.key] as string} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} placeholder={f.placeholder} className="text-[13px]" />
                ) : (
                  <Input value={editing[f.key] as string} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} placeholder={f.placeholder} />
                )}
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Fotos de referência (até 8; rosto bem visível, boa luz)</label>
              <div className="flex flex-wrap gap-2">
                {editing.photos.map((url) => (
                  <div key={url} className="group relative">
                    <img src={url} alt="" className="h-20 w-20 rounded-lg border border-input object-cover" />
                    <button type="button" onClick={() => removePhoto(url)} className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-destructive p-0.5 text-white group-hover:block" aria-label="Remover foto"><X className="h-3 w-3" /></button>
                  </div>
                ))}
                {editing.photos.length < 8 && (
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input text-[11px] text-muted-foreground hover:bg-accent">
                    <ImagePlus className="h-4 w-4" /> Adicionar
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void addPhotos(e.target.files); e.target.value = ""; }} />
            </div>
            {error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button onClick={save} disabled={busy || !editing.name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar pessoa</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
