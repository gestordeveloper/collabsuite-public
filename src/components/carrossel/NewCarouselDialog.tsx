import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileText, Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import { ARCHETYPES, THEMES } from "@/src/lib/carrossel";
import { useDashboard } from "@/src/context/dashboard.context";
import * as service from "@/src/services/carrossel.service";
import type { AiProviderStatus, BrandbookSummary, CarouselProjectData, ImageProvider, Person } from "@/src/services/carrossel.service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandbooks: BrandbookSummary[];
  /** Quando o carrossel nasce dentro de um projeto da CollabSuite, ele já fica vinculado. */
  fixedProjectId?: number;
  onCreated: (project: CarouselProjectData) => void;
}

const STEPS = ["Assunto", "Formato", "Visual", "Criar"] as const;
const SIZES = [{ label: "Curto", count: 5 }, { label: "Médio", count: 8 }, { label: "Longo", count: 12 }];

const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

export function NewCarouselDialog({ open, onOpenChange, brandbooks, fixedProjectId, onCreated }: Props) {
  const { projects } = useDashboard();
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [audience, setAudience] = useState("");
  const [instructions, setInstructions] = useState("");
  const [single, setSingle] = useState(false);
  const [count, setCount] = useState(8);
  const [archetype, setArchetype] = useState("educativo");
  const [brandbookId, setBrandbookId] = useState("");
  const [theme, setTheme] = useState("brand");
  const [projectId, setProjectId] = useState(fixedProjectId ? String(fixedProjectId) : "");
  const [model_, setModel_] = useState<"brandbook" | "image_text">("brandbook");
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState("");
  const [background, setBackground] = useState<"later" | "ai" | "file">("later");
  const [imageMode, setImageMode] = useState<"single" | "per_slide">("single");
  const [scene, setScene] = useState("");
  const [bgFile, setBgFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageProviders, setImageProviders] = useState<ImageProvider[]>([]);
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ stage: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    service.listPeople().then(setPeople).catch(() => undefined);
    service.getImageProviders().then(setImageProviders).catch(() => undefined);
    service.getAiStatus().then((p) => {
      setProviders(p);
      const first = p.find((x) => x.configured);
      if (first) { setProvider(first.id); setModel(first.default_model); }
    }).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!brandbookId && brandbooks.length) setBrandbookId((brandbooks.find((b) => b.is_default) || brandbooks[0]).id);
  }, [brandbooks, brandbookId]);

  const brand = useMemo(() => brandbooks.find((b) => b.id === brandbookId), [brandbooks, brandbookId]);
  const noTemplates = model_ === "brandbook" && !!brand && !brand.slide_templates.some((t) => t.has_html && !t.builtin);
  const configured = providers.filter((p) => p.configured);
  const currentProvider = providers.find((p) => p.id === provider);

  const reset = () => {
    setStep(0); setTopic(""); setContext(""); setAudience(""); setInstructions(""); setSingle(false); setCount(8);
    setArchetype("educativo"); setTheme("brand"); setBusy(false); setStage(null); setError(null);
  };

  const next = () => {
    if (step === 0 && !topic.trim() && !context.trim()) {
      setError("Conte o assunto do carrossel (ou cole o conteúdo-base).");
      return;
    }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const readFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { setError("Arquivo grande demais (máx. 2 MB de texto)."); return; }
    setContext(await file.text());
    if (!topic.trim()) setTopic(file.name.replace(/\.[^.]+$/, ""));
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    setStage({ stage: "Enviando o pedido", pct: 2 });
    abort.current = new AbortController();
    try {
      const job = await service.startGenerate({
        topic: topic.trim(), context: context.trim() || null, brandbook_id: brandbookId, archetype, theme,
        is_single_slide: single, slide_count: count, target_audience: audience.trim() || null,
        additional_instructions: instructions.trim() || null, provider: provider || null, model: model || null,
        project_id: projectId ? Number(projectId) : null,
        carousel_model: model_, person_id: model_ === "image_text" && personId ? personId : null,
        background: model_ === "image_text" ? background : "later", image_mode: imageMode, scene: scene.trim() || null,
        image_url: background === "file" ? bgFile : null,
      });
      const project = await service.waitJob(job, (j) => setStage({ stage: j.stage, pct: j.pct }), abort.current.signal);
      onCreated(project);
      onOpenChange(false);
      reset();
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível gerar o carrossel."));
      setBusy(false);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setBusy(false);
    setStage(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Vamos criar um carrossel?</DialogTitle>
          <DialogDescription>A IA escreve usando os modelos de slide do brand book da marca.</DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-1.5 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                disabled={busy || i > step}
                onClick={() => setStep(i)}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                  i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "border-primary/50 text-primary" : "border-input text-muted-foreground",
                )}
              >
                {i + 1}
              </button>
              <span className={cn("hidden sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Sobre o que é o carrossel?</label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ex.: 5 erros que travam a rotina de um time pequeno" autoFocus />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={cn(labelCls, "mb-0")}>Conteúdo-base (opcional)</label>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
                  <FileText className="h-3 w-3" /> Carregar .txt / .md / .srt
                  <input type="file" accept=".txt,.md,.srt,.vtt,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                </label>
              </div>
              <Textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={7}
                placeholder="Cole aqui uma transcrição, artigo ou anotações. O carrossel é construído a partir dele, sem inventar fatos."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Para quem é? (opcional)</label>
                <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Gestores, donos de agência…" />
              </div>
              <div>
                <label className={labelCls}>Algum pedido especial? (opcional)</label>
                <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Tom mais direto, citar o CTA…" />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[{ v: false, t: "Carrossel", d: "Vários slides deslizáveis" }, { v: true, t: "Post de 1 slide", d: "Uma imagem de alto impacto" }].map((o) => (
                <button
                  key={o.t}
                  type="button"
                  onClick={() => setSingle(o.v)}
                  className={cn("rounded-lg border p-3 text-left transition-colors", single === o.v ? "border-primary bg-primary/10" : "border-input hover:bg-accent")}
                >
                  <div className="text-sm font-semibold">{o.t}</div>
                  <div className="text-xs text-muted-foreground">{o.d}</div>
                </button>
              ))}
            </div>
            {!single && (
              <div>
                <label className={labelCls}>Quantidade de slides: <span className="font-mono text-foreground">{count}</span></label>
                <input type="range" min={3} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
                <div className="mt-2 flex gap-2">
                  {SIZES.map((s) => (
                    <Button key={s.label} type="button" size="sm" variant={count === s.count ? "default" : "outline"} onClick={() => setCount(s.count)}>
                      {s.label} ({s.count})
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className={labelCls}>Tipo de história</label>
              <select value={archetype} onChange={(e) => setArchetype(e.target.value)} className={selectCls}>
                {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Marca</label>
              <select value={brandbookId} onChange={(e) => setBrandbookId(e.target.value)} className={selectCls}>
                {brandbooks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.handle})</option>)}
              </select>
              {noTemplates && <p className="mt-1 text-xs text-destructive">Esta marca não tem modelos de slide importados do brand book.</p>}
            </div>
            <div>
              <label className={labelCls}>Estilo do carrossel</label>
              <div className="grid grid-cols-2 gap-2">
                {([["brandbook", "Slides da marca", "Modelos do brand book (capa, lista, dado…)"], ["image_text", "Foto com texto", "Foto em tela cheia + caixa de texto"]] as const).map(([v, t, d]) => (
                  <button key={v} type="button" onClick={() => setModel_(v)} className={cn("rounded-lg border p-2.5 text-left transition-colors", model_ === v ? "border-primary bg-primary/10" : "border-input hover:bg-accent")}>
                    <div className="text-[13px] font-semibold">{t}</div><div className="text-[11px] text-muted-foreground">{d}</div>
                  </button>
                ))}
              </div>
            </div>
            {model_ === "image_text" && (
              <div className="space-y-3 rounded-lg border border-input p-3">
                <div>
                  <label className={labelCls}>Pessoa (mapa da pessoa)</label>
                  <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={selectCls}>
                    <option value="">Sem pessoa</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {!people.length && <p className="mt-1 text-[11px] text-muted-foreground">Cadastre pessoas na aba "Pessoas" da página de carrosséis.</p>}
                </div>
                <div>
                  <label className={labelCls}>Imagem de fundo</label>
                  <select value={background} onChange={(e) => setBackground(e.target.value as typeof background)} className={selectCls}>
                    <option value="later">Escolher depois, no editor</option>
                    <option value="ai" disabled={!imageProviders.length}>Gerar com IA a partir da pessoa{!imageProviders.length ? " (configure OpenRouter ou OpenAI)" : ""}</option>
                    <option value="file">Usar uma imagem minha em todos os slides</option>
                  </select>
                </div>
                {background === "ai" && (
                  <>
                    <div>
                      <label className={labelCls}>Quantas imagens</label>
                      <select value={imageMode} onChange={(e) => setImageMode(e.target.value as typeof imageMode)} className={selectCls}>
                        <option value="single">Uma imagem para todos os slides</option>
                        <option value="per_slide">Uma imagem por slide (mais lento e mais caro)</option>
                      </select>
                    </div>
                    <div><label className={labelCls}>Cena (opcional)</label><Input value={scene} onChange={(e) => setScene(e.target.value)} placeholder="Vazio = a IA sugere a cena" /></div>
                  </>
                )}
                {background === "file" && (
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-primary hover:underline">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {bgFile ? "Trocar a imagem" : "Escolher a imagem"}
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setUploading(true);
                      try { setBgFile(await service.uploadImage(f)); } catch (err) { setError(service.errorMessage(err)); } finally { setUploading(false); }
                    }} />
                    {bgFile && <img src={bgFile} alt="" className="ml-2 h-8 w-8 rounded object-cover" />}
                  </label>
                )}
              </div>
            )}
            <div>
              <label className={labelCls}>Tema dos slides</label>
              <div className="grid grid-cols-2 gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={cn("rounded-lg border p-2.5 text-left transition-colors", theme === t.id ? "border-primary bg-primary/10" : "border-input hover:bg-accent")}
                  >
                    <div className="text-[13px] font-semibold">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground">{t.hint}</div>
                  </button>
                ))}
              </div>
            </div>
            {!fixedProjectId && (
              <div>
                <label className={labelCls}>Vincular a um projeto (opcional)</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={selectCls}>
                  <option value="">Sem projeto</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <ul className="space-y-1.5 rounded-lg border border-input p-3 text-[13px]">
              <li><span className="text-muted-foreground">Assunto: </span>{(topic || context).slice(0, 90)}{(topic || context).length > 90 ? "…" : ""}</li>
              <li><span className="text-muted-foreground">Formato: </span>{single ? "Post de 1 slide" : `Carrossel com ${count} slides`}</li>
              <li><span className="text-muted-foreground">Marca: </span>{brand?.name}</li>
              <li><span className="text-muted-foreground">Visual: </span>{model_ === "image_text" ? "Foto com texto" : THEMES.find((t) => t.id === theme)?.label}</li>
            </ul>
            {configured.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Qual IA usar?</label>
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      setModel(providers.find((p) => p.id === e.target.value)?.default_model || "");
                    }}
                    className={selectCls}
                  >
                    {configured.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Modelo</label>
                  <select value={model} onChange={(e) => setModel(e.target.value)} className={selectCls}>
                    {(currentProvider?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    {currentProvider && !currentProvider.models.some((m) => m.id === model) && model && <option value={model}>{model}</option>}
                  </select>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                Nenhuma chave de IA configurada (Configurações &gt; Integrações). O carrossel será montado dividindo o seu texto entre os modelos da marca, sem IA.
              </p>
            )}
            {busy && stage && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> {stage.stage}</span>
                  <span className="font-mono text-muted-foreground">{stage.pct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary transition-all" style={{ width: `${stage.pct}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy} className={cn(step === 0 && "invisible")}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>Continuar <ArrowRight className="h-4 w-4" /></Button>
          ) : busy ? (
            <Button type="button" variant="outline" onClick={cancel}><X className="h-4 w-4" /> Cancelar</Button>
          ) : (
            <Button type="button" onClick={create} disabled={noTemplates || !brandbookId}><Sparkles className="h-4 w-4" /> Criar carrossel</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
