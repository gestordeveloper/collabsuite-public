import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, GalleryHorizontal, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Input } from "@/src/components/ui/input";
import { NewCarouselDialog } from "@/src/components/carrossel/NewCarouselDialog";
import { SlidePreview } from "@/src/components/carrossel/SlidePreview";
import { BrandbooksPanel } from "@/src/components/carrossel/BrandbooksPanel";
import { PeoplePanel } from "@/src/components/carrossel/PeoplePanel";
import { ComicsPanel } from "@/src/components/carrossel/ComicsPanel";
import { StudioSettingsPanel } from "@/src/components/carrossel/StudioSettingsPanel";
import { useDashboard } from "@/src/context/dashboard.context";
import { cn } from "@/src/lib/utils";
import * as service from "@/src/services/carrossel.service";
import type { BrandbookSummary, CarouselProjectData, ProjectListItem } from "@/src/services/carrossel.service";

type Tab = "carrosseis" | "novelas" | "marcas" | "pessoas" | "prompts";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

export function CarouselsPage() {
  const navigate = useNavigate();
  const { projects } = useDashboard();
  const [tab, setTab] = useState<Tab>("carrosseis");
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [brandbooks, setBrandbooks] = useState<BrandbookSummary[]>([]);
  const [previews, setPreviews] = useState<Record<string, CarouselProjectData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, bbs] = await Promise.all([service.listProjects(projectFilter ? Number(projectFilter) : undefined), service.listBrandbooks()]);
      setItems(list);
      setBrandbooks(bbs);
      setError(null);
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível carregar os carrosséis."));
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);

  useEffect(() => { void load(); }, [load]);

  // capa de cada carrossel: carrega o primeiro slide só dos itens visíveis (máx. 12) para não pesar a lista
  useEffect(() => {
    items.slice(0, 12).forEach((it) => {
      if (previews[it.id]) return;
      service.getProject(it.id).then((p) => setPreviews((prev) => ({ ...prev, [it.id]: p }))).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const remove = async (it: ProjectListItem) => {
    if (!window.confirm(`Excluir "${it.title}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await service.deleteProject(it.id);
      setItems((l) => l.filter((x) => x.id !== it.id));
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível excluir."));
    }
  };

  const duplicate = async (it: ProjectListItem) => {
    try {
      await service.duplicateProject(it.id);
      await load();
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível duplicar."));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold">Carrosséis</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Gere carrosséis e posts para Instagram e LinkedIn com a identidade da sua marca. A IA escreve usando os modelos do brand book; você ajusta e exporta em PNG.
            </p>
          </div>
          <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Novo carrossel</Button>
        </div>

        <div className="flex gap-1 border-b border-border">
          {([["carrosseis", "Meus carrosséis"], ["novelas", "Mini-novelas HQ"], ["marcas", "Marcas"], ["pessoas", "Pessoas"], ["prompts", "Prompts e estilos"]] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}

        {tab === "carrosseis" && (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar carrossel…" className="h-9 pl-8 text-[13px]" />
              </div>
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none">
                <option value="">Todos os projetos</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {loading ? (
              <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-input py-16 text-center">
                <GalleryHorizontal className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{items.length ? "Nenhum carrossel encontrado." : "Você ainda não criou nenhum carrossel."}</p>
                {!items.length && <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Criar o primeiro</Button>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map((it) => {
                  const pv = previews[it.id];
                  const brand = brandbooks.find((b) => b.id === it.brandbook_id);
                  return (
                    <div key={it.id} className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/50">
                      <button type="button" onClick={() => navigate(`/carrosseis/${it.id}`)} className="block w-full text-left">
                        <div className="flex aspect-[4/5] w-full items-center justify-center overflow-hidden bg-black">
                          {pv?.slides[0] ? (
                            <SlidePreview brandbookId={pv.brandbook_id} slide={pv.slides[0]} total={pv.slides.length} isSingle={pv.is_single_slide} width="fluid" debounceMs={0} className="rounded-none" />
                          ) : (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <div className="space-y-1 p-3">
                          <div className="line-clamp-2 text-sm font-semibold leading-snug">{it.title}</div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>{it.slide_count} {it.slide_count === 1 ? "slide" : "slides"}</span>
                            <span>·</span>
                            <span>{brand?.name || it.brandbook_id}</span>
                            <span>·</span>
                            <span>{timeAgo(it.updated_at)}</span>
                          </div>
                          {it.project && <Badge variant="secondary" className="text-[10px]">{it.project.name}</Badge>}
                        </div>
                      </button>
                      <div className="flex justify-end gap-1 border-t border-border px-2 py-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicar" onClick={() => duplicate(it)}><Copy className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" title="Excluir" onClick={() => remove(it)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === "novelas" && <ComicsPanel />}
        {tab === "marcas" && <BrandbooksPanel brandbooks={brandbooks} onChanged={load} />}
        {tab === "pessoas" && <PeoplePanel />}
        {tab === "prompts" && <StudioSettingsPanel brandbooks={brandbooks} />}
      </div>

      <NewCarouselDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        brandbooks={brandbooks}
        onCreated={(p) => navigate(`/carrosseis/${p.id}`)}
      />
    </div>
  );
}
