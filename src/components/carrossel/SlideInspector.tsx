import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import { ARCHETYPE_LABELS, FONT_SUGGESTIONS, THEMES, contentSlots, remapFields, slideTitle, type TemplateInfo } from "@/src/lib/carrossel";
import * as service from "@/src/services/carrossel.service";
import type { AiProviderStatus, CarouselProjectData, ImageProvider, Person, SlideData, TemplateSlot } from "@/src/services/carrossel.service";

type LibraryImage = NonNullable<CarouselProjectData["images"]>[number];

const ANIMATION_OPTIONS = [
  { id: "fade-up", label: "Subir suave" }, { id: "slide-left", label: "Entrar da esquerda" }, { id: "slide-right", label: "Entrar da direita" },
  { id: "zoom-in", label: "Zoom de entrada" }, { id: "blur-in", label: "Foco (desfoque)" }, { id: "pop", label: "Pop" },
];

const labelCls = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const selectCls = "h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none";

interface Props {
  slide: SlideData;
  templates: TemplateInfo[];
  template?: TemplateInfo;
  providers: AiProviderStatus[];
  onChange: (patch: Partial<SlideData>) => void;
  onRegenerate: (opts: { instruction: string; keepTemplate: boolean; provider?: string; model?: string }) => Promise<void>;
  regenerating: boolean;
  /** Instrução vinda de uma sugestão da revisão: preenche o campo da aba IA. */
  suggestion?: string;
  brandbookId: string;
  personId?: string | null;
  library: LibraryImage[];
  onLibraryAdd: (img: LibraryImage) => void;
}

type Tab = "content" | "style" | "ai";

export function SlideInspector({ slide, templates, template, providers, onChange, onRegenerate, regenerating, suggestion, brandbookId, personId, library, onLibraryAdd }: Props) {
  const [tab, setTab] = useState<Tab>("content");
  useEffect(() => { if (suggestion) setTab("ai"); }, [suggestion]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border p-2">
        {([["content", "Conteúdo"], ["style", "Estilo"], ["ai", "IA"]] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium", tab === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "content" && <ContentTab slide={slide} templates={templates} template={template} onChange={onChange} brandbookId={brandbookId} personId={personId} library={library} onLibraryAdd={onLibraryAdd} />}
        {tab === "style" && <StyleTab slide={slide} template={template} onChange={onChange} />}
        {tab === "ai" && (
          <AiTab providers={providers} onRegenerate={onRegenerate} regenerating={regenerating} suggestion={suggestion} key={suggestion || "ai"} />
        )}
      </div>
    </div>
  );
}

// ─── Conteúdo ──────────────────────────────────────────────────────────────────

function ContentTab({ slide, templates, template, onChange, brandbookId, personId, library, onLibraryAdd }: Pick<Props, "slide" | "templates" | "template" | "onChange" | "brandbookId" | "personId" | "library" | "onLibraryAdd">) {
  const fields = slide.fields || {};

  const setField = (id: string, value: any) => {
    const next = { ...fields, [id]: value };
    const patch: Partial<SlideData> = { fields: next };
    if (id === "title" || id === "body") patch.title = slideTitle(next, template);
    onChange(patch);
  };

  const changeTemplate = (code: string) => {
    const next = templates.find((t) => t.code === code);
    if (!next) return;
    const nf = remapFields(fields, template, next);
    // imagens ficam com o slide quando o novo modelo também tem espaço de imagem
    onChange({ template_code: next.code, template_type: next.archetype, fields: nf, title: slideTitle(nf, next), field_font_sizes: {} });
  };

  if (!template) return <p className="text-xs text-muted-foreground">Este slide usa um modelo que não existe mais na marca.</p>;
  const slots = contentSlots(template);

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Modelo do slide</label>
        <select value={template.code} onChange={(e) => changeTemplate(e.target.value)} className={selectCls}>
          {templates.filter((t) => t.has_html).map((t) => (
            <option key={t.code} value={t.code}>{t.code} · {t.name} ({ARCHETYPE_LABELS[t.archetype] || t.archetype})</option>
          ))}
        </select>
      </div>

      {slots.map((slot) =>
        slot.role === "image" ? (
          <ImageField key={slot.id} slot={slot} value={fields[slot.id]} onChange={(v) => setField(slot.id, v)} brandbookId={brandbookId} personId={personId} library={library} onLibraryAdd={onLibraryAdd} />
        ) : (
          <div key={slot.id}>
            <label className={labelCls}>
              {slot.label}
              {slot.max_chars ? <span className="ml-1 font-mono normal-case text-muted-foreground/70">até {slot.max_chars}</span> : null}
            </label>
            {slot.multiline ? (
              <Textarea rows={3} value={fields[slot.id] ?? ""} onChange={(e) => setField(slot.id, e.target.value)} placeholder={slot.sample} className="text-[13px]" />
            ) : (
              <Input value={fields[slot.id] ?? ""} onChange={(e) => setField(slot.id, e.target.value)} placeholder={slot.sample} className="h-8 text-[13px]" />
            )}
            {slot.rich && <p className="mt-0.5 text-[10px] text-muted-foreground">Use **palavra** para destacar na cor da marca.</p>}
          </div>
        ),
      )}

      {template.groups.map((g) => {
        const rows: Record<string, string>[] = Array.isArray(fields[g.id]) ? fields[g.id] : [];
        const setRows = (nr: Record<string, string>[]) => setField(g.id, nr);
        return (
          <div key={g.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={cn(labelCls, "mb-0")}>{g.label} ({rows.length}/{g.max_items})</label>
              <Button type="button" size="sm" variant="ghost" disabled={rows.length >= g.max_items} onClick={() => setRows([...rows, {}])}>
                <Plus className="h-3 w-3" /> Item
              </Button>
            </div>
            {rows.map((row, i) => (
              <div key={i} className="space-y-1.5 rounded-lg border border-input p-2">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Item {i + 1}</span>
                  <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="hover:text-destructive" aria-label="Remover item">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {g.item_slots.map((sl) => (
                  <Input
                    key={sl.id}
                    value={row[sl.id] ?? ""}
                    placeholder={sl.label}
                    className="h-8 text-[13px]"
                    onChange={(e) => setRows(rows.map((r, k) => (k === i ? { ...r, [sl.id]: e.target.value } : r)))}
                  />
                ))}
              </div>
            ))}
            {!rows.length && <p className="text-[11px] text-muted-foreground">Sem itens: o slide mostra a lista vazia.</p>}
          </div>
        );
      })}
    </div>
  );
}

function ImageField({ slot, value, onChange, brandbookId, personId, library, onLibraryAdd }: {
  slot: TemplateSlot; value?: string; onChange: (v: string | undefined) => void;
  brandbookId: string; personId?: string | null; library: LibraryImage[]; onLibraryAdd: (img: LibraryImage) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"library" | "ai" | null>(null);
  const [prompt, setPrompt] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [pid, setPid] = useState(personId || "");
  const [providers, setProviders] = useState<ImageProvider[]>([]);
  const [provider, setProvider] = useState<ImageProvider | "">("");
  const input = useRef<HTMLInputElement>(null);

  const openAi = () => {
    setPanel(panel === "ai" ? null : "ai");
    if (!providers.length) service.getImageProviders().then((p) => { setProviders(p); setProvider(p[0] || ""); }).catch(() => undefined);
    if (!people.length) service.listPeople().then(setPeople).catch(() => undefined);
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const url = await service.uploadImage(file);
      onLibraryAdd({ url, kind: "upload", type: "image", name: file.name });
      onChange(url);
    } catch (e) {
      setError(service.errorMessage(e, "Falha no upload."));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await service.generateImage({
        prompt: prompt.trim() || undefined, scene: prompt.trim() || undefined, person_id: pid || undefined, brandbook_id: brandbookId,
        provider: provider || undefined, references: !pid && value ? [value] : undefined,
      });
      onLibraryAdd({ url, kind: "ai", type: "image" });
      onChange(url);
      setPanel(null);
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível gerar a imagem."));
    } finally {
      setBusy(false);
    }
  };

  const images = library.filter((i) => i.type === "image");
  return (
    <div>
      <label className={labelCls}>{slot.label === "Imagem" && slot.id !== "image" ? `Imagem (${slot.id})` : slot.label || "Imagem"}</label>
      <div className="flex flex-wrap items-center gap-2">
        {value && <img src={value} alt="" className="h-12 w-12 rounded-md border border-input object-cover" />}
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
          {busy && !panel ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />} {value ? "Trocar" : "Enviar"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setPanel(panel === "library" ? null : "library")} disabled={!images.length}>Biblioteca ({images.length})</Button>
        <Button type="button" size="sm" variant="outline" onClick={openAi}><Sparkles className="h-3 w-3" /> Gerar com IA</Button>
        {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(undefined)}><X className="h-3 w-3" /> Remover</Button>}
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {panel === "library" && (
        <div className="mt-2 grid grid-cols-4 gap-1.5 rounded-lg border border-input p-2">
          {images.map((img) => (
            <button key={img.url} type="button" onClick={() => { onChange(img.url); setPanel(null); }} className={cn("overflow-hidden rounded-md border", img.url === value ? "border-primary" : "border-transparent hover:border-input")}>
              <img src={img.url} alt="" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {panel === "ai" && (
        <div className="mt-2 space-y-2 rounded-lg border border-input p-2.5">
          <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="text-[13px]" placeholder={pid ? "Cena (vazio = a IA escolhe um retrato natural)" : value ? "O que mudar na imagem atual?" : "Descreva a imagem"} />
          <div className="grid grid-cols-2 gap-2">
            <select value={pid} onChange={(e) => setPid(e.target.value)} className={selectCls}>
              <option value="">Sem pessoa</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={provider} onChange={(e) => setProvider(e.target.value as ImageProvider)} className={selectCls} disabled={!providers.length}>
              {providers.length ? providers.map((p) => <option key={p} value={p}>{p}</option>) : <option value="">Sem chave configurada</option>}
            </select>
          </div>
          <Button type="button" size="sm" className="w-full" onClick={generate} disabled={busy || !providers.length || (!pid && !prompt.trim())}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Gerar imagem
          </Button>
          <p className="text-[10px] text-muted-foreground">{providers.length ? "Pode levar até 1 minuto." : "Cadastre OpenRouter ou OpenAI em Configurações > Integrações."}</p>
        </div>
      )}
      {slot.sample && !value && <p className="mt-1 text-[10px] text-muted-foreground">{slot.sample}</p>}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// ─── Estilo ────────────────────────────────────────────────────────────────────

function StyleTab({ slide, template, onChange }: Pick<Props, "slide" | "template" | "onChange">) {
  const ct = slide.custom_typography || {};
  const setTypo = (patch: Partial<typeof ct>) => onChange({ custom_typography: { ...ct, ...patch } });
  const sizes = slide.field_font_sizes || {};
  const sizable: { id: string; label: string }[] = template
    ? [
        ...contentSlots(template).filter((s) => s.role !== "image").map((s) => ({ id: s.id, label: s.label })),
        ...template.groups.flatMap((g) => g.item_slots.map((s) => ({ id: s.id, label: `${g.label.replace(/^Itens ?/, "Item")} · ${s.label}` }))),
      ]
    : [];

  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Tema deste slide</label>
        <select value={slide.theme || ""} onChange={(e) => onChange({ theme: (e.target.value || null) as SlideData["theme"] })} className={selectCls}>
          <option value="">Original da marca</option>
          {THEMES.filter((t) => t.id === "dark" || t.id === "light").map((t) => <option key={t.id} value={t.id}>{t.label.replace("Tudo ", "Versão ")}</option>)}
        </select>
        <p className="mt-1 text-[10px] text-muted-foreground">Modelos na cor da marca (rosa, verde…) mantêm o desenho original.</p>
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={slide.show_pagination} onChange={(e) => onChange({ show_pagination: e.target.checked })} />
        Mostrar paginação (01 / 08)
      </label>

      <div>
        <label className={labelCls}>Cor de fundo personalizada</label>
        <div className="flex items-center gap-2">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(slide.bg_override || "") ? slide.bg_override! : "#0b0b0d"} onChange={(e) => onChange({ bg_override: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent" />
          <Input value={slide.bg_override ?? ""} onChange={(e) => onChange({ bg_override: e.target.value || null })} placeholder="#0B0B0D ou vazio" className="h-8 text-[13px]" />
        </div>
      </div>

      <fieldset className="space-y-2 rounded-lg border border-input p-2.5">
        <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Animação (vídeo)</legend>
        <select value={slide.animation?.preset || "none"} onChange={(e) => onChange({ animation: { ...slide.animation, preset: e.target.value, ken_burns: slide.animation?.ken_burns ?? false } })} className={selectCls}>
          <option value="none">Sem animação</option>
          {ANIMATION_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!slide.animation?.ken_burns} onChange={(e) => onChange({ animation: { preset: slide.animation?.preset || "none", ken_burns: e.target.checked } })} /> Zoom lento na imagem</label>
        <p className="text-[10px] text-muted-foreground">Só aparece no MP4 e na prévia animada; o PNG continua estático.</p>
      </fieldset>

      {(["title", "body"] as const).map((kind) => {
        const label = kind === "title" ? "Título" : "Texto de apoio";
        return (
          <fieldset key={kind} className="space-y-2 rounded-lg border border-input p-2.5">
            <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Tamanho (px)</label>
                <Input type="number" min={12} max={400} value={ct[`${kind}_size`] ?? ""} onChange={(e) => setTypo({ [`${kind}_size`]: num(e.target.value) })} className="h-8 text-[13px]" placeholder="auto" />
              </div>
              <div>
                <label className={labelCls}>Peso</label>
                <select value={ct[`${kind}_weight`] ?? ""} onChange={(e) => setTypo({ [`${kind}_weight`]: num(e.target.value) })} className={selectCls}>
                  <option value="">Padrão</option>
                  {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Fonte (Google Fonts)</label>
              <Input list="carrossel-fonts" value={ct[`${kind}_font`] ?? ""} onChange={(e) => setTypo({ [`${kind}_font`]: e.target.value || null })} placeholder="Padrão da marca" className="h-8 text-[13px]" />
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!ct[`${kind}_italic`]} onChange={(e) => setTypo({ [`${kind}_italic`]: e.target.checked })} /> Itálico
            </label>
          </fieldset>
        );
      })}
      <datalist id="carrossel-fonts">{FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>

      {!!sizable.length && (
        <fieldset className="space-y-2 rounded-lg border border-input p-2.5">
          <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tamanho por campo (px)</legend>
          {sizable.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.label}</span>
              <Input
                type="number" min={10} max={400} placeholder="auto" className="h-7 w-20 text-[13px]" value={sizes[s.id] ?? ""}
                onChange={(e) => {
                  const next = { ...sizes };
                  if (e.target.value === "") delete next[s.id];
                  else next[s.id] = Number(e.target.value);
                  onChange({ field_font_sizes: next });
                }}
              />
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
}

// ─── IA ────────────────────────────────────────────────────────────────────────

function AiTab({ providers, onRegenerate, regenerating, suggestion }: Pick<Props, "providers" | "onRegenerate" | "regenerating" | "suggestion">) {
  const configured = providers.filter((p) => p.configured);
  const [instruction, setInstruction] = useState(suggestion || "");
  const [keep, setKeep] = useState(true);
  const [provider, setProvider] = useState(configured[0]?.id || "");
  const [model, setModel] = useState(configured[0]?.default_model || "");
  const current = providers.find((p) => p.id === provider);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Reescreve só este slide, mantendo a coerência com o resto do carrossel e com o contexto original.</p>
      <div>
        <label className={labelCls}>O que você quer mudar? (opcional)</label>
        <Textarea rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ex.: abrir com o número de clientes perdidos e cortar a explicação" className="text-[13px]" />
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Manter o mesmo modelo de slide
      </label>
      {configured.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(providers.find((p) => p.id === e.target.value)?.default_model || ""); }} className={selectCls}>
            {configured.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} className={selectCls}>
            {(current?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {current && !current.models.some((m) => m.id === model) && model && <option value={model}>{model}</option>}
          </select>
        </div>
      )}
      <Button type="button" className="w-full" disabled={regenerating || !configured.length} onClick={() => onRegenerate({ instruction, keepTemplate: keep, provider: provider || undefined, model: model || undefined })}>
        {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Reescrever este slide
      </Button>
      {!configured.length && <p className="text-xs text-amber-300">Configure uma chave de IA em Configurações &gt; Integrações.</p>}
    </div>
  );
}
