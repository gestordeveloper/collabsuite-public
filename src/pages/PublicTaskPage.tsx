import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  Rocket, Phone, ChevronDown, ChevronRight,
  AlertCircle, Calendar, Clock, User, Tag, CheckSquare, Paperclip,
  Check, FileDown, Loader2, BadgeCheck, Undo2
} from "lucide-react";
import { Switch } from "@/src/components/ui/switch";
import { Button } from "@/src/components/ui/button";
import type { Task } from "@/src/types";
import { SpreadsheetTemplate } from "@/src/components/task-templates/SpreadsheetTemplate";
import { FlowchartTemplate } from "@/src/components/task-templates/FlowchartTemplate";
import { WhiteboardTemplate } from "@/src/components/task-templates/WhiteboardTemplate";
import { DocumentContentViewer } from "@/src/components/editor/DocumentContentViewer";
import { exportTaskDocumentToPdf } from "@/src/lib/task-document-pdf-export";
import { formatMask } from "@/src/lib/utils";

const priorityConfig: Record<string, { label: string; color: string }> = {
  high:   { label: "Alta Prioridade",  color: "bg-red-500/15 text-red-500 border-red-500/30" },
  medium: { label: "Média Prioridade", color: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" },
  low:    { label: "Baixa Prioridade", color: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  none:   { label: "Sem Prioridade",   color: "bg-muted text-muted-foreground border-border" },
};

function fmt(dateStr?: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function PropRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 px-4 hover:bg-accent/50 rounded-lg transition-colors">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-[160px] text-sm text-muted-foreground">{label}</span>
      <div className="flex-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

export function PublicTaskPage() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProps, setShowProps] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [approving, setApproving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [otherEnabled, setOtherEnabled] = useState<Record<string, boolean>>({});

  const schema = (() => {
    if (!task?.form_schema) return null;
    try {
      const s = JSON.parse(task.form_schema);
      if (!s) return null;

      const layoutMode = s.layoutMode || "all_at_once";

      let sections = s.sections || [];
      if (sections.length === 0) {
        sections = [
          {
            id: "sec_default",
            title: "Seção 1",
            description: "",
            fields: s.fields || []
          }
        ];
      }

      return {
        ...s,
        sections,
        layoutMode,
        fields: s.fields || []
      };
    } catch {
      return null;
    }
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !schema || submitting) return;

    if (schema.layoutMode === "step_by_step") {
      const sections = schema.sections || [];
      const totalSteps = sections.length;
      const currentSection = sections[currentStep];
      if (currentSection) {
        const newErrors: Record<string, string> = {};
        currentSection.fields.forEach((f: any) => {
          if (f.required) {
            const val = values[f.id];
            if (val === undefined || val === null || val === "" || (f.type === "boolean" && val !== "true")) {
              newErrors[f.id] = "Este campo é obrigatório";
            }
          }
        });
        if (Object.keys(newErrors).length > 0) {
          setErrors(newErrors);
          return;
        }
      }

      if (currentStep < totalSteps - 1) {
        setErrors({});
        setCurrentStep((prev) => prev + 1);
        return;
      }
    }

    setSubmitting(true);

    const payload: Record<string, any> = {};
    const allFields = schema.sections.flatMap((s: any) => s.fields);
    allFields.forEach((f: any) => {
      if (values[f.id] !== undefined) {
        payload[f.id] = values[f.id];
      }
    });

    try {
      await fetch(`/api/public/form/${task.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSubmitted(true);
    } catch (err) {
      console.error("Submit error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function reloadTask() {
    const r = await fetch(`/api/public/task/${id}`);
    if (r.ok) setTask(await r.json());
  }

  async function handleApproval(approved: boolean) {
    if (!task || approving) return;
    setApproving(true);
    try {
      const r = await fetch(`/api/public/task/${task.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      if (!r.ok) throw new Error();
      await reloadTask();
    } catch {
      alert("Não foi possível registrar a aprovação. Tente novamente.");
    } finally {
      setApproving(false);
    }
  }

  const handleClientComment = useCallback(async (content: string, attachment?: { file?: File }) => {
    const form = new FormData();
    form.append("content", content);
    if (attachment?.file) form.append("file", attachment.file, attachment.file.name);
    const r = await fetch(`/api/public/task/${id}/comments`, { method: "POST", body: form });
    if (!r.ok) {
      const msg = (await r.json().catch(() => null))?.error;
      alert(msg || "Não foi possível enviar o comentário. Tente novamente.");
      throw new Error(msg || "comment failed");
    }
    await reloadTask();
  }, [id]);

  const handlePrevStep = () => {
    setErrors({});
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleValueChange = (fieldId: string, value: string) => {
    setValues((v) => ({ ...v, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[fieldId];
        return copy;
      });
    }
  };

  useEffect(() => {
    if (!id) return;
    fetch(`/api/public/task/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Tarefa não encontrada");
        return r.json();
      })
      .then((data: Task) => { setTask(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [id]);

  /* ── loading ── */
  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center gap-3 text-muted-foreground">
      <img src="/assets/images/logo.png" alt="Ebenezer" className="h-6 opacity-60 animate-pulse" />
      Carregando tarefa...
    </div>
  );

  /* ── error ── */
  if (error || !task) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-4">
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-8 max-w-sm w-full">
        <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-foreground mb-1">Tarefa não encontrada</h2>
        <p className="text-sm text-muted-foreground">{error ?? "Este link pode ter expirado ou a tarefa foi removida."}</p>
      </div>
    </div>
  );

  const priority = priorityConfig[task.priority ?? "none"];
  const hasPriority = !!task.priority && task.priority !== "none";
  const completedChecks = task.checklists?.filter((c) => c.is_done).length ?? 0;
  const totalChecks = task.checklists?.length ?? 0;
  const checkPct = totalChecks > 0 ? Math.round((completedChecks / totalChecks) * 100) : 0;
  const htmlContent = task.content || task.description || "";
  const hasProperties = !!(
    task.user ||
    hasPriority ||
    task.due_at ||
    task.end_at ||
    task.estimated_time ||
    task.story_points != null ||
    (task.taskUsers && task.taskUsers.length > 0)
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ── cover ── */}
      {task.cover && (
        <div className="h-52 w-full md:h-72 overflow-hidden">
          <img src={task.cover} alt="capa" className="h-full w-full object-cover" />
        </div>
      )}

      {/* ── body ── */}
      <main className={`mx-auto py-10 px-4 md:px-6 ${task.template === "spreadsheet" || task.template === "flowchart" || task.template === "whiteboard" ? "max-w-[95vw]" : "max-w-4xl"}`}>
        {task.template === "form" ? (
          submitted ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 animate-fade-in">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold font-display text-foreground">{schema?.successMessage ?? "Resposta enviada!"}</h2>
              <p className="text-sm text-muted-foreground max-w-sm text-center leading-relaxed">
                Obrigado pelo envio. Suas respostas foram salvas no sistema e vinculadas a esta tarefa.
              </p>
              <Button variant="outline" className="mt-2" onClick={() => { setSubmitted(false); setValues({}); setOtherEnabled({}); }}>
                Enviar outra resposta
              </Button>
            </div>
          ) : (
            <div className="space-y-6 animate-fade-in">
              {/* Form Title & Description */}
              <div>
                <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground leading-tight">
                  {schema?.title || task.title}
                </h1>
                {schema?.description && (
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {schema.description}
                  </p>
                )}
              </div>

              {/* Form body */}
              {(() => {
                if (!schema) return null;
                const sections = schema.sections || [];
                const totalSteps = sections.length;
                const isStepByStep = schema.layoutMode === "step_by_step" && totalSteps > 1;

                const renderField = (field: any) => {
                  const hasError = !!errors[field.id];
                  return (
                    <div key={field.id} className="space-y-2">
                      <label className="block text-sm font-medium text-foreground">
                        {field.label}
                        {field.required && <span className="ml-1 text-destructive">*</span>}
                      </label>

                      {field.type === "short_text" && (
                        <input
                          type="text"
                          placeholder={field.placeholder}
                          required={field.required}
                          value={values[field.id] ?? ""}
                          onChange={(e) => handleValueChange(field.id, formatMask(e.target.value, field.mask))}
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow bg-card ${
                            hasError 
                              ? "border-destructive focus:ring-destructive/30" 
                              : "border-input focus:ring-primary/40"
                          }`}
                        />
                      )}

                      {field.type === "long_text" && (
                        <textarea
                          placeholder={field.placeholder}
                          required={field.required}
                          value={values[field.id] ?? ""}
                          onChange={(e) => handleValueChange(field.id, e.target.value)}
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow min-h-[120px] resize-y bg-card ${
                            hasError 
                              ? "border-destructive focus:ring-destructive/30" 
                              : "border-input focus:ring-primary/40"
                          }`}
                        />
                      )}

                      {field.type === "number" && (
                        <input
                          type="number"
                          placeholder={field.placeholder}
                          required={field.required}
                          value={values[field.id] ?? ""}
                          onChange={(e) => handleValueChange(field.id, e.target.value)}
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow bg-card ${
                            hasError 
                              ? "border-destructive focus:ring-destructive/30" 
                              : "border-input focus:ring-primary/40"
                          }`}
                        />
                      )}

                      {field.type === "date" && (
                        <input
                          type="datetime-local"
                          required={field.required}
                          value={values[field.id] ?? ""}
                          onChange={(e) => handleValueChange(field.id, e.target.value)}
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow bg-card ${
                            hasError 
                              ? "border-destructive focus:ring-destructive/30" 
                              : "border-input focus:ring-primary/40"
                          }`}
                        />
                      )}

                      {field.type === "select" && (
                        <select
                          required={field.required}
                          value={values[field.id] ?? ""}
                          onChange={(e) => handleValueChange(field.id, e.target.value)}
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow text-foreground bg-card ${
                            hasError 
                              ? "border-destructive focus:ring-destructive/30" 
                              : "border-input focus:ring-primary/40"
                          }`}
                        >
                          <option value="" className="text-muted-foreground">Selecione uma opção...</option>
                          {(field.options ?? []).map((opt: string) => (
                            <option key={opt} value={opt} className="text-foreground">{opt}</option>
                          ))}
                        </select>
                      )}

                      {field.type === "boolean" && (
                        <div className="flex items-center gap-3 py-1">
                          <Switch
                            checked={values[field.id] === "true"}
                            onCheckedChange={(c) => handleValueChange(field.id, c ? "true" : "false")}
                          />
                          <span className="text-sm text-muted-foreground">
                            {values[field.id] === "true" ? "Sim" : "Não"}
                          </span>
                        </div>
                      )}

                      {field.type === "multiple_choice" && (() => {
                        const rawParts = values[field.id] ? values[field.id].split(", ") : [];
                        const knownOptions: string[] = field.options ?? [];
                        const selectedKnown = rawParts.filter((v) => knownOptions.includes(v));
                        const otherText = rawParts.find((v) => !knownOptions.includes(v)) ?? "";
                        const isOtherActive = field.allowOther && (otherEnabled[field.id] ?? otherText !== "");

                        const commit = (newSelectedKnown: string[], newOtherActive: boolean, newOtherText: string) => {
                          const parts = [...newSelectedKnown];
                          if (newOtherActive && newOtherText) parts.push(newOtherText);
                          handleValueChange(field.id, parts.join(", "));
                        };

                        return (
                          <div className="flex flex-col gap-2 mt-2">
                            {knownOptions.map((opt: string) => {
                              const isChecked = selectedKnown.includes(opt);
                              return (
                                <label key={opt} className="flex items-center gap-3 text-sm cursor-pointer group text-foreground">
                                  <div className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${isChecked ? "bg-primary border-primary text-white" : "bg-card border-input group-hover:border-primary/50"}`}>
                                    {isChecked && <Check className="h-3.5 w-3.5" />}
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    className="hidden"
                                    onChange={(e) => {
                                      const newSelectedKnown = e.target.checked
                                        ? [...selectedKnown, opt]
                                        : selectedKnown.filter((v) => v !== opt);
                                      commit(newSelectedKnown, !!isOtherActive, otherText);
                                    }}
                                  />
                                  {opt}
                                </label>
                              );
                            })}

                            {field.allowOther && (
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-3 text-sm cursor-pointer group text-foreground">
                                  <div className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${isOtherActive ? "bg-primary border-primary text-white" : "bg-card border-input group-hover:border-primary/50"}`}>
                                    {isOtherActive && <Check className="h-3.5 w-3.5" />}
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={!!isOtherActive}
                                    className="hidden"
                                    onChange={(e) => {
                                      setOtherEnabled((prev) => ({ ...prev, [field.id]: e.target.checked }));
                                      commit(selectedKnown, e.target.checked, otherText);
                                    }}
                                  />
                                  Outro
                                </label>
                                {isOtherActive && (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={otherText}
                                    onChange={(e) => commit(selectedKnown, true, e.target.value)}
                                    placeholder="Digite aqui..."
                                    className="flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40 transition-shadow"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {hasError && (
                        <p className="text-xs text-destructive mt-1 font-medium animate-fade-in">
                          {errors[field.id]}
                        </p>
                      )}
                    </div>
                  );
                };

                if (isStepByStep) {
                  const currentSection = sections[currentStep];
                  const progressPercent = Math.round(((currentStep + 1) / totalSteps) * 100);

                  return (
                    <form onSubmit={handleSubmit} className="space-y-6 mt-8">
                      {/* Progress Bar */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-xs font-semibold text-muted-foreground">
                          <span>Passo {currentStep + 1} de {totalSteps}</span>
                          <span>{progressPercent}% concluído</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all duration-300 ease-out" 
                            style={{ width: `${progressPercent}%` }} 
                          />
                        </div>
                      </div>

                      {/* Current Section Container */}
                      {currentSection && (
                        <div className="space-y-6 animate-fade-in">
                          <div className="border-b pb-4">
                            <h2 className="text-xl font-bold text-foreground font-display">
                              {currentSection.title || `Seção ${currentStep + 1}`}
                            </h2>
                            {currentSection.description && (
                              <p className="mt-2 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                {currentSection.description}
                              </p>
                            )}
                          </div>

                          <div className="space-y-5">
                            {currentSection.fields.length === 0 ? (
                              <p className="text-sm text-muted-foreground italic">Nenhum campo nesta seção.</p>
                            ) : (
                              currentSection.fields.map(renderField)
                            )}
                          </div>
                        </div>
                      )}

                      {/* Step Actions */}
                      <div className="flex justify-between items-center gap-3 pt-4 border-t">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handlePrevStep}
                          disabled={currentStep === 0}
                          className="flex-1 h-11 rounded-xl text-sm font-semibold"
                        >
                          Voltar
                        </Button>

                        {currentStep < totalSteps - 1 ? (
                          <Button
                            type="submit"
                            className="flex-1 h-11 rounded-xl text-sm font-semibold"
                          >
                            Avançar
                          </Button>
                        ) : (
                          <Button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 h-11 rounded-xl text-sm font-semibold text-primary-foreground animate-pulse"
                          >
                            {submitting ? "Enviando..." : (schema.submitLabel ?? "Enviar")}
                          </Button>
                        )}
                      </div>
                    </form>
                  );
                }

                // All at once
                return (
                  <form onSubmit={handleSubmit} className="space-y-8 mt-8">
                    {sections.map((section: any, secIdx: number) => (
                      <div key={section.id} className="space-y-6">
                        <div className="border-b pb-4">
                          <h2 className="text-lg font-bold text-foreground font-display">
                            {section.title || `Seção ${secIdx + 1}`}
                          </h2>
                          {section.description && (
                            <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                              {section.description}
                            </p>
                          )}
                        </div>

                        <div className="space-y-5">
                          {section.fields.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic">Nenhum campo nesta seção.</p>
                          ) : (
                            section.fields.map(renderField)
                          )}
                        </div>
                      </div>
                    ))}

                    <Button
                      type="submit"
                      disabled={submitting}
                      className="w-full h-11 rounded-xl font-semibold text-primary-foreground transition-all duration-200"
                    >
                      {submitting ? "Enviando..." : (schema.submitLabel ?? "Enviar")}
                    </Button>
                  </form>
                );
              })()}
            </div>
          )
        ) : task.template === "spreadsheet" ? (
          <div className="space-y-6 animate-fade-in">
            <SpreadsheetTemplate currentTask={task} readOnly={true} />
          </div>
        ) : task.template === "flowchart" ? (
          <div className="h-[80vh] min-h-[520px] w-full animate-fade-in overflow-hidden rounded-xl border">
            <FlowchartTemplate currentTask={task} readOnly={true} />
          </div>
        ) : task.template === "whiteboard" ? (
          <div className="h-[80vh] min-h-[520px] w-full animate-fade-in overflow-hidden rounded-xl border">
            <WhiteboardTemplate currentTask={task} readOnly={true} />
          </div>
        ) : (
          <>
            {/* title */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground leading-tight">
                {task.title}
              </h1>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
                disabled={exportingPdf}
                onClick={async () => {
                  setExportingPdf(true);
                  try {
                    await exportTaskDocumentToPdf(task);
                  } catch (err) {
                    console.error("Falha ao gerar PDF", err);
                    alert("Não foi possível gerar o PDF. Tente novamente.");
                  } finally {
                    setExportingPdf(false);
                  }
                }}
              >
                {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {exportingPdf ? "Gerando PDF..." : "Baixar PDF"}
              </Button>
            </div>

            {/* ── approval ── */}
            <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
              task.approved_at ? "border-emerald-500/30 bg-emerald-500/10" : "border-border bg-card"
            }`}>
              <div className="flex items-center gap-3">
                <BadgeCheck className={`h-6 w-6 ${task.approved_at ? "text-emerald-500" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {task.approved_at ? "Documento aprovado" : "Aguardando sua aprovação"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {task.approved_at
                      ? `Por ${task.approved_by ?? "Cliente"} em ${fmt(task.approved_at)}`
                      : "Revise o conteúdo abaixo e aprove quando estiver tudo certo."}
                  </p>
                </div>
              </div>
              {task.approved_at ? (
                <Button variant="outline" size="sm" className="gap-2" disabled={approving} onClick={() => handleApproval(false)}>
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  Desfazer aprovação
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={approving}
                  onClick={() => handleApproval(true)}
                >
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Aprovar
                </Button>
              )}
            </div>

            {/* badges */}
            <div className="mt-4 flex flex-wrap gap-2">
              {hasPriority && (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${priority.color}`}>
                  {priority.label}
                </span>
              )}
              {task.is_sprint && (
                <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-500">
                  <Rocket className="h-3 w-3" /> Sprint
                </span>
              )}
              {task.is_called && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-500">
                  <Phone className="h-3 w-3" /> Chamado
                </span>
              )}
              {task.is_whatsapp && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
                  WhatsApp
                </span>
              )}
            </div>

            {/* ── properties ── */}
            {hasProperties && (
              <div className="mt-6 rounded-xl border border-border/60 overflow-hidden">
                <button
                  onClick={() => setShowProps((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showProps ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {showProps ? "Ocultar propriedades" : "Mostrar propriedades"}
                </button>

                {showProps && (
                  <div className="border-t border-border/40 divide-y divide-border/30">
                    {task.user && (
                      <PropRow icon={<User className="h-4 w-4" />} label="Responsável">
                        <span>{task.user.first_name} {task.user.last_name ?? ""}</span>
                      </PropRow>
                    )}
                    {hasPriority && (
                      <PropRow icon={<Tag className="h-4 w-4" />} label="Prioridade">
                        <span>{priority.label}</span>
                      </PropRow>
                    )}
                    {task.due_at && (
                      <PropRow icon={<Calendar className="h-4 w-4" />} label="Prazo Inicial">
                        <span>{fmt(task.due_at)}</span>
                      </PropRow>
                    )}
                    {task.end_at && (
                      <PropRow icon={<Calendar className="h-4 w-4" />} label="Entrega">
                        <span>{fmt(task.end_at)}</span>
                      </PropRow>
                    )}
                    {task.estimated_time && (
                      <PropRow icon={<Clock className="h-4 w-4" />} label="Estimativa">
                        <span>{task.estimated_time}</span>
                      </PropRow>
                    )}
                    {task.story_points != null && (
                      <PropRow icon={<Tag className="h-4 w-4" />} label="Story Points">
                        <span>{task.story_points}</span>
                      </PropRow>
                    )}
                    {task.taskUsers && task.taskUsers.length > 0 && (
                      <PropRow icon={<User className="h-4 w-4" />} label="Membros">
                        <div className="flex flex-wrap gap-1.5">
                          {task.taskUsers.map((tu) => tu.user && (
                            <span key={tu.id} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                              {tu.user.first_name} {tu.user.last_name ?? ""}
                            </span>
                          ))}
                        </div>
                      </PropRow>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── content (TipTap read-only, same rendering as TaskDetailPage) ── */}
            {htmlContent && (
              <div className="mt-8">
                <DocumentContentViewer html={htmlContent} task={task} onAddComment={handleClientComment} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
