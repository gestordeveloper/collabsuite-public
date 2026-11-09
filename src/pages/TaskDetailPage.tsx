import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Layers, Image as ImageIcon, Link2, Eraser, Camera, Check, Share2, Trash2, ArrowLeft, Plus, X, Video, ChevronRight, ChevronDown, Rocket, Phone, StickyNote, Sidebar as SidebarIcon, FileDown, Loader2, BadgeCheck
} from "lucide-react";
import type { FunnelStage, User as UserType } from "@/src/types";
import * as taskService from "@/src/services/task.service";
import * as uploadService from "@/src/services/upload.service";
import * as userService from "@/src/services/user.service";
import * as attachmentService from "@/src/services/attachment.service";
import type { TaskAttachment } from "@/src/types";
import { useTaskStore } from "@/src/store/task.store";
import { useDashboard } from "@/src/context/dashboard.context";
import { DuplicateTaskModal } from "@/src/components/modals/DuplicateTaskModal";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Badge } from "@/src/components/ui/badge";
import { Switch } from "@/src/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { NotionEditor } from "@/src/components/editor/NotionEditor";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { TemplateSelector, type TaskTemplate } from "@/src/components/task-templates/TemplateSelector";
import { SpreadsheetTemplate } from "@/src/components/task-templates/SpreadsheetTemplate";
import { FormTemplate } from "@/src/components/task-templates/FormTemplate";
import { ProposalConfig } from "@/src/components/task-templates/ProposalConfig";
import { FlowchartTemplate } from "@/src/components/task-templates/FlowchartTemplate";
import { WhatsAppTaskTemplate } from "@/src/components/task-templates/WhatsAppTaskTemplate";
import { WhiteboardTemplate } from "@/src/components/task-templates/WhiteboardTemplate";
import { MeetingRecorder } from "@/src/components/task/MeetingRecorder";
import { exportTaskDocumentToPdf } from "@/src/lib/task-document-pdf-export";
import { toBrazilInputValue } from "@/src/lib/brazilTime";

const priorityConfig: Record<string, { label: string; variant: "destructive" | "warning" | "secondary" | "outline" }> = {
  high: { label: "Alta Prioridade", variant: "destructive" },
  medium: { label: "Média Prioridade", variant: "warning" },
  low: { label: "Baixa Prioridade", variant: "secondary" },
  none: { label: "Sem Prioridade", variant: "outline" },
};

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5 hover:bg-accent/50 md:flex-row md:items-center md:gap-4 md:py-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground md:min-w-[160px] md:text-sm md:font-normal md:normal-case md:tracking-normal">
        {label}
      </span>
      <div className="flex min-h-[2.25rem] flex-1 items-center">{children}</div>
    </div>
  );
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const funnels = useTaskStore((s) => s.funnels);
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);
  const { setHeaderExtra, sidebarCollapsed, setSidebarCollapsed } = useDashboard();

  const task = tasks.find((t) => t.id === Number(id)) ?? null;
  const funnel = funnels.find((f) => f.id === task?.funnel_id) ?? null;
  const stages: FunnelStage[] = funnel?.stages ?? [];

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [coverUrlInput, setShowCoverUrlInput] = useState("");
  const [showCoverUrlInput, setUrlVisible] = useState(false);
  const [users, setUsers] = useState<Partial<UserType>[]>([]);
  const [showProperties, setShowProperties] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const [templateSelectorOpen, setTemplateSelectorOpen] = useState(false);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [approving, setApproving] = useState(false);

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setContent(task.content || task.description || "");
    }
  }, [task?.id]);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = titleRef.current.scrollHeight + "px";
    }
  }, [title]);

  useEffect(() => {
    userService.fetchUsers().then(setUsers).catch(() => { });
  }, []);

  const saveTitle = useCallback((val: string) => {
    if (!task) return;
    setSaving(true);
    taskService.updateTask(task.id, { title: val }).then((updated) => {
      updateTaskInState(updated);
    }).finally(() => setSaving(false));
  }, [task?.id]);

  const saveContent = useCallback((val: string) => {
    if (!task) return;
    setSaving(true);
    taskService.updateTask(task.id, { content: val, description: val }).then((updated) => {
      updateTaskInState(updated);
    }).finally(() => setSaving(false));
  }, [task?.id]);

  function onTitleChange(val: string) {
    setTitle(val);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => saveTitle(val), 800);
  }

  function onContentChange(val: string) {
    setContent(val);
    if (contentTimer.current) clearTimeout(contentTimer.current);
    contentTimer.current = setTimeout(() => saveContent(val), 1000);
  }

  const sprintTasks = useMemo(() => tasks.filter((t) => t.is_sprint && t.id !== task?.id), [tasks, task?.id]);

  const priority = priorityConfig[task?.priority ?? "none"];

  const handleShareClick = useCallback(() => {
    if (!task) return;
    const url = `${window.location.origin}/public/task/${task.id}`;
    navigator.clipboard.writeText(url).catch(() => {
      const el = document.createElement("input");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  }, [task?.id]);

  const handleDeleteClick = useCallback(() => {
    if (!task) return;
    if (!confirm("Excluir esta tarefa?")) return;
    taskService.deleteTask(task.id).then(() => {
      useTaskStore.getState().removeTask(task.id);
      navigate("/kanban");
    });
  }, [task, navigate]);

  const handleExportPdf = useCallback(async () => {
    if (!task) return;
    setExportingPdf(true);
    try {
      await exportTaskDocumentToPdf(task);
    } catch (err) {
      console.error("Falha ao gerar PDF", err);
      alert("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setExportingPdf(false);
    }
  }, [task]);

  const handleApprovalToggle = useCallback(async () => {
    if (!task) return;
    setApproving(true);
    try {
      updateTaskInState(await taskService.setTaskApproval(task.id, !task.approved_at));
    } catch (err) {
      console.error("Falha ao alterar aprovação", err);
      alert("Não foi possível alterar a aprovação. Tente novamente.");
    } finally {
      setApproving(false);
    }
  }, [task, updateTaskInState]);

  useEffect(() => {
    if (!task) return;

    const currentTemplate = (task.template as TaskTemplate) || "default";

    setHeaderExtra(
      <>
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/kanban")}>
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Voltar</span>
        </Button>
        {saving && <span className="text-xs text-muted-foreground">Salvando alterações...</span>}
        <div className="hidden md:flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Mostrar barra lateral" : "Esconder barra lateral"}
            className={`h-8 w-8 transition-colors ${
              sidebarCollapsed ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <SidebarIcon className="h-4 w-4" />
          </Button>
          <TemplateSelector
            current={currentTemplate}
            open={templateSelectorOpen}
            setOpen={setTemplateSelectorOpen}
            onChange={async (tmpl) => {
              const updated = await taskService.updateTask(task.id, { template: tmpl });
              updateTaskInState(updated);
            }}
          />
          {currentTemplate === "default" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 transition-colors"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              title="Baixar esta tarefa como PDF"
            >
              {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              <span className="hidden lg:inline">{exportingPdf ? "Gerando PDF..." : "Baixar PDF"}</span>
            </Button>
          )}
          {currentTemplate === "default" && (
            <Button
              variant={task.approved_at ? "default" : "outline"}
              size="sm"
              className={`gap-2 transition-colors ${task.approved_at ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""}`}
              onClick={handleApprovalToggle}
              disabled={approving}
              title={task.approved_at ? `Aprovado por ${task.approved_by ?? "—"} — clique para desfazer` : "Marcar esta tarefa como aprovada"}
            >
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
              <span className="hidden lg:inline">{task.approved_at ? "Aprovado" : "Aprovar"}</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 transition-colors"
            onClick={handleShareClick}
            title="Copiar link público da tarefa"
          >
            {shareCopied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
            {shareCopied ? "Copiado!" : "Compartilhar"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsDuplicateModalOpen(true)}
            title="Duplicar Tarefa"
          >
            <Layers className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDeleteClick}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      </>
    );
    return () => setHeaderExtra(null);
  }, [saving, shareCopied, task?.id, navigate, setHeaderExtra, task, updateTaskInState, templateSelectorOpen, handleShareClick, handleDeleteClick, handleExportPdf, exportingPdf, handleApprovalToggle, approving, sidebarCollapsed, setSidebarCollapsed]);

  if (!task) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Layers className="h-6 w-6 animate-pulse" /> Carregando tarefa...
      </div>
    );
  }

  async function refreshTask() {
    const fresh = await taskService.fetchTask(task!.id);
    updateTaskInState(fresh);
    setContent(fresh.content || fresh.description || "");
    setRefreshKey((k) => k + 1);
  }

  async function handleFieldSave(field: string, value: any) {
    const updated = await taskService.updateTask(task!.id, { [field]: value });
    updateTaskInState(updated);
  }

  async function handleCoverUpload(file: File) {
    const url = await uploadService.uploadImage(file);
    handleFieldSave("cover", url);
    setShowCoverMenu(false);
  }

  async function handleAddMember(userId: number) {
    await taskService.addTaskMember(task!.id, userId);
    await refreshTask();
  }

  async function handleRemoveMember(userId?: number) {
    if (!userId) return;
    await taskService.removeTaskMember(task!.id, userId);
    await refreshTask();
  }

  async function handleToggleChecklist(itemId: number, current: boolean | number) {
    await taskService.toggleChecklistItem(itemId, !(current === true || current === 1));
    await refreshTask();
  }

  async function handleDeleteChecklist(itemId: number) {
    await taskService.deleteChecklistItem(itemId);
    await refreshTask();
  }

  async function handleGenerateMeetLink() {
    await taskService.generateMeetLink(task!.id);
    await refreshTask();
  }

  async function handleUploadAttachment(file: File): Promise<TaskAttachment | null> {
    try {
      const { url, size, type } = await attachmentService.uploadFile(file);
      const att = await attachmentService.createAttachment(task!.id, {
        file_name: file.name,
        file_url: url,
        file_size: size,
        file_type: type,
      });
      await refreshTask();
      return att;
    } catch (err) {
      console.error("Upload failed", err);
      return null;
    }
  }

  async function handleDeleteAttachment(attachmentId: number) {
    await attachmentService.deleteAttachment(task!.id, attachmentId);
    await refreshTask();
  }

  const stageName = stages.find((s) => s.id === task.stage_id)?.name ?? "Sem etapa";

  // Title + badges + "Mostrar propriedades" panel — shared by the default (Notion-style) view
  // and the specialized templates (fluxograma/planilha/formulário), which used to skip it
  // entirely and only show a read-only title inside their own toolbar. A plain function call
  // (not a `<Component/>`) so it stays part of the parent's own render tree instead of becoming
  // a separate component instance that would remount (and drop input focus) on every render.
  function renderPropertiesHeader() {
    return (
      <>
        {/* Title */}
        <textarea
          ref={titleRef}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onInput={(e) => {
            const el = e.target as HTMLTextAreaElement;
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";
          }}
          rows={1}
          className="task-title-textarea w-full resize-none overflow-hidden bg-transparent font-display text-2xl font-bold md:text-4xl focus:outline-none"
          placeholder="Título da tarefa"
        />

        {/* Badges */}
        <div className="mt-3 flex flex-wrap gap-2">
          {funnel?.prefix && (
            <Badge variant="secondary" className="font-mono">
              {funnel.prefix}-{task.id}
            </Badge>
          )}
          {task.type === "note" ? (
            <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400 border-amber-600/20 bg-amber-500/10">
              <StickyNote className="h-3 w-3" /> Nota de Agenda
            </Badge>
          ) : (
            <Badge variant={priority.variant}>{priority.label}</Badge>
          )}
          <Badge variant="outline">{stageName}</Badge>
          {task.is_sprint && <Badge variant="outline" className="gap-1 text-orange-600 dark:text-orange-400"><Rocket className="h-3 w-3" /> Sprint</Badge>}
          {task.is_called && <Badge variant="outline" className="gap-1 text-blue-600 dark:text-blue-400"><Phone className="h-3 w-3" /> Chamado</Badge>}
          {task.is_whatsapp && <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">WhatsApp</Badge>}
        </div>

        {/* Properties (Notion-style collapsible) */}
        <div className="mt-4">
          <button
            onClick={() => setShowProperties(!showProperties)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showProperties ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {showProperties ? "Ocultar propriedades" : "Mostrar propriedades"}
          </button>
          {task.type === "meeting" && (
            <div className="mt-2">
              <MeetingRecorder taskId={task.id} taskTitle={task.title} onUpload={handleUploadAttachment} />
            </div>
          )}
          {showProperties && (
            <div className="mt-2 divide-y rounded-lg border">
              <PropertyRow label="Etapa do Projeto">
                <select value={task.stage_id ?? ""} onChange={(e) => { taskService.updateTask(task.id, { stage_id: Number(e.target.value) }).then(updateTaskInState); }} className="h-8 w-full bg-transparent text-sm focus:outline-none">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </PropertyRow>
              <PropertyRow label="Responsável">
                <select value={task.user_id ?? ""} onChange={(e) => handleFieldSave("user_id", Number(e.target.value) || null)} className="h-8 w-full bg-transparent text-sm focus:outline-none">
                  <option value="">Sem responsável</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ""}</option>)}
                </select>
              </PropertyRow>
              {task.type !== "note" && (
                <>
                  <PropertyRow label="Prioridade">
                    <select value={task.priority ?? "none"} onChange={(e) => handleFieldSave("priority", e.target.value === "none" ? null : e.target.value)} className="h-8 w-full bg-transparent text-sm focus:outline-none">
                      <option value="none">Sem prioridade</option>
                      <option value="low">Baixa</option>
                      <option value="medium">Média</option>
                      <option value="high">Alta</option>
                    </select>
                  </PropertyRow>
                  <PropertyRow label="Sprint">
                    <Switch checked={!!task.is_sprint} onCheckedChange={(c) => handleFieldSave("is_sprint", c)} />
                  </PropertyRow>

                  <PropertyRow label="Sprint de Referência">
                    <select
                      onChange={(e) => handleFieldSave("sprint_id", Number(e.target.value) || null)}
                      className="h-8 w-full bg-transparent text-sm focus:outline-none"
                      value={task.sprint_id ?? ""}
                    >
                      <option value="">— Nenhuma —</option>
                      {sprintTasks.filter((t) => t.funnel_id === task.funnel_id).map((t) => (
                        <option key={t.id} value={t.id}>🚀 {t.title}</option>
                      ))}
                      {sprintTasks.filter((t) => t.funnel_id !== task.funnel_id).length > 0 && (
                        <optgroup label="Outros projetos">
                          {sprintTasks.filter((t) => t.funnel_id !== task.funnel_id).map((t) => (
                            <option key={t.id} value={t.id}>🚀 {t.title}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </PropertyRow>

                  <PropertyRow label="Chamado Técnico">
                    <div className="flex items-center gap-3">
                      <Switch checked={!!task.is_called} onCheckedChange={(c) => handleFieldSave("is_called", c)} />
                      {task.is_called && (
                        <Input placeholder="Motivo" defaultValue={task.call_reason ?? ""} onBlur={(e) => handleFieldSave("call_reason", e.target.value)} className="h-8 w-full md:h-7 md:w-48" />
                      )}
                    </div>
                  </PropertyRow>
                  <PropertyRow label="WhatsApp">
                    <Switch checked={!!task.is_whatsapp} onCheckedChange={(c) => handleFieldSave("is_whatsapp", c)} />
                  </PropertyRow>
                </>
              )}
              <PropertyRow label="Membros">
                <div className="flex flex-wrap gap-1">
                  {task.taskUsers?.map((tu) => tu.user && (
                    <span key={tu.id} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs">
                      <UserAvatar user={tu.user} className="h-4 w-4" />
                      {tu.user.first_name}
                      <button onClick={() => handleRemoveMember(tu.user_id)} className="-mr-0.5 flex h-5 w-5 items-center justify-center rounded-full active:scale-90"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-6 px-1.5"><Plus className="h-3 w-3" /></Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-1">
                      {users.filter((u) => !task.taskUsers?.some((tu) => tu.user_id === u.id)).map((u) => (
                        <button key={u.id} onClick={() => handleAddMember(u.id!)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                          <UserAvatar user={u} className="h-6 w-6" /> {u.first_name} {u.last_name ?? ""}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                </div>
              </PropertyRow>
              <PropertyRow label="Prazo Inicial">
                <Input type="datetime-local" defaultValue={toBrazilInputValue(task.due_at)} onBlur={(e) => handleFieldSave("due_at", e.target.value || null)} className="h-8" />
              </PropertyRow>
              <PropertyRow label="Entrega">
                <Input type="datetime-local" defaultValue={toBrazilInputValue(task.end_at)} onBlur={(e) => handleFieldSave("end_at", e.target.value || null)} className="h-8" />
              </PropertyRow>
              {task.type !== "note" && (
                <>
                  <PropertyRow label="Estimativa">
                    <Input defaultValue={task.estimated_time ?? ""} onBlur={(e) => handleFieldSave("estimated_time", e.target.value || null)} className="h-8" />
                  </PropertyRow>
                  <PropertyRow label="Story Points">
                    <Input type="number" defaultValue={task.story_points ?? ""} onBlur={(e) => handleFieldSave("story_points", e.target.value ? Number(e.target.value) : null)} className="h-8 w-24" />
                  </PropertyRow>
                </>
              )}
              {task.type === "meeting" && (
                <PropertyRow label="Reunião">
                  <div className="flex items-center gap-2">
                    {task.hour_at && <span className="text-xs text-muted-foreground">{task.hour_at}</span>}
                    {task.meet_uri ? (
                      <Button asChild size="sm" className="h-7 gap-1 text-xs"><a href={task.meet_uri} target="_blank" rel="noreferrer"><Video className="h-3 w-3" /> Entrar no Meet</a></Button>
                    ) : (
                      <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={handleGenerateMeetLink}>Gerar Reunião</Button>
                    )}
                  </div>
                </PropertyRow>
              )}
            </div>
          )}
        </div>
      </>
    );
  }

  if (task.template === "proposal") {
    return (
      <>
        <ProposalConfig task={task} />
        <DuplicateTaskModal
          isOpen={isDuplicateModalOpen}
          onClose={() => setIsDuplicateModalOpen(false)}
          task={task}
        />
      </>
    );
  }

  if (task.template === "spreadsheet") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-4 md:px-6 md:pt-6">
          {renderPropertiesHeader()}
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4 pt-4 md:px-6 md:pb-6">
          <SpreadsheetTemplate currentTask={task} />
        </div>
        <DuplicateTaskModal
          isOpen={isDuplicateModalOpen}
          onClose={() => setIsDuplicateModalOpen(false)}
          task={task}
        />
      </div>
    );
  }

  if (task.template === "form") {
    return (
      <>
        <div className="mx-auto max-w-4xl px-4 pt-4 md:px-6 md:pt-6">
          {renderPropertiesHeader()}
        </div>
        <FormTemplate task={task} onSave={handleFieldSave} />
        <DuplicateTaskModal
          isOpen={isDuplicateModalOpen}
          onClose={() => setIsDuplicateModalOpen(false)}
          task={task}
        />
      </>
    );
  }

  if (task.template === "flowchart") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-4 md:px-6 md:pt-6">
          {renderPropertiesHeader()}
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4 pt-4 md:px-6 md:pb-6">
          <FlowchartTemplate currentTask={task} />
        </div>
        <DuplicateTaskModal
          isOpen={isDuplicateModalOpen}
          onClose={() => setIsDuplicateModalOpen(false)}
          task={task}
        />
      </div>
    );
  }

  if (task.template === "whatsapp") {
    return (
      <>
        <div className="mx-auto max-w-4xl px-4 pt-4 md:px-6 md:pt-6">
          {renderPropertiesHeader()}
        </div>
        <WhatsAppTaskTemplate task={task} />
        <DuplicateTaskModal
          isOpen={isDuplicateModalOpen}
          onClose={() => setIsDuplicateModalOpen(false)}
          task={task}
        />
      </>
    );
  }

  if (task.template === "whiteboard") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-4 md:px-6 md:pt-6">
          {renderPropertiesHeader()}
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4 pt-4 md:px-6 md:pb-6">
          <WhiteboardTemplate currentTask={task} />
        </div>
        <DuplicateTaskModal
          isOpen={isDuplicateModalOpen}
          onClose={() => setIsDuplicateModalOpen(false)}
          task={task}
        />
      </div>
    );
  }

  return (
    <div className="bg-background">
      {/* Cover */}
      <div className="relative group">
        {task.cover ? (
          <div className="relative h-40 w-full md:h-64">
            <img src={task.cover} alt="cover" className="h-full w-full object-cover" />
            <Button variant="secondary" size="sm" className="absolute bottom-3 right-3 opacity-100 md:opacity-0 md:group-hover:opacity-100" onClick={() => setShowCoverMenu((v) => !v)}>Alterar capa</Button>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center">
            <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={() => setShowCoverMenu((v) => !v)}>
              <ImageIcon className="h-4 w-4" /> Adicionar capa de fundo
            </Button>
          </div>
        )}
        {showCoverMenu && (
          <div className="absolute right-2 sm:right-6 top-2 z-20 w-[calc(100vw-32px)] sm:w-72 rounded-lg border bg-popover p-2 shadow-md max-w-xs sm:max-w-none">
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <Camera className="h-4 w-4" /> Enviar imagem do computador
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleCoverUpload(e.target.files[0])} />
            </label>
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent" onClick={() => setUrlVisible((v) => !v)}>
              <Link2 className="h-4 w-4" /> Inserir link da imagem
            </button>
            {showCoverUrlInput && (
              <div className="flex gap-1 px-2 py-1">
                <Input value={coverUrlInput} onChange={(e) => setShowCoverUrlInput(e.target.value)} placeholder="https://..." className="h-8" />
                <Button size="sm" onClick={() => { handleFieldSave("cover", coverUrlInput); setShowCoverUrlInput(""); setShowCoverMenu(false); }}>Ok</Button>
              </div>
            )}
            {task.cover && (
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10" onClick={() => handleFieldSave("cover", null)}>
                <Eraser className="h-4 w-4" /> Remover imagem de capa
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body - Notion style */}
      <div className="mx-auto max-w-4xl px-4 py-4 pb-24 md:px-6 md:py-8 md:pb-8">
        {renderPropertiesHeader()}

        {/* Editor */}
        <div className="mt-6">
          <NotionEditor
            key={`${task.id}-${refreshKey}`}
            content={content}
            onChange={onContentChange}
            placeholder="Escreva a descrição da tarefa... use / para comandos"
            taskId={task.id}
            activities={task.activities}
            checklists={task.checklists}
            attachments={task.attachments}
            onAddActivity={async (c, attachment) => { await taskService.addActivity(task.id, c, attachment); await refreshTask(); }}
            onAddChecklist={async (t) => { await taskService.addChecklistItem(task.id, t); await refreshTask(); }}
            onToggleChecklist={handleToggleChecklist}
            onDeleteChecklist={handleDeleteChecklist}
            onUploadAttachment={handleUploadAttachment}
            onDeleteAttachment={handleDeleteAttachment}
            onRefreshTask={refreshTask}
          />
        </div>
      </div>

      {/* Mobile bottom action bar */}
      <div className="fixed inset-x-0 z-30 flex items-center justify-center gap-2 border-t bg-card/90 px-3 py-2 backdrop-blur-lg md:hidden" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}>
        <TemplateSelector
          current={(task.template as TaskTemplate) || "default"}
          open={templateSelectorOpen}
          setOpen={setTemplateSelectorOpen}
          mobileCenter
          onChange={async (tmpl) => {
            const updated = await taskService.updateTask(task.id, { template: tmpl });
            updateTaskInState(updated);
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="active:scale-95"
          onClick={handleShareClick}
        >
          {shareCopied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="active:scale-95"
          onClick={handleExportPdf}
          disabled={exportingPdf}
        >
          {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="active:scale-95"
          onClick={() => setIsDuplicateModalOpen(true)}
        >
          <Layers className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="active:scale-95"
          onClick={handleDeleteClick}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <DuplicateTaskModal
        isOpen={isDuplicateModalOpen}
        onClose={() => setIsDuplicateModalOpen(false)}
        task={task}
      />
    </div>
  );

}