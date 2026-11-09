import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ChevronDown, ChevronUp, Copy, FileArchive, Film, Play, Image as ImageIcon, Loader2, Plus, Save, Sparkles, Trash2, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { SlidePreview } from "@/src/components/carrossel/SlidePreview";
import { SlideInspector } from "@/src/components/carrossel/SlideInspector";
import { ExportVideoDialog } from "@/src/components/carrossel/ExportVideoDialog";
import { cn } from "@/src/lib/utils";
import { ARCHETYPE_LABELS, blankSlide, findTemplate, reindex } from "@/src/lib/carrossel";
import * as service from "@/src/services/carrossel.service";
import type { AiProviderStatus, BrandbookSummary, CarouselProjectData, ReviewResult, SlideData } from "@/src/services/carrossel.service";

type SaveState = "saved" | "dirty" | "saving" | "error";

export function CarouselEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<CarouselProjectData | null>(null);
  const [brandbook, setBrandbook] = useState<BrandbookSummary | null>(null);
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [selected, setSelected] = useState(0);
  const [save, setSave] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [suggestion, setSuggestion] = useState<string | undefined>();
  const [previewWidth, setPreviewWidth] = useState(420);
  const stageRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<CarouselProjectData | null>(null);
  projectRef.current = project;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    Promise.all([service.getProject(id), service.listBrandbooks(), service.getAiStatus().catch(() => [])])
      .then(([p, bbs, prov]) => {
        if (!alive) return;
        setProject(p);
        setBrandbook(bbs.find((b) => b.id === p.brandbook_id) || bbs.find((b) => b.is_default) || bbs[0] || null);
        setProviders(prov);
      })
      .catch((e) => alive && setLoadError(service.errorMessage(e, "Não foi possível abrir o carrossel.")));
    return () => { alive = false; };
  }, [id]);

  // a prévia ocupa o espaço que sobra no palco (proporção 4:5)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth - 32;
      const h = el.clientHeight - 32;
      setPreviewWidth(Math.max(240, Math.min(560, w, (h * 1080) / 1350)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project === null]);

  // autosave
  useEffect(() => {
    if (save !== "dirty") return;
    const t = setTimeout(async () => {
      const p = projectRef.current;
      if (!p) return;
      setSave("saving");
      try {
        await service.saveProject(p);
        setSave((s) => (s === "saving" ? "saved" : s));
      } catch (e) {
        setSave("error");
        setError(service.errorMessage(e, "Não foi possível salvar."));
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [project, save]);

  const mutate = useCallback((fn: (p: CarouselProjectData) => CarouselProjectData) => {
    setProject((p) => (p ? fn(p) : p));
    setSave("dirty");
  }, []);

  const templates = brandbook?.slide_templates || [];
  const slide = project?.slides[selected];
  const template = useMemo(() => (slide ? findTemplate(templates, slide) : undefined), [slide, templates]);

  const addToLibrary = (img: NonNullable<CarouselProjectData["images"]>[number]) =>
    mutate((p) => ({ ...p, images: [...(p.images || []).filter((i) => i.url !== img.url), img] }));

  const patchSlide = (patch: Partial<SlideData>) =>
    mutate((p) => ({ ...p, slides: p.slides.map((s, i) => (i === selected ? { ...s, ...patch } : s)) }));

  const addSlide = (code: string) => {
    const tpl = templates.find((t) => t.code === code);
    if (!tpl) return;
    mutate((p) => {
      const at = selected + 1;
      const slides = [...p.slides.slice(0, at), blankSlide(at + 1, tpl), ...p.slides.slice(at)];
      return { ...p, slides: reindex(slides), is_single_slide: false };
    });
    setSelected(selected + 1);
    setAddOpen(false);
  };

  const duplicateSlide = () => {
    mutate((p) => {
      const copy = { ...p.slides[selected], id: `slide_${Date.now().toString(36)}` };
      const slides = [...p.slides.slice(0, selected + 1), copy, ...p.slides.slice(selected + 1)];
      return { ...p, slides: reindex(slides) };
    });
    setSelected(selected + 1);
  };

  const moveSlide = (dir: -1 | 1) => {
    const to = selected + dir;
    if (!project || to < 0 || to >= project.slides.length) return;
    mutate((p) => {
      const slides = [...p.slides];
      [slides[selected], slides[to]] = [slides[to], slides[selected]];
      return { ...p, slides: reindex(slides) };
    });
    setSelected(to);
  };

  const removeSlide = () => {
    if (!project || project.slides.length <= 1) return;
    if (!window.confirm("Remover este slide?")) return;
    mutate((p) => ({ ...p, slides: reindex(p.slides.filter((_, i) => i !== selected)) }));
    setSelected(Math.max(0, selected - 1));
  };

  const saveNow = async () => {
    if (!project) return;
    setSave("saving");
    try {
      setProject(await service.saveProject(project));
      setSave("saved");
      setError(null);
    } catch (e) {
      setSave("error");
      setError(service.errorMessage(e, "Não foi possível salvar."));
    }
  };

  const regenerate = async (opts: { instruction: string; keepTemplate: boolean; provider?: string; model?: string }, index = selected + 1) => {
    if (!project) return;
    setRegenerating(true);
    setError(null);
    try {
      // garante que o servidor tenha a versão mais recente (contexto + slides) antes de reescrever
      await service.saveProject(project);
      const job = await service.startRegenerate({ project_id: project.id, index, instruction: opts.instruction, keep_template: opts.keepTemplate, provider: opts.provider, model: opts.model });
      const next = await service.waitJob<SlideData>(job);
      mutate((p) => ({ ...p, slides: p.slides.map((s) => (s.index === index ? next : s)) }));
      setSuggestion(undefined);
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível reescrever o slide."));
    } finally {
      setRegenerating(false);
    }
  };

  const runReview = async () => {
    if (!project) return;
    setReviewOpen(true);
    setReview(null);
    setReviewing(true);
    try {
      await service.saveProject(project);
      const first = providers.find((p) => p.configured);
      const job = await service.startReview({ project_id: project.id, provider: first?.id, model: first?.default_model });
      setReview(await service.waitJob<ReviewResult>(job));
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível revisar a copy."));
      setReviewOpen(false);
    } finally {
      setReviewing(false);
    }
  };

  const exportAll = async () => {
    if (!project) return;
    setExporting("zip");
    setError(null);
    try {
      await service.saveProject(project);
      service.downloadBlob(await service.exportProject(project.id), `${project.title.replace(/[^\w-]+/g, "_").slice(0, 40) || "carrossel"}.zip`);
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível exportar."));
    } finally {
      setExporting(null);
    }
  };

  const exportCurrent = async () => {
    if (!project || !slide) return;
    setExporting("png");
    setError(null);
    try {
      await service.saveProject(project);
      service.downloadBlob(await service.slidePng(project.id, slide.index), `slide_${String(slide.index).padStart(2, "0")}.png`);
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível gerar o PNG."));
    } finally {
      setExporting(null);
    }
  };

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" onClick={() => navigate("/carrosseis")}>Voltar aos carrosséis</Button>
      </div>
    );
  }
  if (!project || !brandbook || !slide) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const saveLabel = { saved: "Salvo", dirty: "Alterações pendentes…", saving: "Salvando…", error: "Erro ao salvar" }[save];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* barra superior */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Link to="/carrosseis" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Input
          value={project.title}
          onChange={(e) => mutate((p) => ({ ...p, title: e.target.value }))}
          className="h-8 max-w-sm flex-1 border-transparent bg-transparent font-display text-sm font-semibold hover:border-input focus:border-input"
          aria-label="Título do carrossel"
        />
        <span className="hidden text-xs text-muted-foreground sm:inline">{brandbook.name} · {project.slides.length} {project.slides.length === 1 ? "slide" : "slides"}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={cn("flex items-center gap-1 text-xs", save === "error" ? "text-destructive" : "text-muted-foreground")}>
            {save === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
            {save === "saved" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
            {saveLabel}
          </span>
          <Button size="sm" variant="ghost" onClick={saveNow} disabled={save === "saving"}><Save className="h-3.5 w-3.5" /> Salvar</Button>
          <Button size="sm" variant="outline" onClick={runReview} disabled={reviewing || !providers.some((p) => p.configured)}>
            {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Revisar copy
          </Button>
          <Button size="sm" variant="outline" onClick={exportCurrent} disabled={!!exporting}>
            {exporting === "png" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />} PNG do slide
          </Button>
          <Button size="sm" variant="outline" onClick={() => setVideoOpen(true)} disabled={!!exporting}><Film className="h-3.5 w-3.5" /> Stories / vídeo</Button>
          <Button size="sm" onClick={exportAll} disabled={!!exporting}>
            {exporting === "zip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />} Exportar tudo (ZIP)
          </Button>
        </div>
      </div>

      {(error || project.warnings.length > 0) && (
        <div className="shrink-0 space-y-1 border-b border-border bg-amber-500/5 px-3 py-2 text-xs">
          {error && <p className="flex items-center gap-1.5 text-destructive"><AlertTriangle className="h-3 w-3" /> {error}</p>}
          {project.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-amber-300"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</p>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* tira de slides */}
        <aside className="flex w-[148px] shrink-0 flex-col border-r border-border">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {project.slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(i)}
                className={cn("relative block w-full rounded-lg p-0.5 text-left transition-colors", i === selected ? "bg-primary" : "bg-transparent hover:bg-accent")}
              >
                <SlidePreview brandbookId={project.brandbook_id} slide={s} total={project.slides.length} isSingle={project.is_single_slide} width={124} debounceMs={900} />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1 font-mono text-[10px] text-white">{s.index}</span>
              </button>
            ))}
          </div>
          <div className="grid shrink-0 grid-cols-5 gap-0.5 border-t border-border p-1.5">
            <Button size="icon" variant="ghost" className="h-7 w-full" title="Novo slide" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-full" title="Duplicar" onClick={duplicateSlide}><Copy className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-full" title="Mover para cima" onClick={() => moveSlide(-1)} disabled={selected === 0}><ChevronUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-full" title="Mover para baixo" onClick={() => moveSlide(1)} disabled={selected === project.slides.length - 1}><ChevronDown className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-full hover:text-destructive" title="Remover" onClick={removeSlide} disabled={project.slides.length <= 1}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </aside>

        {/* palco */}
        <div ref={stageRef} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden bg-[color-mix(in_srgb,var(--background)_85%,black)] p-4">
          <SlidePreview brandbookId={project.brandbook_id} slide={slide} total={project.slides.length} isSingle={project.is_single_slide} width={previewWidth} animated={animated} className="shadow-2xl ring-1 ring-white/10" />
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>Slide {slide.index} de {project.slides.length} · {template ? `${template.code} ${template.name}` : slide.template_code}</span>
            <button type="button" onClick={() => setAnimated((a) => !a)} className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-foreground", animated && "bg-primary/15 text-primary")} title="Toca a animação do slide (aparece no MP4)"><Play className="h-3 w-3" /> Prévia animada</button>
          </div>
        </div>

        {/* inspetor */}
        <aside className="hidden w-[340px] shrink-0 border-l border-border md:block">
          <SlideInspector
            slide={slide}
            templates={templates}
            template={template}
            providers={providers}
            onChange={patchSlide}
            onRegenerate={(o) => regenerate(o)}
            regenerating={regenerating}
            suggestion={suggestion}
            brandbookId={project.brandbook_id}
            personId={project.person_id}
            library={project.images || []}
            onLibraryAdd={addToLibrary}
          />
        </aside>
      </div>

      {/* inspetor em telas estreitas */}
      <div className="max-h-[45vh] shrink-0 overflow-hidden border-t border-border md:hidden">
        <SlideInspector slide={slide} templates={templates} template={template} providers={providers} onChange={patchSlide} onRegenerate={(o) => regenerate(o)} regenerating={regenerating} suggestion={suggestion} brandbookId={project.brandbook_id} personId={project.person_id} library={project.images || []} onLibraryAdd={addToLibrary} />
      </div>

      {/* novo slide */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Novo slide</DialogTitle>
            <DialogDescription>Escolha o modelo da marca. Ele entra depois do slide {slide.index}.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {templates.filter((t) => t.has_html).map((t) => (
              <button key={t.code} type="button" onClick={() => addSlide(t.code)} className="group rounded-lg border border-input p-1.5 text-left transition-colors hover:border-primary">
                <SlidePreview brandbookId={project.brandbook_id} slide={{ ...blankSlide(1, t), id: "preview" }} total={8} isSingle={false} width={150} debounceMs={0} className="w-full" />
                <div className="mt-1.5 text-xs font-medium">{t.code} · {t.name}</div>
                <div className="text-[10px] text-muted-foreground">{ARCHETYPE_LABELS[t.archetype] || t.archetype}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ExportVideoDialog open={videoOpen} onOpenChange={setVideoOpen} projectId={project.id} slideCount={project.slides.length} beforeExport={async () => { setProject(await service.saveProject(project)); setSave("saved"); }} />

      {/* revisão da copy */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Revisão da copy</DialogTitle>
            <DialogDescription>Checagem local (limites, travessão, HTML) + revisão editorial pela IA.</DialogDescription>
          </DialogHeader>
          {reviewing && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Revisando os slides…</div>}
          {review && (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              <div className="rounded-lg border border-input p-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  Nota geral {review.nota_geral !== null && <span className="rounded bg-primary/15 px-1.5 font-mono text-primary">{review.nota_geral}/10</span>}
                </div>
                <p className="text-[13px] text-muted-foreground">{review.resumo}</p>
              </div>
              {review.slides.map((s) => (
                <div key={s.index} className="rounded-lg border border-input p-3 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" className="font-medium hover:underline" onClick={() => { setSelected(s.index - 1); setReviewOpen(false); }}>
                      {s.index}. {s.titulo} <span className="text-xs text-muted-foreground">({s.modelo})</span>
                    </button>
                    {s.nota !== null && <span className="font-mono text-xs text-muted-foreground">{s.nota}/10</span>}
                  </div>
                  {s.problemas.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{s.problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  ) : (
                    <p className="mt-1 text-xs text-emerald-400">Sem problemas.</p>
                  )}
                  {s.sugestao && (
                    <div className="mt-2 flex items-start justify-between gap-2 rounded-md bg-secondary p-2 text-xs">
                      <span>{s.sugestao}</span>
                      <Button size="sm" variant="outline" onClick={() => { setSelected(s.index - 1); setSuggestion(s.sugestao); setReviewOpen(false); }}>Aplicar</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

