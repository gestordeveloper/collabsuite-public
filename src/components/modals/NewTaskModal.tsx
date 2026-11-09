import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Calendar, Flag, User, Clock, Flame, Video, Inbox, Sun, Armchair, ArrowRight, FileText } from "lucide-react";
import * as taskService from "@/src/services/task.service";
import * as folderService from "@/src/services/folder.service";
import { useTaskStore } from "@/src/store/task.store";
import type { User as UserType, Funnel } from "@/src/types";

const getTodayStr = () => {
  const d = new Date();
  return d.toISOString().split("T")[0];
};

const getTomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
};

const getWeekendStr = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
};

const getNextWeekStr = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = (1 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
};

const getDayLabel = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
};

const getLongDayLabel = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(".", "");
};

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  funnelId: number | null;
  stageId: number | null;
  users: Partial<UserType>[];
}

export function NewTaskModal({ isOpen, onClose, funnelId, stageId, users }: NewTaskModalProps) {
  const addTask = useTaskStore((s) => s.addTask);
  const { funnels, projects } = useTaskStore();
  const [type, setType] = useState<"task" | "meeting" | "note">("task");
  
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>("");
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [folders, setFolders] = useState<any[]>([]);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [showEstimates, setShowEstimates] = useState(false);

  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [dateSearch, setDateSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "none",
    userId: "",
    dueAt: "",
    dueTime: "",
    endAt: "",
    endTime: "",
    estimatedTime: "",
    storyPoints: "",
  });

  useEffect(() => {
    if (isOpen) {
      setForm({ title: "", description: "", priority: "none", userId: "", dueAt: "", dueTime: "", endAt: "", endTime: "", estimatedTime: "", storyPoints: "" });
      setType("task");
      setShowDatePicker(false);
      setShowPriorityPicker(false);
      setShowAssigneePicker(false);
      setShowEstimates(false);
      setShowProjectMenu(false);
      setProjectSearch("");
      setDateSearch("");
      setIsSubmitting(false);

      setSelectedFolderId("");
      setFolders([]);
      folderService.fetchFolders().then(setFolders).catch(console.error);
      
      const defaultFunnelId = funnelId ? String(funnelId) : "";
      setSelectedFunnelId(defaultFunnelId);
      
      if (stageId) {
        setSelectedStageId(String(stageId));
      } else {
        setSelectedStageId("");
      }
    }
  }, [isOpen, funnelId, stageId, funnels]);

  function handleFunnelChange(fid: string) {
    setSelectedFunnelId(fid);
    const funnel = funnels.find((f) => String(f.id) === fid);
    const firstStage = funnel?.stages[0];
    setSelectedStageId(firstStage ? String(firstStage.id) : "");
  }

  // Every project's first funnel is named "Funil Principal" by default, so a flat list of funnel
  // names was indistinguishable — this groups funnels under their project, and only shows the
  // funnel's own name when a project actually has more than one (otherwise the project name alone
  // already identifies it unambiguously).
  const funnelCountByProject = useMemo(() => {
    const counts = new Map<number, number>();
    funnels.forEach((f) => counts.set(f.project_id, (counts.get(f.project_id) || 0) + 1));
    return counts;
  }, [funnels]);

  function projectNameForFunnel(f: Funnel) {
    return projects.find((p) => p.id === f.project_id)?.name || f.name;
  }

  function displayNameForFunnel(f: Funnel) {
    return (funnelCountByProject.get(f.project_id) || 0) > 1 ? f.name : projectNameForFunnel(f);
  }

  const groupedFunnels = useMemo(() => {
    const query = projectSearch.toLowerCase();
    const filtered = funnels.filter(
      (f) => projectNameForFunnel(f).toLowerCase().includes(query) || f.name.toLowerCase().includes(query)
    );
    const groups = new Map<number, { projectName: string; funnels: Funnel[] }>();
    filtered.forEach((f) => {
      if (!groups.has(f.project_id)) {
        groups.set(f.project_id, { projectName: projectNameForFunnel(f), funnels: [] });
      }
      groups.get(f.project_id)!.funnels.push(f);
    });
    return Array.from(groups.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnels, projects, projectSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || isSubmitting) return;
    setIsSubmitting(true);

    const combinedDueAt = form.dueAt ? (form.dueTime ? `${form.dueAt}T${form.dueTime}` : form.dueAt) : null;
    const combinedEndAt = form.endAt ? (form.endTime ? `${form.endAt}T${form.endTime}` : form.endAt) : null;

    const payload: any = {
      funnel_id: selectedFunnelId ? Number(selectedFunnelId) : null,
      stage_id: selectedStageId ? Number(selectedStageId) : null,
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      user_id: form.userId ? Number(form.userId) : null,
      due_at: combinedDueAt,
      end_at: combinedEndAt,
      hour_at: form.dueTime || null,
      type,
    };
    if (!selectedFunnelId && selectedFolderId) {
      payload.folder_id = Number(selectedFolderId);
    }
    if (type === "task") {
      payload.estimated_time = form.estimatedTime || null;
      payload.story_points = form.storyPoints ? Number(form.storyPoints) : null;
    }
    try {
      const created = await taskService.createTask(payload);
      addTask(created);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      alert(err.response?.data?.error || "Falha ao criar tarefa.");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-4 gap-0 sm:rounded-xl !overflow-visible">
        <DialogTitle className="sr-only">Criar novo item</DialogTitle>
        <DialogDescription className="sr-only">Adicione uma nova tarefa ou agende uma reunião em estilo Todoist.</DialogDescription>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Nome da Tarefa & Descrição (Espaçamento reduzido) */}
          <div className="flex flex-col gap-0.5">
            <input
              type="text"
              placeholder="Nome da tarefa"
              className="w-full bg-transparent border-0 outline-none placeholder:text-muted-foreground/60 text-lg font-semibold py-0.5 focus-visible:ring-0 focus-visible:outline-none"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
            />
            <textarea
              placeholder="Descrição"
              className="w-full bg-transparent border-0 outline-none placeholder:text-muted-foreground/60 text-xs py-0.5 focus-visible:ring-0 focus-visible:outline-none resize-none min-h-[45px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {/* Botões do Todoist (Pills) */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* Seletor de Data Customizado (Estilo Todoist) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowDatePicker(!showDatePicker);
                  setShowPriorityPicker(false);
                  setShowAssigneePicker(false);
                  setShowEstimates(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-accent transition-colors ${
                  form.dueAt ? "border-primary bg-primary/5 text-primary" : "border-input"
                }`}
              >
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{form.dueAt ? `${form.dueAt}${form.dueTime ? ` às ${form.dueTime}` : ""}` : "Data"}</span>
              </button>

              {showDatePicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border bg-popover text-popover-foreground shadow-lg p-2.5 max-h-96 overflow-y-auto space-y-2">
                    <input
                      type="text"
                      placeholder="Digite um vencimento"
                      value={dateSearch}
                      onChange={(e) => setDateSearch(e.target.value)}
                      className="w-full h-8 px-2 bg-muted/50 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary mb-1"
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />

                    {/* Presets */}
                    <div className="space-y-0.5">
                      {[
                        { label: "Hoje", date: getTodayStr(), desc: getDayLabel(getTodayStr()), iconClass: "text-green-500 fill-green-500/10", icon: Calendar },
                        { label: "Amanhã", date: getTomorrowStr(), desc: getDayLabel(getTomorrowStr()), iconClass: "text-amber-500", icon: Sun },
                        { label: "Este fim de semana", date: getWeekendStr(), desc: getDayLabel(getWeekendStr()), iconClass: "text-blue-500", icon: Armchair },
                        { label: "Próxima semana", date: getNextWeekStr(), desc: getLongDayLabel(getNextWeekStr()), iconClass: "text-purple-500", icon: ArrowRight },
                      ]
                        .filter(p => p.label.toLowerCase().includes(dateSearch.toLowerCase()))
                        .map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              setForm({ ...form, dueAt: preset.date });
                              setShowDatePicker(false);
                              setDateSearch("");
                            }}
                            className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-accent text-left"
                          >
                            <span className="flex items-center gap-2">
                              <preset.icon className={`h-4 w-4 ${preset.iconClass}`} />
                              <span className="font-medium">{preset.label}</span>
                            </span>
                            <span className="text-[10px] text-muted-foreground capitalize">{preset.desc}</span>
                          </button>
                        ))}
                    </div>

                    {/* Custom Date selection inputs (start & end) */}
                    <div className="border-t pt-2 space-y-2.5">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold uppercase text-muted-foreground block">Prazo de Entrega</span>
                        <div className="flex gap-2">
                          <Input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} className="h-8 text-xs w-full" />
                          <Input type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} className="h-8 w-24 text-xs" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[9px] font-bold uppercase text-muted-foreground block">Data Final</span>
                        <div className="flex gap-2">
                          <Input type="date" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} className="h-8 text-xs w-full" />
                          <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="h-8 w-24 text-xs" />
                        </div>
                      </div>
                    </div>

                    {/* Limpar data button */}
                    {(form.dueAt || form.endAt) && (
                      <button
                        type="button"
                        onClick={() => {
                          setForm({ ...form, dueAt: "", dueTime: "", endAt: "", endTime: "" });
                          setShowDatePicker(false);
                          setDateSearch("");
                        }}
                        className="w-full text-center py-1.5 rounded text-xs hover:bg-accent text-destructive border-t mt-1 font-medium transition-colors"
                      >
                        Limpar Vencimento
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Prioridade Button */}
            {type !== "note" && (
              <button
                type="button"
                onClick={() => {
                  setShowPriorityPicker(!showPriorityPicker);
                  setShowDatePicker(false);
                  setShowAssigneePicker(false);
                  setShowEstimates(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-accent transition-colors ${
                  form.priority !== "none" ? "border-primary bg-primary/5 text-primary" : "border-input"
                }`}
              >
                <Flag className={`h-3.5 w-3.5 ${
                  form.priority === "high" ? "text-red-500 fill-red-500" :
                  form.priority === "medium" ? "text-amber-500 fill-amber-500" :
                  form.priority === "low" ? "text-blue-500 fill-blue-500" : "text-muted-foreground"
                }`} />
                <span>{form.priority === "high" ? "Alta" : form.priority === "medium" ? "Média" : form.priority === "low" ? "Baixa" : "Sem prioridade"}</span>
              </button>
            )}

            {/* Responsável Button */}
            {type !== "note" && (
              <button
                type="button"
                onClick={() => {
                  setShowAssigneePicker(!showAssigneePicker);
                  setShowDatePicker(false);
                  setShowPriorityPicker(false);
                  setShowEstimates(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-accent transition-colors ${
                  form.userId ? "border-primary bg-primary/5 text-primary" : "border-input"
                }`}
              >
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span>
                  {form.userId
                    ? users.find((u) => String(u.id) === form.userId)?.first_name || "Membro"
                    : "Responsável"}
                </span>
              </button>
            )}

            {/* Tipo (Reunião vs Tarefa vs Nota) Button */}
            <div className="flex bg-muted/50 rounded-md p-0.5 border border-input">
              <button
                type="button"
                onClick={() => setType("task")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  type === "task" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Flame className="h-3.5 w-3.5" />
                <span>Tarefa</span>
              </button>
              <button
                type="button"
                onClick={() => setType("meeting")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  type === "meeting" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Video className="h-3.5 w-3.5" />
                <span>Reunião</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setType("note");
                  setShowPriorityPicker(false);
                  setShowAssigneePicker(false);
                  setShowEstimates(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  type === "note" ? "bg-background text-amber-500 shadow-sm" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Nota</span>
              </button>
            </div>

            {/* Estimativa Button */}
            {type === "task" && (
              <button
                type="button"
                onClick={() => {
                  setShowEstimates(!showEstimates);
                  setShowDatePicker(false);
                  setShowPriorityPicker(false);
                  setShowAssigneePicker(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-accent transition-colors ${
                  form.estimatedTime || form.storyPoints ? "border-primary bg-primary/5 text-primary" : "border-input"
                }`}
              >
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{form.estimatedTime || form.storyPoints ? `${form.estimatedTime || "0h"} (${form.storyPoints || 0} SP)` : "Estimativas"}</span>
              </button>
            )}
          </div>

          {/* Seção Expansível de Prioridade */}
          {showPriorityPicker && (
            <div className="p-2 rounded-lg border bg-muted/20 flex flex-wrap gap-2 justify-center transition-all duration-200">
              {[
                { val: "none", label: "Sem prioridade", flagClass: "text-muted-foreground" },
                { val: "low", label: "Baixa", flagClass: "text-blue-500 fill-blue-500" },
                { val: "medium", label: "Média", flagClass: "text-amber-500 fill-amber-500" },
                { val: "high", label: "Alta", flagClass: "text-red-500 fill-red-500" },
              ].map((p) => (
                <button
                  key={p.val}
                  type="button"
                  onClick={() => {
                    setForm({ ...form, priority: p.val });
                    setShowPriorityPicker(false);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    form.priority === p.val
                      ? "border-primary bg-primary/10 scale-105"
                      : "border-input bg-transparent hover:bg-accent"
                  }`}
                >
                  <Flag className={`h-3 w-3 ${p.flagClass}`} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Seção Expansível de Responsável */}
          {showAssigneePicker && (
            <div className="p-2 rounded-lg border bg-muted/20 transition-all duration-200">
              <select
                value={form.userId}
                onChange={(e) => {
                  setForm({ ...form, userId: e.target.value });
                  setShowAssigneePicker(false);
                }}
                className="w-full bg-transparent border-0 outline-none text-xs focus:ring-0 cursor-pointer"
              >
                <option value="">Sem responsável</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name ?? ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Seção Expansível de Estimativas */}
          {showEstimates && (
            <div className="p-3 rounded-lg border bg-muted/20 space-y-3 transition-all duration-200">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Estimativa</span>
                  <Input placeholder="ex: 2h" value={form.estimatedTime} onChange={(e) => setForm({ ...form, estimatedTime: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Story Points</span>
                  <Input type="number" value={form.storyPoints} onChange={(e) => setForm({ ...form, storyPoints: e.target.value })} className="h-8 text-xs" />
                </div>
              </div>
            </div>
          )}

          {/* Divisor */}
          <div className="border-t border-border/80 my-3" />

          {/* Barra de Ações Inferior */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {/* Seletor Customizado do Todoist (Projetos / Etapas) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowProjectMenu(!showProjectMenu)}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-transparent text-xs font-semibold hover:bg-accent cursor-pointer transition-all"
                >
                  {selectedFunnelId ? (
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground font-semibold">#</span>
                      <span>{(() => {
                        const selectedFunnel = funnels.find(f => String(f.id) === selectedFunnelId);
                        return selectedFunnel ? displayNameForFunnel(selectedFunnel) : "";
                      })()}</span>
                      {selectedStageId && (
                        <>
                          <span className="text-muted-foreground font-semibold">/</span>
                          <span className="text-muted-foreground">{funnels.find(f => String(f.id) === selectedFunnelId)?.stages.find(s => String(s.id) === selectedStageId)?.name}</span>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Inbox className="h-3.5 w-3.5 text-primary" />
                      <span>Entrada</span>
                    </span>
                  )}
                  <span className="text-muted-foreground text-[10px]">▼</span>
                </button>

                {showProjectMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowProjectMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border bg-popover text-popover-foreground shadow-lg p-1.5 max-h-72 overflow-y-auto space-y-1">
                      <input
                        type="text"
                        placeholder="Digite o nome de um projeto"
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        className="w-full h-8 px-2 bg-muted/50 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary mb-1.5"
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />

                      {/* Opção Entrada */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFunnelId("");
                          setSelectedStageId("");
                          setShowProjectMenu(false);
                          setProjectSearch("");
                        }}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-accent hover:text-accent-foreground text-left"
                      >
                        <span className="flex items-center gap-1.5">
                          <Inbox className="h-3.5 w-3.5 text-primary" />
                          <span>Entrada</span>
                        </span>
                        {!selectedFunnelId && <span className="text-primary text-[10px]">✓</span>}
                      </button>

                      <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-t mt-1 pt-1.5">
                        Meus projetos
                      </div>

                      <div className="space-y-2.5">
                        {groupedFunnels.map((group) => (
                          <div key={group.funnels[0].project_id}>
                            {group.funnels.length > 1 && (
                              <div className="px-2 py-0.5 text-[10px] font-bold text-foreground/70 uppercase tracking-wider truncate">
                                {group.projectName}
                              </div>
                            )}
                            <div className="space-y-0.5">
                              {group.funnels.map((funnel) => {
                                const isSelected = selectedFunnelId === String(funnel.id);
                                return (
                                  <div key={funnel.id} className="space-y-0.5">
                                    {/* Projeto (ou funil, quando o projeto tem mais de um) */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedFunnelId(String(funnel.id));
                                        const firstStage = funnel.stages[0];
                                        setSelectedStageId(firstStage ? String(firstStage.id) : "");
                                        setShowProjectMenu(false);
                                        setProjectSearch("");
                                      }}
                                      className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-accent text-left font-medium ${
                                        isSelected && !selectedStageId ? "bg-accent" : ""
                                      }`}
                                    >
                                      <span className="flex items-center gap-1.5">
                                        <span className="text-muted-foreground font-semibold">#</span>
                                        <span className="truncate">{displayNameForFunnel(funnel)}</span>
                                      </span>
                                      {isSelected && !selectedStageId && <span className="text-primary text-[10px]">✓</span>}
                                    </button>

                                    {/* Etapa (Sub-item) */}
                                    {funnel.stages.map((stage) => {
                                      const isStageSelected = isSelected && selectedStageId === String(stage.id);
                                      return (
                                        <button
                                          key={stage.id}
                                          type="button"
                                          onClick={() => {
                                            setSelectedFunnelId(String(funnel.id));
                                            setSelectedStageId(String(stage.id));
                                            setShowProjectMenu(false);
                                            setProjectSearch("");
                                          }}
                                          className={`w-full flex items-center justify-between pl-6 pr-2 py-1 rounded text-[11px] hover:bg-accent text-left text-muted-foreground ${
                                            isStageSelected ? "bg-accent text-foreground font-semibold" : ""
                                          }`}
                                        >
                                          <span className="flex items-center gap-1.5">
                                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                                            <span className="truncate">{stage.name}</span>
                                          </span>
                                          {isStageSelected && <span className="text-primary text-[10px]">✓</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Seletor de Pasta (apenas para Entrada) */}
              {!selectedFunnelId && folders.length > 0 && (
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="h-8 px-2 rounded-md border border-input bg-transparent text-xs font-semibold hover:bg-accent cursor-pointer transition-all outline-none"
                >
                  <option value="">Sem Pasta</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Cancelar e Adicionar */}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" className="h-8 text-xs px-3" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting} className="h-8 text-xs px-3 bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-60">
                {isSubmitting ? "Salvando..." : type === "meeting" ? "Criar Reunião" : type === "note" ? "Adicionar Nota" : "Adicionar tarefa"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}