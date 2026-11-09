import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Palette, MoreVertical, Copy, Trash2, Search, FolderOpen, Check } from "lucide-react";
import * as designService from "@/src/services/design.service";
import type { Design, Project } from "@/src/types";
import { useDashboard } from "@/src/context/dashboard.context";
import { Card } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/src/components/ui/dropdown-menu";
import { PagePreview } from "@/src/components/design-studio/PagePreview";
import { parseDesignPages } from "@/src/lib/design-studio/types";

const ALL_PROJECTS = "all";
const NO_PROJECT = "none";

function DesignCardSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="aspect-video w-full rounded-xl" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

interface DesignCardProps {
  design: Design;
  project: Project | null;
  projects: Project[];
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAssignProject: (projectId: number | null) => void;
}

function DesignCard({ design, project, projects, onOpen, onDuplicate, onDelete, onAssignProject }: DesignCardProps) {
  const firstPage = useMemo(
    () => parseDesignPages(design.pages, design.width, design.height)[0],
    [design.pages, design.width, design.height]
  );

  return (
    <Card
      className="group cursor-pointer overflow-hidden p-0 transition-all hover:shadow-md hover:border-primary/40"
      onClick={onOpen}
    >
      <div className="relative aspect-video bg-muted/40">
        {design.thumbnail_url ? (
          <img src={design.thumbnail_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <PagePreview page={firstPage} />
        )}
        <div className="absolute right-2 top-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="h-7 w-7 shadow" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onDuplicate}><Copy className="h-4 w-4" /> Duplicar</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Mover para projeto
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onAssignProject(null)}>
                <span className="h-4 w-4">{!design.project_id ? <Check className="h-4 w-4 text-primary" /> : null}</span>
                Sem projeto
              </DropdownMenuItem>
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => onAssignProject(p.id)}>
                  <span className="h-4 w-4">{design.project_id === p.id ? <Check className="h-4 w-4 text-primary" /> : null}</span>
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="p-3">
        <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-primary">{design.name}</h3>
        <div className="mt-0.5 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">{design.width}×{design.height}</p>
          {project && (
            <span className="flex items-center gap-1 truncate text-[10px] font-medium text-muted-foreground">
              <FolderOpen className="h-3 w-3 shrink-0" /> <span className="truncate">{project.name}</span>
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

export function DesignsPage() {
  const navigate = useNavigate();
  const { projects } = useDashboard();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);

  useEffect(() => {
    designService.listDesigns()
      .then(setDesigns)
      .finally(() => setIsLoading(false));
  }, []);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const filteredDesigns = designs.filter((d) => {
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (projectFilter === NO_PROJECT) return !d.project_id;
    if (projectFilter !== ALL_PROJECTS) return d.project_id === Number(projectFilter);
    return true;
  });

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const project_id = projectFilter !== ALL_PROJECTS && projectFilter !== NO_PROJECT ? Number(projectFilter) : null;
      const design = await designService.createDesign({ name: "Novo design", project_id });
      navigate(`/designs/${design.id}`);
    } catch (err) {
      console.error("Falha ao criar design", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDuplicate(id: number) {
    try {
      const copy = await designService.duplicateDesign(id);
      setDesigns((prev) => [copy, ...prev]);
    } catch (err) {
      console.error("Falha ao duplicar design", err);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir este design? Essa ação não pode ser desfeita.")) return;
    try {
      await designService.deleteDesign(id);
      setDesigns((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Falha ao excluir design", err);
    }
  }

  async function handleAssignProject(id: number, project_id: number | null) {
    try {
      const updated = await designService.updateDesign(id, { project_id });
      setDesigns((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (err) {
      console.error("Falha ao vincular projeto", err);
    }
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Designs</h2>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Crie peças visuais livremente — arraste, redimensione e personalize cada elemento.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating} className="gap-2 h-9 text-xs justify-center w-full sm:w-auto">
          <Plus className="h-4 w-4" /> Novo Design
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome..."
            className="h-9 pl-9"
          />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-9 w-full sm:w-56">
            <SelectValue placeholder="Todos os projetos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>Todos os projetos</SelectItem>
            <SelectItem value={NO_PROJECT}>Sem projeto</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <DesignCardSkeleton /><DesignCardSkeleton /><DesignCardSkeleton />
        </div>
      ) : filteredDesigns.length === 0 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed bg-card py-20 text-center">
          <Palette className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
          <p className="font-medium text-muted-foreground">
            {designs.length === 0 ? "Nenhum design criado ainda." : "Nenhum design encontrado para esse filtro."}
          </p>
          {designs.length === 0 && (
            <Button onClick={handleCreate} variant="secondary" size="sm" className="mt-4 gap-1.5" disabled={creating}>
              <Plus className="h-3.5 w-3.5" /> Criar Primeiro Design
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredDesigns.map((design) => (
            <DesignCard
              key={design.id}
              design={design}
              project={design.project_id ? projectById.get(design.project_id) ?? null : null}
              projects={projects}
              onOpen={() => navigate(`/designs/${design.id}`)}
              onDuplicate={() => handleDuplicate(design.id)}
              onDelete={() => handleDelete(design.id)}
              onAssignProject={(project_id) => handleAssignProject(design.id, project_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
