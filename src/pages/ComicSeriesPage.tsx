import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BookOpen, CheckCircle2, Download, FileText, ImagePlus, Loader2, Palette, Plus, Save, Sparkles, Trash2, Wand2, X, AlertTriangle, Copy, ExternalLink, Share2,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import { EpisodeViewer } from "@/src/components/carrossel/EpisodeViewer";
import * as service from "@/src/services/comic.service";
import * as studio from "@/src/services/carrossel.service";
import type { Character, ComicSlide, Episode, Series } from "@/src/services/comic.service";
import type { AiProviderStatus, ImageProvider } from "@/src/services/carrossel.service";

const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

interface Status { stage: string; pct: number; kind: "progress" | "error" | "ok"; text?: string }

export function ComicSeriesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === "nova";
  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [epId, setEpId] = useState<string | null>(null);
  const [view, setView] = useState<"series" | "season" | "episode">(isNew ? "series" : "episode");
  const [styles, setStyles] = useState<{ id: string; label: string }[]>([]);
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [imageProviders, setImageProviders] = useState<ImageProvider[]>([]);
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [imageProvider, setImageProvider] = useState<ImageProvider | "">("");
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = status?.kind === "progress";

  const loadAll = useCallback(async (seriesId: string, openEpisode?: string) => {
    const [all, eps] = await Promise.all([service.listSeries(), service.listEpisodes(seriesId)]);
    const s = all.find((x) => x.id === seriesId);
    if (!s) throw new Error("Série não encontrada.");
    setSeries(s);
    setEpisodes(eps);
    setEpId((cur) => openEpisode ?? (cur && eps.some((e) => e.id === cur) ? cur : eps[0]?.id ?? null));
    if (!eps.length) setView((v) => (v === "episode" ? "series" : v));
  }, []);

  useEffect(() => {
    service.listStyles().then(setStyles).catch(() => undefined);
    studio.getAiStatus().then((p) => {
      setProviders(p);
      const first = p.find((x) => x.configured);
      if (first) { setAiProvider(first.id); setAiModel(first.default_model); }
    }).catch(() => undefined);
    // atualiza a lista de tempos em tempos: a extensão do Flow só aparece como disponível enquanto está conectada
    const refresh = () => studio.getImageProviders().then((p) => { setImageProviders(p); setImageProvider((cur) => (cur && p.includes(cur) ? cur : cur === "flow" ? cur : p[0] || "")); }).catch(() => undefined);
    void refresh();
    const timer = setInterval(refresh, 5000);
    if (isNew) setSeries(service.blankSeries());
    else if (id) loadAll(id).catch((e) => setLoadError(studio.errorMessage(e)));
    return () => clearInterval(timer);
  }, [id, isNew, loadAll]);

  const episode = useMemo(() => episodes.find((e) => e.id === epId) ?? null, [episodes, epId]);

  const run = async <T,>(label: string, start: () => Promise<studio.JobState<T>>): Promise<T | null> => {
    setStatus({ stage: label, pct: 2, kind: "progress" });
    try {
      const job = await start();
      const result = await studio.waitJob<T>(job, (j) => setStatus({ stage: j.stage, pct: j.pct, kind: "progress" }));
      setStatus({ stage: "", pct: 100, kind: "ok", text: "Pronto." });
      setTimeout(() => setStatus((s) => (s?.kind === "ok" ? null : s)), 2500);
      return result;
    } catch (e) {
      setStatus({ stage: "", pct: 0, kind: "error", text: studio.errorMessage(e) });
      return null;
    }
  };

  const step = async (ep: Episode, kind: service.Step, label: string, slides?: number[]) => {
    const saved = await persistEpisode(ep);
    if (!saved || !series) return;
    const res = await run<Episode>(label, () => service.startStep(series.id, saved.id, kind, {
      provider: aiProvider || undefined, model: aiModel || undefined, slides, image_provider: imageProvider || undefined,
    }));
    await loadAll(series.id, saved.id).catch(() => undefined);
    return res;
  };

  const persistEpisode = async (ep: Episode): Promise<Episode | null> => {
    try {
      const saved = await service.saveEpisode(ep);
      setEpisodes((list) => list.map((e) => (e.id === saved.id ? saved : e)));
      return saved;
    } catch (e) {
      setStatus({ stage: "", pct: 0, kind: "error", text: studio.errorMessage(e) });
      return null;
    }
  };

  const saveSeries = async () => {
    if (!series) return;
    setSaving(true);
    try {
      const saved = await service.saveSeries(series);
      if (isNew) navigate(`/novelas/${saved.id}`, { replace: true });
      else setSeries(saved);
      setStatus({ stage: "", pct: 100, kind: "ok", text: "Série salva." });
      setTimeout(() => setStatus((s) => (s?.kind === "ok" ? null : s)), 2000);
      return saved;
    } catch (e) {
      setStatus({ stage: "", pct: 0, kind: "error", text: studio.errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const newEpisode = async () => {
    if (!series?.id) return;
    const ep = await persistEpisode({ series_id: series.id, number: 0, title: "", theme: "", context: "", slide_count: 10, slides: [] } as unknown as Episode);
    if (ep) { await loadAll(series.id, ep.id); setView("episode"); }
  };

  if (loadError) return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6"><p className="text-sm text-destructive">{loadError}</p><Button variant="outline" onClick={() => navigate("/carrosseis")}>Voltar</Button></div>;
  if (!series) return <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border md:w-[260px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Link to="/carrosseis" className="text-muted-foreground hover:text-foreground" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0"><div className="truncate font-display text-sm font-bold">{series.name || "Nova mini-novela"}</div><div className="text-[11px] text-muted-foreground">Mini-novela HQ</div></div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          <NavBtn active={view === "series"} onClick={() => setView("series")} icon={<Palette className="h-3.5 w-3.5" />}>A série e os personagens</NavBtn>
          {!isNew && <NavBtn active={view === "season"} onClick={() => setView("season")} icon={<BookOpen className="h-3.5 w-3.5" />}>Criar temporada de uma história</NavBtn>}
          {!isNew && (
            <>
              <div className="flex items-center justify-between px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Episódios <button type="button" onClick={newEpisode} className="rounded p-0.5 hover:bg-accent hover:text-foreground" aria-label="Novo episódio"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              {episodes.map((e) => {
                const st = service.episodeStatus(e);
                return (
                  <button key={e.id} type="button" onClick={() => { setEpId(e.id); setView("episode"); }} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]", view === "episode" && epId === e.id ? "bg-secondary" : "hover:bg-accent")}>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", st.key === "done" ? "bg-emerald-400" : st.key === "wip" ? "bg-amber-400" : "bg-muted-foreground/40")} />
                    <span className="min-w-0"><b>Ep. {String(e.number).padStart(2, "0")}</b> <span className="truncate">{e.title}</span><span className="block text-[10px] text-muted-foreground">{st.label}</span></span>
                  </button>
                );
              })}
              {!episodes.length && <p className="px-2 text-xs text-muted-foreground">Nenhum episódio ainda.</p>}
            </>
          )}
        </div>
        {!isNew && series.id && (
          <div className="border-t border-border p-2">
            <Button size="sm" variant="outline" className="w-full" onClick={async () => { try { studio.downloadBlob(await service.exportSeries(series.id), `${series.id}_episodios.zip`); } catch (e) { setStatus({ stage: "", pct: 0, kind: "error", text: studio.errorMessage(e) }); } }}><Download className="h-3.5 w-3.5" /> Baixar todos os episódios</Button>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
          {status && (
            <div className={cn("rounded-lg border p-3 text-[13px]", status.kind === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : status.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-input bg-card")}>
              {status.kind === "progress" ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between"><span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {status.stage}</span><span className="font-mono text-xs text-muted-foreground">{status.pct}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${status.pct}%` }} /></div>
                </>
              ) : (
                <div className="flex items-start gap-1.5">{status.kind === "error" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" />}<span>{status.text}</span><button type="button" className="ml-auto" onClick={() => setStatus(null)} aria-label="Fechar"><X className="h-3.5 w-3.5" /></button></div>
              )}
            </div>
          )}

          {view === "series" && (
            <SeriesForm
              series={series} setSeries={setSeries} styles={styles} saving={saving} onSave={saveSeries} isNew={isNew}
              onSheets={async (index, files) => {
                setStatus(null);
                try {
                  let cur = series;
                  // personagem ainda não salvo: salva a série antes, para ele ganhar um id e a imagem ir direto para o armazenamento (S3)
                  if (!cur.id || !cur.characters[index]?.id) cur = await service.saveSeries(series);
                  const charId = cur.characters[index].id;
                  for (const f of Array.from(files)) cur = await service.uploadSheet(cur.id, charId, f);
                  setSeries(cur);
                  if (isNew) navigate(`/novelas/${cur.id}`, { replace: true });
                } catch (e) { setStatus({ stage: "", pct: 0, kind: "error", text: studio.errorMessage(e) }); }
              }}
              onRemoveSheet={async (charId, url) => { try { setSeries(await service.deleteSheet(series.id, charId, url)); } catch (e) { setStatus({ stage: "", pct: 0, kind: "error", text: studio.errorMessage(e) }); } }}
              onDelete={async () => { if (window.confirm(`Excluir a série "${series.name}" e todos os episódios?`)) { await service.deleteSeries(series.id); navigate("/carrosseis"); } }}
            />
          )}

          {view === "season" && (
            <SeasonForm series={series} disabled={busy} providers={providers} aiProvider={aiProvider} aiModel={aiModel} onAi={(p, m) => { setAiProvider(p); setAiModel(m); }} onRun={async (story, eps, slides) => {
              const saved = await saveSeries();
              const target = saved ?? series;
              const res = await run<{ episodes: string[] }>("Analisando a história", () => service.startSeason(target.id, { story, episodes: eps, slides, provider: aiProvider || undefined, model: aiModel || undefined }));
              if (res) { await loadAll(target.id, res.episodes[0]); setView("episode"); }
            }} />
          )}

          {view === "episode" && episode && (
            <EpisodeView
              key={episode.id} episode={episode} series={series} busy={busy} providers={providers} imageProviders={imageProviders}
              aiProvider={aiProvider} aiModel={aiModel} imageProvider={imageProvider}
              onAi={(p, m) => { setAiProvider(p); setAiModel(m); }} onImageProvider={setImageProvider}
              onChange={(e) => setEpisodes((list) => list.map((x) => (x.id === e.id ? e : x)))}
              onSave={async (e) => { const s = await persistEpisode(e); if (s) { setStatus({ stage: "", pct: 100, kind: "ok", text: "Episódio salvo." }); setTimeout(() => setStatus((x) => (x?.kind === "ok" ? null : x)), 1800); } }}
              onStep={step}
              onDelete={async () => { if (window.confirm("Excluir este episódio?")) { await service.deleteEpisode(series.id, episode.id); await loadAll(series.id); } }}
            />
          )}
          {view === "episode" && !episode && <p className="py-10 text-center text-sm text-muted-foreground">Crie o primeiro episódio no menu ao lado (botão +).</p>}
        </div>
      </div>
    </div>
  );
}

function NavBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]", active ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
      {icon}{children}
    </button>
  );
}

// ─── Série ─────────────────────────────────────────────────────────────────────

function SeriesForm({ series, setSeries, styles, saving, onSave, isNew, onSheets, onRemoveSheet, onDelete }: {
  series: Series; setSeries: (s: Series) => void; styles: { id: string; label: string }[]; saving: boolean; onSave: () => void; isNew: boolean;
  onSheets: (index: number, files: FileList) => void; onRemoveSheet: (charId: string, url: string) => void; onDelete: () => void;
}) {
  const set = <K extends keyof Series>(k: K, v: Series[K]) => setSeries({ ...series, [k]: v });
  const [people, setPeople] = useState<studio.Person[]>([]);
  useEffect(() => { studio.listPeople().then(setPeople).catch(() => undefined); }, []);
  const setChar = (i: number, patch: Partial<Character>) => set("characters", series.characters.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-5">
      <Section n={1} title="Qual é o nome e a ideia?">
        <div><label className={labelCls}>Nome da mini-novela</label><Input value={series.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Sombras do Centro" /></div>
        <div><label className={labelCls}>Sobre o que é?</label><Textarea rows={4} value={series.premise} onChange={(e) => set("premise", e.target.value)} placeholder="Onde e quando acontece, qual é o problema da história, qual é o clima" /></div>
      </Section>

      <Section n={2} title="Quem aparece na história?">
        <p className="text-xs text-muted-foreground">Anexe a imagem de cada personagem (character sheet): é isso que mantém o rosto igual em todos os quadros. As imagens ficam guardadas no seu armazenamento (AWS S3).</p>
        {series.characters.map((c, i) => (
          <div key={c.id || i} className="space-y-2 rounded-xl border border-input p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={c.name} onChange={(e) => setChar(i, { name: e.target.value })} placeholder="Nome (ex.: Marta)" />
              <Input value={c.role} onChange={(e) => setChar(i, { role: e.target.value })} placeholder="Quem é? (ex.: a heroína)" />
            </div>
            <Textarea rows={3} value={c.description} onChange={(e) => setChar(i, { description: e.target.value })} placeholder="Como é desenhado(a)? Idade, rosto, cabelo, roupa…" className="text-[13px]" />
            <Textarea rows={2} value={c.voice} onChange={(e) => setChar(i, { voice: e.target.value })} placeholder="Jeito de falar: ritmo, vocabulário, muletas" className="text-[13px]" />
            <div className="flex flex-wrap items-center gap-2">
              {c.sheets.map((url) => (
                <div key={url} className="group relative"><img src={url} alt="" className="h-16 w-16 rounded-lg border border-input object-cover" /><button type="button" onClick={() => onRemoveSheet(c.id, url)} className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-destructive p-0.5 text-white group-hover:block" aria-label="Remover imagem"><X className="h-3 w-3" /></button></div>
              ))}
              {c.sheets.length < 4 && (
                <label className="flex h-16 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-input px-3 text-xs text-muted-foreground hover:bg-accent"><ImagePlus className="h-4 w-4" /> Adicionar foto ou desenho
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) onSheets(i, e.target.files); e.target.value = ""; }} /></label>
              )}
              <Button type="button" size="sm" variant="ghost" className="ml-auto hover:text-destructive" onClick={() => set("characters", series.characters.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5" /> Remover</Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => set("characters", [...series.characters, service.blankCharacter()])}><Plus className="h-4 w-4" /> Adicionar personagem</Button>
          {people.length > 0 && (
            <select value="" onChange={(e) => { const p = people.find((x) => x.id === e.target.value); if (p) set("characters", [...series.characters, { ...service.blankCharacter(), name: p.name, description: [p.description, p.style].filter(Boolean).join(". "), voice: p.notes, sheets: p.photos.slice(0, 4) }]); }} className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
              <option value="">Usar uma pessoa cadastrada…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </Section>

      <Section n={3} title="Como os desenhos devem parecer?">
        <div><label className={labelCls}>Estilo das imagens</label>
          <select value={series.art_style} onChange={(e) => set("art_style", e.target.value)} className={selectCls}>{styles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
        <div className="flex flex-wrap gap-4">
          {(["base", "secondary", "accent"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-xs text-muted-foreground">{{ base: "Fundo", secondary: "Meio", accent: "Destaque" }[k]}
              <input type="color" value={series.palette[k]} onChange={(e) => set("palette", { ...series.palette, [k]: e.target.value })} className="h-8 w-10 rounded border border-input bg-transparent" /></label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={labelCls}>Texto pequeno acima do título na capa</label><Input value={series.universe} onChange={(e) => set("universe", e.target.value)} placeholder="Ex.: UNIVERSO NOIR" /></div>
          <div><label className={labelCls}>Observações extras de estilo visual</label><Input value={series.style_notes} onChange={(e) => set("style_notes", e.target.value)} placeholder="Ex.: sempre chuva à noite" /></div>
        </div>
      </Section>

      <div className="flex items-center justify-between">
        {!isNew ? <Button variant="ghost" className="hover:text-destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /> Excluir série</Button> : <span />}
        <Button onClick={onSave} disabled={saving || !series.name.trim()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar série</Button>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 font-display text-sm font-bold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>{title}</h3>
      {children}
    </section>
  );
}

/** Escolha da IA que escreve (APIs com chave e CLIs instalados na máquina do servidor). */
function AiPicker({ providers, aiProvider, aiModel, onAi }: { providers: AiProviderStatus[]; aiProvider: string; aiModel: string; onAi: (provider: string, model: string) => void }) {
  const configured = providers.filter((p) => p.configured);
  const current = providers.find((p) => p.id === aiProvider);
  if (!configured.length) return null;
  return (
    <>
      <div className="w-48"><label className={labelCls}>IA que escreve</label>
        <select value={aiProvider} onChange={(e) => onAi(e.target.value, providers.find((p) => p.id === e.target.value)?.default_model || "")} className={selectCls}>{configured.map((p) => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}</select></div>
      <div className="w-56"><label className={labelCls}>Modelo</label>
        {current?.free_model && !current.models.length
          ? <Input value={aiModel} onChange={(e) => onAi(aiProvider, e.target.value)} placeholder="Padrão do CLI" />
          : <select value={aiModel} onChange={(e) => onAi(aiProvider, e.target.value)} className={selectCls}>
              {current?.free_model && <option value="">Padrão do CLI</option>}
              {(current?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              {current && aiModel && !current.models.some((m) => m.id === aiModel) && <option value={aiModel}>{aiModel}</option>}
            </select>}
      </div>
    </>
  );
}

function SeasonForm({ series, disabled, providers, aiProvider, aiModel, onAi, onRun }: { series: Series; disabled: boolean; providers: AiProviderStatus[]; aiProvider: string; aiModel: string; onAi: (provider: string, model: string) => void; onRun: (story: string, episodes: number, slides: number) => void }) {
  const [story, setStory] = useState(series.story || "");
  const [eps, setEps] = useState(3);
  const [slides, setSlides] = useState(10);
  return (
    <div className="space-y-4">
      <Section n={1} title="Conte a história">
        <Textarea rows={9} value={story} onChange={(e) => setStory(e.target.value)} placeholder="Conte o que aconteceu: quem, onde, quando, qual foi o problema e como terminou…" />
        <p className="text-xs text-muted-foreground">A IA analisa o tema, divide a história em episódios e já escreve o roteiro de cada um. {series.characters.length ? "Usa os personagens cadastrados." : "Como a série não tem personagens, ela cria os personagens também."}</p>
      </Section>
      <Section n={2} title="Quantos episódios?">
        <div className="flex gap-6">
          <div><label className={labelCls}>Episódios</label><Input type="number" min={1} max={12} value={eps} onChange={(e) => setEps(Number(e.target.value))} className="w-24" /></div>
          <div><label className={labelCls}>Quadros em cada um</label><Input type="number" min={3} max={15} value={slides} onChange={(e) => setSlides(Number(e.target.value))} className="w-24" /></div>
        </div>
      </Section>
      <Section n={3} title="Qual IA escreve os roteiros?">
        <div className="flex flex-wrap gap-3"><AiPicker providers={providers} aiProvider={aiProvider} aiModel={aiModel} onAi={onAi} /></div>
        {!providers.some((p) => p.configured) && <p className="text-xs text-amber-300">Configure uma chave de IA ou um CLI local em Configurações &gt; Integrações.</p>}
      </Section>
      <Button disabled={disabled || story.trim().length < 40} onClick={() => onRun(story, eps, slides)}><Wand2 className="h-4 w-4" /> Criar a temporada</Button>
    </div>
  );
}

// ─── Episódio ──────────────────────────────────────────────────────────────────

function EpisodeView({ episode, series, busy, providers, imageProviders, aiProvider, aiModel, imageProvider, onAi, onImageProvider, onChange, onSave, onStep, onDelete }: {
  episode: Episode; series: Series; busy: boolean; providers: AiProviderStatus[]; imageProviders: ImageProvider[];
  aiProvider: string; aiModel: string; imageProvider: ImageProvider | "";
  onAi: (provider: string, model: string) => void; onImageProvider: (p: ImageProvider) => void;
  onChange: (e: Episode) => void; onSave: (e: Episode) => void; onStep: (e: Episode, kind: service.Step, label: string, slides?: number[]) => void; onDelete: () => void;
}) {
  const set = <K extends keyof Episode>(k: K, v: Episode[K]) => onChange({ ...episode, [k]: v });
  const setSlide = (n: number, patch: Partial<ComicSlide>) => onChange({ ...episode, slides: episode.slides.map((s) => (s.n === n ? { ...s, ...patch } : s)) });
  const hasScript = episode.slides.length > 0;
  const [viewAt, setViewAt] = useState<number | null>(null);
  const allFinal = hasScript && episode.slides.every((s) => s.final);
  const configured = providers.filter((p) => p.configured);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-24"><label className={labelCls}>Nº</label><Input type="number" min={1} value={episode.number} onChange={(e) => set("number", Number(e.target.value))} /></div>
        <div className="min-w-[220px] flex-1"><label className={labelCls}>Título (aparece na capa)</label><Input value={episode.title} onChange={(e) => set("title", e.target.value)} placeholder="A IA sugere um ao escrever o roteiro" /></div>
        <Button variant="ghost" size="icon" className="hover:text-destructive" onClick={onDelete} aria-label="Excluir episódio"><Trash2 className="h-4 w-4" /></Button>
      </div>

      <Section n={1} title="O que acontece neste episódio?">
        <Textarea rows={3} value={episode.theme} onChange={(e) => set("theme", e.target.value)} placeholder="Conte em poucas palavras o que acontece neste episódio" />
        <div><label className={labelCls}>Anotações para a IA</label><Textarea rows={2} value={episode.context} onChange={(e) => set("context", e.target.value)} placeholder="Fatos, reviravoltas ou frases que precisam aparecer" className="text-[13px]" /></div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><label className={labelCls}>Quadros</label><Input type="number" min={3} max={15} value={episode.slide_count} onChange={(e) => set("slide_count", Number(e.target.value))} /></div>
          <AiPicker providers={providers} aiProvider={aiProvider} aiModel={aiModel} onAi={onAi} />
          <Button disabled={busy || !configured.length || !series.characters.length} onClick={() => onStep(episode, "script", "Escrevendo o roteiro")}>
            <FileText className="h-4 w-4" /> {hasScript ? "Reescrever o roteiro" : "Escrever o roteiro"}
          </Button>
        </div>
        {!series.characters.length && <p className="text-xs text-amber-300">Cadastre ao menos um personagem em "A série e os personagens".</p>}
        {!configured.length && <p className="text-xs text-amber-300">Configure uma chave de IA em Configurações &gt; Integrações.</p>}
      </Section>

      {hasScript && (
        <Section n={2} title="Desenhar os quadros">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44"><label className={labelCls}>Gerar imagens com</label>
              <select value={imageProvider} onChange={(e) => onImageProvider(e.target.value as ImageProvider)} className={selectCls} >
                {[...(imageProviders.includes("flow") ? [] : ["flow" as ImageProvider]), ...imageProviders].map((p) => <option key={p} value={p}>{p === "flow" ? `Google Flow (extensão)${imageProviders.includes("flow") ? "" : " · desconectada"}` : p === "openrouter" ? "OpenRouter (Nano Banana)" : p === "gemini" ? "Google Gemini" : "OpenAI"}</option>)}</select></div>
            <Button variant="outline" disabled={busy || !configured.length} onClick={() => onStep(episode, "prompts", "Criando os prompts de imagem")}><Sparkles className="h-4 w-4" /> Criar prompts de imagem</Button>
            <Button disabled={busy || !imageProvider || !imageProviders.includes(imageProvider as ImageProvider)} onClick={() => onStep(episode, "images", "Desenhando os quadros")}><ImagePlus className="h-4 w-4" /> Desenhar todos os quadros</Button>
            <Button variant="outline" disabled={busy || !episode.slides.some((s) => s.art)} onClick={() => onStep(episode, "compose", "Montando os slides")}>Remontar os slides</Button>
          </div>
          {imageProvider === "flow" && !imageProviders.includes("flow") && <p className="text-xs text-amber-300">A extensão do Google Flow não está conectada: abra o navegador com a extensão ativa e o flow.google.com logado (veja Prompts e estilos &gt; Google Flow).</p>}
          {!imageProviders.filter((p) => p !== "flow").length && <p className="text-xs text-muted-foreground">Sem chave de imagem por API (OpenRouter, OpenAI ou GEMINI_API_KEY no servidor): só o Google Flow fica disponível.</p>}
        </Section>
      )}

      {hasScript && (
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-display text-sm font-bold">Os quadros</h3><Button size="sm" variant="outline" onClick={() => setViewAt(0)}><BookOpen className="h-3.5 w-3.5" /> Visualizar o episódio</Button></div>
          {episode.slides.map((s) => <SlideCard key={s.n} slide={s} busy={busy} canDraw={!!imageProvider && imageProviders.includes(imageProvider as ImageProvider)} canPrompt={configured.length > 0} onRePrompt={() => onStep(episode, "prompts", `Recriando o prompt do quadro ${s.n}`, [s.n])} onChange={(p) => setSlide(s.n, p)} onRedraw={() => onStep(episode, "images", `Desenhando o quadro ${s.n}`, [s.n])} onView={() => setViewAt(s.n - 1)} />)}
        </div>
      )}
      {hasScript && <EpisodeViewer episode={episode} open={viewAt !== null} onOpenChange={(o) => !o && setViewAt(null)} startAt={viewAt ?? 0} />}

      {hasScript && (
        <Section n={3} title="Baixar e postar">
          <div><label className={labelCls}>Legenda do post</label><Textarea rows={3} value={episode.caption} onChange={(e) => set("caption", e.target.value)} className="text-[13px]" /></div>
          <div className="w-60"><label className={labelCls}>Data de publicação</label><Input type="date" value={episode.publish_date} onChange={(e) => set("publish_date", e.target.value)} /></div>
          {episode.synopsis && <p className="text-xs text-muted-foreground"><b>Sinopse:</b> {episode.synopsis}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={async () => { try { studio.downloadBlob(await service.exportEpisode(series.id, episode.id), `episodio_${String(episode.number).padStart(2, "0")}.zip`); } catch (e) { window.alert(studio.errorMessage(e)); } }} disabled={!allFinal && !episode.slides.some((s) => s.final)}><Download className="h-4 w-4" /> Baixar o episódio (ZIP)</Button>
          </div>
        </Section>
      )}

      {hasScript && episode.id && episode.slides.some((s) => s.final || s.art) && <ApprovalSection seriesId={series.id} episodeId={episode.id} />}

      {hasScript && episode.slides.every((s) => s.art) && (
        <VideoSection
          episode={episode} series={series} busy={busy} onChange={onChange}
          onGenerate={() => onStep(episode, "video", "Montando o vídeo")}
        />
      )}

      <div className="sticky bottom-0 flex justify-end border-t border-border bg-background/90 py-2 backdrop-blur">
        <Button onClick={() => onSave(episode)} disabled={busy}><Save className="h-4 w-4" /> Salvar episódio</Button>
      </div>
    </div>
  );
}

function SlideCard({ slide, busy, canDraw, canPrompt, onRePrompt, onChange, onRedraw, onView }: { slide: ComicSlide; busy: boolean; canDraw: boolean; canPrompt: boolean; onRePrompt: () => void; onChange: (p: Partial<ComicSlide>) => void; onRedraw: () => void; onView: () => void }) {
  const img = slide.final || slide.art;
  const setDialogue = (i: number, patch: Partial<ComicSlide["dialogues"][number]>) => onChange({ dialogues: slide.dialogues.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-[180px_1fr]">
      <div>
        <div className="aspect-[4/5] overflow-hidden rounded-lg bg-black">{img ? <button type="button" onClick={onView} className="h-full w-full" title="Ver em tamanho grande"><img src={img} alt={`Quadro ${slide.n}`} className="h-full w-full object-cover" /></button> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem imagem</div>}</div>
        <Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy || !canPrompt} onClick={onRePrompt} title="A IA escreve de novo o prompt deste quadro, considerando os personagens atuais da série (substitui o prompt abaixo)"><Sparkles className="h-3.5 w-3.5" /> Recriar prompt</Button>
        <Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy || !canDraw} onClick={onRedraw} title="Desenha o quadro de novo usando o prompt abaixo"><ImagePlus className="h-3.5 w-3.5" /> {img ? "Redesenhar" : "Desenhar"}</Button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2"><span className="rounded bg-primary/15 px-1.5 font-mono text-xs text-primary">{slide.n}</span><Input value={slide.title} onChange={(e) => onChange({ title: e.target.value })} className="h-8 text-[13px]" placeholder="Título interno" />{slide.element && <span className="shrink-0 text-[10px] text-muted-foreground">{slide.element}</span>}</div>
        <div><label className={labelCls}>Narrador</label><Textarea rows={2} value={slide.narrator} onChange={(e) => onChange({ narrator: e.target.value })} className="text-[13px]" /></div>
        {slide.dialogues.map((d, i) => (
          <div key={i} className="grid grid-cols-[110px_1fr_28px] gap-2">
            <Input value={d.character} onChange={(e) => setDialogue(i, { character: e.target.value })} className="h-8 text-[13px]" placeholder="Personagem" />
            <Input value={d.text} onChange={(e) => setDialogue(i, { text: e.target.value })} className="h-8 text-[13px]" placeholder="Fala" />
            <button type="button" onClick={() => onChange({ dialogues: slide.dialogues.filter((_, k) => k !== i) })} className="text-muted-foreground hover:text-destructive" aria-label="Remover fala"><X className="h-4 w-4" /></button>
          </div>
        ))}
        {slide.dialogues.length < 3 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ dialogues: [...slide.dialogues, { character: "", text: "", x: "left" }] })}><Plus className="h-3 w-3" /> Fala</Button>}
        <div><label className={labelCls}>Cena (o que se vê)</label><Input value={slide.action} onChange={(e) => onChange({ action: e.target.value })} className="h-8 text-[13px]" /></div>
        {slide.n > 1 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">Narrador em
            <select value={slide.narrator_pos} onChange={(e) => onChange({ narrator_pos: e.target.value as "top" | "bottom" })} className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"><option value="top">cima (balões embaixo)</option><option value="bottom">baixo (balões em cima)</option></select></div>
        )}
        <div><label className={labelCls}>Prompt de imagem</label><Textarea rows={3} value={slide.image_prompt} onChange={(e) => onChange({ image_prompt: e.target.value })} className="font-mono text-[11px]" placeholder="Gerado no passo 2 (ou escreva o seu)" /></div>
      </div>
    </div>
  );
}

// ─── Aprovação do cliente ──────────────────────────────────────────────────────

function ApprovalSection({ seriesId, episodeId }: { seriesId: string; episodeId: string }) {
  const [share, setShare] = useState<service.EpisodeShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShare(null);
    service.getEpisodeShare(seriesId, episodeId).then(setShare).catch((e) => setError(studio.errorMessage(e)));
  }, [seriesId, episodeId]);

  const toggle = async (enabled: boolean) => {
    if (!enabled && !window.confirm("Desativar o link? O link atual deixa de funcionar e a aprovação registrada é apagada.")) return;
    setBusy(true);
    setError(null);
    try { setShare(await service.setEpisodeShare(seriesId, episodeId, enabled)); } catch (e) { setError(studio.errorMessage(e)); } finally { setBusy(false); }
  };

  const url = share?.share_token ? `${window.location.origin}/public/novela/${share.share_token}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt("Copie o link:", url); }
  };

  return (
    <Section n={4} title="Aprovação do cliente">
      <p className="text-xs text-muted-foreground">Gere um link para o cliente passar pelos quadros, um a um (só as imagens, sem roteiro), e aprovar o episódio.</p>
      {!share ? (
        !error && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : share.share_token ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="text-[13px]" />
            <Button type="button" variant="outline" onClick={copy}>{copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />} {copied ? "Copiado" : "Copiar"}</Button>
            <Button type="button" variant="outline" onClick={() => window.open(url, "_blank")}><ExternalLink className="h-4 w-4" /> Abrir</Button>
          </div>
          <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]", share.approved_at ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-input")}>
            {share.approved_at ? <><CheckCircle2 className="h-4 w-4" /> Aprovado por {share.approved_by ?? "Cliente"} em {new Date(share.approved_at).toLocaleString("pt-BR")}</> : "Aguardando aprovação do cliente."}
            <Button type="button" size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={async () => { setBusy(true); try { setShare(await service.getEpisodeShare(seriesId, episodeId)); } catch (e) { setError(studio.errorMessage(e)); } finally { setBusy(false); } }}>Atualizar</Button>
          </div>
          <Button type="button" size="sm" variant="ghost" className="hover:text-destructive" disabled={busy} onClick={() => toggle(false)}>Desativar link</Button>
        </div>
      ) : (
        <Button type="button" disabled={busy} onClick={() => toggle(true)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Gerar link de aprovação</Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Section>
  );
}

// ─── Vídeo narrado ─────────────────────────────────────────────────────────────

const NARRATION_STYLES = [
  { id: "historiador", label: "Historiador (emocionado, com ênfase)" },
  { id: "suspense", label: "Suspense (misterioso, pausado)" },
  { id: "neutro", label: "Neutro (leitura simples)" },
];

function VideoSection({ episode, series, busy, onChange, onGenerate }: { episode: Episode; series: Series; busy: boolean; onChange: (e: Episode) => void; onGenerate: () => void }) {
  const [voices, setVoices] = useState<service.Voice[] | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [settings, setSettings] = useState<service.ElevenSettings | null>(null);
  const set = <K extends keyof Episode>(k: K, v: Episode[K]) => onChange({ ...episode, [k]: v });

  useEffect(() => { service.getElevenSettings().then(setSettings).catch(() => undefined); }, []);

  const loadVoices = async () => {
    setVoiceError(null);
    try { setVoices(await service.listVoices()); } catch (e) { setVoiceError(studio.errorMessage(e)); }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setVoiceError(null);
    try { onChange(await service.uploadAudio(series.id, episode.id, file)); } catch (e) { setVoiceError(studio.errorMessage(e)); } finally { setUploading(false); }
  };

  const voiceValue = episode.voice_id || series.narrator_voice_id || settings?.voice_id || "";
  return (
    <Section n={5} title="Vídeo narrado">
      <p className="text-xs text-muted-foreground">As imagens da história (sem balões) com zoom lento, legendas e uma narração: com a voz gerada no ElevenLabs ou com um áudio seu.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={labelCls}>Narração</label>
          <select value={episode.narration_mode} onChange={(e) => set("narration_mode", e.target.value as Episode["narration_mode"])} className={selectCls}>
            <option value="eleven">Voz gerada no ElevenLabs</option><option value="upload">Áudio que eu gravei</option></select></div>
        <div><label className={labelCls}>Formato</label>
          <select value={episode.video_format} onChange={(e) => set("video_format", e.target.value as Episode["video_format"])} className={selectCls}>
            <option value="reels">Reels / TikTok / Shorts (1080×1920)</option><option value="feed">Feed (1080×1350)</option></select></div>
      </div>

      {episode.narration_mode === "upload" ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-[13px] hover:bg-accent">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {episode.audio_file ? "Trocar áudio" : "Anexar áudio"}
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          </label>
          {episode.audio_file && <><span className="text-xs text-muted-foreground">{episode.audio_name}</span><audio controls src={episode.audio_file} className="h-8" /><Button size="sm" variant="ghost" onClick={async () => onChange(await service.deleteAudio(series.id, episode.id))}><X className="h-3 w-3" /> Remover</Button></>}
          <p className="w-full text-xs text-muted-foreground">O tempo de cada quadro é proporcional ao tamanho do texto de narração. Edite o texto de narração em cada quadro se precisar.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Voz do narrador {settings && !settings.configured && <span className="text-amber-300">(cadastre a chave do ElevenLabs em "Prompts e estilos")</span>}</label>
            {voices ? (
              <select value={voiceValue} onChange={(e) => set("voice_id", e.target.value)} className={selectCls}><option value="">Padrão da série / ajustes</option>{voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            ) : (
              <div className="flex gap-2"><Input value={episode.voice_id} onChange={(e) => set("voice_id", e.target.value)} placeholder="voice id (vazio = padrão)" /><Button type="button" variant="outline" onClick={loadVoices} disabled={!settings?.configured}>Carregar vozes</Button></div>
            )}
            {voiceError && <p className="mt-1 text-xs text-destructive">{voiceError}</p>}
          </div>
          <div><label className={labelCls}>Jeito de narrar</label>
            <select value={episode.narration_style} onChange={(e) => set("narration_style", e.target.value as Episode["narration_style"])} className={selectCls}>{NARRATION_STYLES.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></div>
        </div>
      )}
      {voiceError && episode.narration_mode === "upload" && <p className="text-xs text-destructive">{voiceError}</p>}

      <div className="flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" checked={episode.captions} onChange={(e) => set("captions", e.target.checked)} /> Legendas</label>
        <label className="flex items-center gap-2" title="Abre o vídeo com o nome da série e do episódio, anunciados pelo narrador"><input type="checkbox" checked={episode.intro} onChange={(e) => set("intro", e.target.checked)} /> Abertura animada</label>
      </div>
      <Button onClick={onGenerate} disabled={busy}><Sparkles className="h-4 w-4" /> {episode.video ? "Gerar o vídeo de novo" : "Gerar o vídeo"}</Button>
      {episode.video && (
        <div className="space-y-2">
          <video controls src={episode.video} className="max-h-[480px] rounded-lg bg-black" />
          <a href={episode.video} download={`episodio_${String(episode.number).padStart(2, "0")}.mp4`} className="inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline"><Download className="h-3.5 w-3.5" /> Baixar o vídeo (MP4)</a>
        </div>
      )}
    </Section>
  );
}
