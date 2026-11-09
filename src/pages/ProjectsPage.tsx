import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Star, FolderHeart, MoreVertical, Settings, Users, Share2, Trash2, BarChart3, Rocket } from "lucide-react";
import * as projectService from "@/src/services/project.service";
import { useTaskStore } from "@/src/store/task.store";
import { useDashboard } from "@/src/context/dashboard.context";
import { Card } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/src/components/ui/dropdown-menu";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { projectProgress } from "@/src/lib/project-progress";
import { PINK, SEMANTIC, hexA } from "@/src/lib/design";

const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function ProjectCardSkeleton() {
  return (
    <div className="flex min-h-[210px] flex-col justify-between gap-5 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-16" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between"><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-8" /></div>
        <Skeleton className="h-1.5 w-full" />
      </div>
    </div>
  );
}

/** Situação exibida no cartão, derivada do progresso (mesma regra de antes). */
function projectStatus(progress: number): { label: string; color: string } {
  if (progress === 100) return { label: "Concluído", color: SEMANTIC.success };
  if (progress > 50) return { label: "Ativo", color: PINK };
  return { label: "Planejamento", color: "#8A8A94" };
}

export function ProjectsPage() {
  const { projects, tasks, isLoading, openNewProject, openEditProject, openManageMembers, handleDeleteProject, setSelectedFunnelId, searchQuery } = useDashboard();
  const updateProjectInState = useTaskStore((s) => s.updateProjectInState);
  const navigate = useNavigate();
  const [togglingFavorite, setTogglingFavorite] = useState<number | null>(null);

  async function handleToggleFavorite(e: React.MouseEvent, projectId: number, current: boolean | null) {
    e.stopPropagation();
    if (togglingFavorite === projectId) return;
    setTogglingFavorite(projectId);
    try {
      const updated = await projectService.updateProject(projectId, { favorite: !current });
      updateProjectInState(updated);
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingFavorite(null);
    }
  }

  function handleShare(projectId: number) {
    const origin = window.location.origin;
    const pathname = window.location.pathname.replace(/\/$/, "");
    navigator.clipboard.writeText(`${origin}${pathname}?project=${projectId}`).then(() => alert("Link copiado!"));
  }

  function selectProject(project: (typeof projects)[number]) {
    const targetFunnel = project.funnels.find((f) => f.is_default) || project.funnels[0];
    if (targetFunnel) setSelectedFunnelId(targetFunnel.id);
    navigate("/kanban");
  }

  const q = fold(searchQuery);
  const filteredProjects = projects.filter((p) => fold(p.name).includes(q) || fold(p.content || "").includes(q));

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Projetos</h1>
          <span className="text-sm text-muted-foreground">
            {projects.length} {projects.length === 1 ? "projeto cadastrado" : "projetos cadastrados"}
          </span>
        </div>
        <Button onClick={openNewProject} className="gap-1.5">
          <Plus className="h-4 w-4" strokeWidth={2.4} /> Novo projeto
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <ProjectCardSkeleton /><ProjectCardSkeleton /><ProjectCardSkeleton />
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed py-20 text-center">
          <FolderHeart className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium text-muted-foreground">
            {searchQuery ? "Nenhum projeto encontrado para esta busca." : "Nenhum projeto cadastrado ainda."}
          </p>
          {!searchQuery && (
            <Button onClick={openNewProject} variant="secondary" size="sm" className="mt-4 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Criar primeiro projeto
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredProjects.map((project) => {
            const color = project.color || PINK;
            const funnelIds = project.funnels.map((f) => f.id);
            const projectTasks = tasks.filter((t) => !t.deleted_at && t.funnel_id != null && funnelIds.includes(t.funnel_id));
            const progress = projectProgress(project, tasks);
            const sprintCount = projectTasks.filter((t) => t.is_sprint).length;
            const status = projectStatus(progress);
            const members = project.projectUsers ?? [];
            return (
              <Card
                key={project.id}
                onClick={() => selectProject(project)}
                className="group flex min-h-[210px] cursor-pointer flex-col gap-4 p-5 transition-colors hover:border-input"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold"
                    style={{ color: status.color, backgroundColor: hexA(status.color, 0.14) }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                    {status.label}
                  </span>
                  <div className="-mr-1.5 flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Ver painel do projeto"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/projects/${project.id}`);
                      }}
                    >
                      <BarChart3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={project.favorite ? "Remover dos favoritos" : "Favoritar"}
                      onClick={(e) => handleToggleFavorite(e, project.id, project.favorite ?? false)}
                      disabled={togglingFavorite === project.id}
                    >
                      <Star className={`h-4 w-4 ${project.favorite ? "fill-warning text-warning" : ""}`} />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => openEditProject(project.id)}><Settings className="h-4 w-4" /> Configurações</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openManageMembers(project.id)}><Users className="h-4 w-4" /> Membros</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleShare(project.id)}><Share2 className="h-4 w-4" /> Compartilhar link</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteProject(project.id)}><Trash2 className="h-4 w-4" /> Excluir projeto</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
                    <h3 className="truncate font-display text-base font-semibold tracking-[-0.01em]">{project.name}</h3>
                  </div>
                  {project.content ? (
                    <p className="line-clamp-2 text-[13px] leading-[1.45] text-muted-foreground">{project.content}</p>
                  ) : (
                    <p className="text-[13px] text-subtle">Sem descrição</p>
                  )}
                </div>

                <div className="mt-auto flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progresso</span>
                    <span className="font-mono">{progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-md bg-input/70">
                    <div className="h-full rounded-md transition-all" style={{ width: `${progress}%`, backgroundColor: progress === 100 ? SEMANTIC.success : color }} />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <div className="flex pl-1.5">
                    {members.length > 0 ? (
                      <>
                        {members.slice(0, 3).map((pu) => pu.user && <UserAvatar key={pu.id} user={pu.user} className="-ml-1.5 h-6 w-6 border-2 border-card text-[9px]" />)}
                        {members.length > 3 && (
                          <span className="-ml-1.5 grid h-6 min-w-6 place-items-center rounded-full border-2 border-card bg-input px-1 font-mono text-[9px] text-muted-foreground">+{members.length - 3}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-subtle">Sem membros</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
                    {sprintCount > 0 && (
                      <span className="flex items-center gap-1 text-warning" title="Tarefas na sprint">
                        <Rocket className="h-3 w-3" /> {sprintCount}
                      </span>
                    )}
                    <span>{projectTasks.length} {projectTasks.length === 1 ? "tarefa" : "tarefas"}</span>
                    {project.funnels.length > 1 && <span>{project.funnels.length} funis</span>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
