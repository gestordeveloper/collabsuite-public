import { useState, useCallback, useEffect } from "react";
import {
  Plus, Trash2, GripVertical, Settings2, Eye, Share2, Check,
  AlignLeft, Type, Hash, Calendar, ChevronDown, ChevronUp, ToggleLeft,
  Copy, ExternalLink, Sparkles, Download, Database, Inbox, Loader2,
  Image as ImageIcon, Camera, Link2, Eraser, ListChecks, PieChart as PieChartIcon,
  List as ListIcon
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, PieChart, Pie, Cell, Legend, Tooltip,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid
} from "recharts";
import type { Task } from "@/src/types";
import * as taskService from "@/src/services/task.service";
import * as uploadService from "@/src/services/upload.service";
import { useTaskStore } from "@/src/store/task.store";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { formatMask } from "@/src/lib/utils";

/* ─── Chart palette (categorical, fixed order) ─────────── */
const CHART_COLORS = [
  "#2a78d6", "#008300", "#e87ba4", "#eda100",
  "#1baf7a", "#eb6834", "#4a3aa7", "#e34948",
];

/* ─── Types ─────────────────────────────────────────────── */

export type FormFieldType = "short_text" | "long_text" | "number" | "date" | "select" | "boolean" | "multiple_choice";
export type FormFieldMask = "none" | "cpf_cnpj" | "phone" | "cep";

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[]; // for select
  taskField?: string; // maps to task property
  mask?: FormFieldMask;
  allowOther?: boolean; // for multiple_choice: adds an "Outro" free-text option
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
}

export interface FormSchema {
  title: string;
  description?: string;
  cover?: string;
  accentColor?: string;
  sections: FormSection[];
  fields: FormField[]; // kept flat for compatibility
  layoutMode: "all_at_once" | "step_by_step";
  submitLabel?: string;
  successMessage?: string;
}

/* ─── Constants ─────────────────────────────────────────── */

const FIELD_TYPES: { type: FormFieldType; label: string; icon: React.ElementType }[] = [
  { type: "short_text", label: "Texto curto", icon: Type },
  { type: "long_text", label: "Texto longo", icon: AlignLeft },
  { type: "number", label: "Número", icon: Hash },
  { type: "date", label: "Data", icon: Calendar },
  { type: "select", label: "Seleção", icon: ChevronDown },
  { type: "multiple_choice", label: "Múltipla escolha", icon: ListChecks },
  { type: "boolean", label: "Sim/Não", icon: ToggleLeft },
];

const TASK_FIELD_MAP: { value: string; label: string }[] = [
  { value: "title", label: "Título da tarefa" },
  { value: "description", label: "Descrição" },
  { value: "due_at", label: "Prazo" },
  { value: "priority", label: "Prioridade" },
  { value: "first_name", label: "Nome do solicitante" },
  { value: "last_name", label: "Sobrenome" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
];

const DEFAULT_SCHEMA: FormSchema = {
  title: "Formulário de Solicitação",
  description: "Preencha os campos abaixo para enviar sua solicitação.",
  sections: [
    {
      id: "sec_default",
      title: "Seção 1",
      description: "",
      fields: [
        { id: "f1", type: "short_text", label: "Nome completo", placeholder: "Seu nome", required: true, taskField: "first_name" },
        { id: "f2", type: "short_text", label: "E-mail", placeholder: "email@exemplo.com", required: true, taskField: "email" },
        { id: "f3", type: "long_text", label: "Descrição da solicitação", placeholder: "Descreva o que você precisa...", required: false, taskField: "description" },
        { id: "f4", type: "date", label: "Data desejada", required: false, taskField: "due_at" },
      ]
    }
  ],
  fields: [
    { id: "f1", type: "short_text", label: "Nome completo", placeholder: "Seu nome", required: true, taskField: "first_name" },
    { id: "f2", type: "short_text", label: "E-mail", placeholder: "email@exemplo.com", required: true, taskField: "email" },
    { id: "f3", type: "long_text", label: "Descrição da solicitação", placeholder: "Descreva o que você precisa...", required: false, taskField: "description" },
    { id: "f4", type: "date", label: "Data desejada", required: false, taskField: "due_at" },
  ],
  layoutMode: "all_at_once",
  submitLabel: "Enviar Solicitação",
  successMessage: "Sua solicitação foi enviada com sucesso! Entraremos em contato em breve.",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ─── FieldRow (builder) ────────────────────────────────── */

function FieldRow({
  field,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  sections = [],
  currentSectionId,
  onSectionChange,
}: {
  field: FormField;
  onChange: (f: FormField) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  sections?: { id: string; title: string }[];
  currentSectionId?: string;
  onSectionChange?: (secId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [localLabel, setLocalLabel] = useState(field.label);
  const [localPlaceholder, setLocalPlaceholder] = useState(field.placeholder ?? "");
  const [optionsText, setOptionsText] = useState((field.options ?? []).join("\n"));

  useEffect(() => {
    setLocalLabel(field.label);
  }, [field.label]);

  useEffect(() => {
    setLocalPlaceholder(field.placeholder ?? "");
  }, [field.placeholder]);

  useEffect(() => {
    setOptionsText((field.options ?? []).join("\n"));
  }, [field.options]);

  const TypeIcon = FIELD_TYPES.find((t) => t.type === field.type)?.icon ?? Type;

  return (
    <div className="rounded-xl border bg-card transition-shadow hover:shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 flex-wrap sm:flex-nowrap">
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab flex-shrink-0" />
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary flex-shrink-0">
          <TypeIcon className="h-3.5 w-3.5" />
        </div>
        <input
          className="flex-1 min-w-[120px] bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
          value={localLabel}
          onChange={(e) => setLocalLabel(e.target.value)}
          onBlur={() => onChange({ ...field, label: localLabel })}
          placeholder="Rótulo do campo"
        />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs text-muted-foreground">
            {FIELD_TYPES.find((t) => t.type === field.type)?.label}
          </span>
          {field.required && (
            <span className="text-[10px] text-destructive font-bold">*</span>
          )}
          {onMoveUp && (
            <button
              onClick={onMoveUp}
              className="p-1 rounded hover:bg-accent"
              title="Mover para cima"
            >
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          {onMoveDown && (
            <button
              onClick={onMoveDown}
              className="p-1 rounded hover:bg-accent"
              title="Mover para baixo"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-accent"
            title="Configurações do campo"
          >
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-destructive/10 text-destructive"
            title="Remover campo"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo de campo</Label>
              <select
                value={field.type}
                onChange={(e) => onChange({ ...field, type: e.target.value as FormFieldType })}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Salvar em</Label>
              <select
                value={field.taskField ?? ""}
                onChange={(e) => onChange({ ...field, taskField: e.target.value || undefined })}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">(não salvar)</option>
                {TASK_FIELD_MAP.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>

          {sections.length > 1 && onSectionChange && currentSectionId && (
            <div>
              <Label className="text-xs">Seção</Label>
              <select
                value={currentSectionId}
                onChange={(e) => onSectionChange(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              >
                {sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.title || `Seção sem título (${sec.id.slice(0, 4)})`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {field.type !== "boolean" && field.type !== "select" && (
            <div>
              <Label className="text-xs">Placeholder</Label>
              <Input
                value={localPlaceholder}
                onChange={(e) => setLocalPlaceholder(e.target.value)}
                onBlur={() => onChange({ ...field, placeholder: localPlaceholder })}
                className="mt-1 h-8 text-xs"
                placeholder="Texto de exemplo..."
              />
            </div>
          )}

          {field.type === "short_text" && (
            <div>
              <Label className="text-xs">Máscara do campo</Label>
              <select
                value={field.mask ?? "none"}
                onChange={(e) => onChange({ ...field, mask: e.target.value as FormFieldMask })}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="none">Sem máscara</option>
                <option value="cpf_cnpj">CPF / CNPJ</option>
                <option value="phone">Telefone</option>
                <option value="cep">CEP</option>
              </select>
            </div>
          )}

          {(field.type === "select" || field.type === "multiple_choice") && (
            <div>
              <Label className="text-xs">Opções (uma por linha)</Label>
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                onBlur={() => onChange({ ...field, options: optionsText.split("\n").filter(Boolean) })}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
                placeholder="Opção 1&#10;Opção 2&#10;Opção 3"
              />
            </div>
          )}

          {field.type === "multiple_choice" && (
            <div className="flex items-center gap-2">
              <Switch
                checked={!!field.allowOther}
                onCheckedChange={(c) => onChange({ ...field, allowOther: c })}
              />
              <Label className="text-xs">Adicionar opção "Outro" (texto livre)</Label>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              checked={!!field.required}
              onCheckedChange={(c) => onChange({ ...field, required: c })}
            />
            <Label className="text-xs">Campo obrigatório</Label>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── SectionHeader (builder) ───────────────────────────── */

function SectionHeader({
  section,
  secIdx,
  onUpdate,
}: {
  section: FormSection;
  secIdx: number;
  onUpdate: (patch: Partial<FormSection>) => void;
}) {
  const [localTitle, setLocalTitle] = useState(section.title);
  const [localDescription, setLocalDescription] = useState(section.description ?? "");

  useEffect(() => {
    setLocalTitle(section.title);
  }, [section.title]);

  useEffect(() => {
    setLocalDescription(section.description ?? "");
  }, [section.description]);

  return (
    <div className="flex-1 space-y-2">
      <input
        className="w-full bg-transparent text-lg font-bold outline-none placeholder:text-muted-foreground font-display"
        value={localTitle}
        onChange={(e) => setLocalTitle(e.target.value)}
        onBlur={() => onUpdate({ title: localTitle })}
        placeholder={`Título da Seção ${secIdx + 1}`}
      />
      <textarea
        className="w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60 resize-none h-6 focus:h-12 transition-all"
        value={localDescription}
        onChange={(e) => setLocalDescription(e.target.value)}
        onBlur={() => onUpdate({ description: localDescription })}
        placeholder="Descrição opcional para esta seção..."
      />
    </div>
  );
}

/* ─── FormPreview ───────────────────────────────────────── */

function FormPreview({ schema, taskId }: { schema: FormSchema; taskId: number }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [otherEnabled, setOtherEnabled] = useState<Record<string, boolean>>({});
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (schema.layoutMode === "step_by_step") {
      const sections = schema.sections || [];
      const totalSteps = sections.length;
      const currentSection = sections[currentStep];
      if (currentSection) {
        const newErrors: Record<string, string> = {};
        currentSection.fields.forEach(f => {
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
    const allFields = schema.sections.flatMap((s) => s.fields);
    allFields.forEach((f) => {
      if (f.taskField && values[f.id] !== undefined) {
        payload[f.taskField] = values[f.id];
      }
    });
    const updated = await taskService.updateTask(taskId, payload);
    updateTaskInState(updated);
    setSubmitting(false);
    setSubmitted(true);
  }

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

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
          <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold font-display">{schema.successMessage ?? "Enviado!"}</h2>
        <Button variant="outline" onClick={() => { setSubmitted(false); setValues({}); setCurrentStep(0); setErrors({}); setOtherEnabled({}); }}>
          Enviar outra resposta
        </Button>
      </div>
    );
  }

  const sections = schema.sections || [];
  const totalSteps = sections.length;
  const isStepByStep = schema.layoutMode === "step_by_step" && totalSteps > 1;

  const renderField = (field: FormField) => {
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
            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow bg-card ${hasError
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
            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow min-h-[120px] resize-y bg-card ${hasError
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
            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow bg-card ${hasError
              ? "border-destructive focus:ring-destructive/30"
              : "border-input focus:ring-primary/40"
              }`}
          />
        )}

        {field.type === "date" && (
          <input
            type="date"
            required={field.required}
            value={values[field.id] ?? ""}
            onChange={(e) => handleValueChange(field.id, e.target.value)}
            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow bg-card ${hasError
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
            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow text-foreground bg-card ${hasError
              ? "border-destructive focus:ring-destructive/30"
              : "border-input focus:ring-primary/40"
              }`}
          >
            <option value="" className="text-muted-foreground">Selecione uma opção...</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt} className="text-foreground">{opt}</option>
            ))}
          </select>
        )}

        {field.type === "multiple_choice" && (() => {
          const rawParts = values[field.id] ? values[field.id].split(", ") : [];
          const knownOptions = field.options ?? [];
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
              {knownOptions.map((opt) => {
                const isChecked = selectedKnown.includes(opt);
                return (
                  <label key={opt} className="flex items-center gap-3 text-sm text-foreground cursor-pointer group">
                    <div className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${isChecked ? "bg-primary border-primary text-primary-foreground" : "border-input bg-card group-hover:border-primary/50"}`}>
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
                  <label className="flex items-center gap-3 text-sm text-foreground cursor-pointer group">
                    <div className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${isOtherActive ? "bg-primary border-primary text-primary-foreground" : "border-input bg-card group-hover:border-primary/50"}`}>
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
      <form onSubmit={handleSubmit} className="space-y-6">
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

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {sections.map((section, secIdx) => (
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
}

/* ─── Response charts (Google-Forms-style summary) ─────── */

const CHARTABLE_TYPES: FormFieldType[] = ["select", "multiple_choice", "boolean"];

function computeFieldDistribution(field: FormField, responsesList: any[]) {
  const counts: Record<string, number> = {};
  let answered = 0;

  responsesList.forEach((res) => {
    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(res.answers);
    } catch (e) { }

    const raw = parsed[field.id];
    if (raw === undefined || raw === null || raw === "") return;
    answered++;

    if (field.type === "multiple_choice") {
      const knownOptions = field.options ?? [];
      String(raw).split(", ").filter(Boolean).forEach((v) => {
        const key = knownOptions.includes(v) ? v : "Outro";
        counts[key] = (counts[key] ?? 0) + 1;
      });
    } else if (field.type === "boolean") {
      const key = (raw === true || raw === "true") ? "Sim" : "Não";
      counts[key] = (counts[key] ?? 0) + 1;
    } else {
      const key = String(raw);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  });

  let orderedKeys: string[];
  if (field.type === "boolean") {
    orderedKeys = ["Sim", "Não"];
  } else {
    const known = field.options ?? [];
    const extra = Object.keys(counts).filter((k) => !known.includes(k));
    orderedKeys = [...known, ...extra];
  }

  const data = orderedKeys
    .map((name) => ({ name, value: counts[name] ?? 0 }))
    .filter((d) => d.value > 0);

  return { data, answered };
}

function FieldResponseChart({ field, responsesList }: { field: FormField; responsesList: any[] }) {
  const { data, answered } = computeFieldDistribution(field, responsesList);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border bg-card shadow-sm p-5">
        <p className="text-sm font-semibold text-foreground">{field.label}</p>
        <p className="mt-6 mb-6 text-center text-xs text-muted-foreground">Nenhuma resposta ainda para esta pergunta.</p>
      </div>
    );
  }

  const isBarChart = field.type === "multiple_choice";

  return (
    <div className="rounded-xl border bg-card shadow-sm p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm font-semibold text-foreground">{field.label}</p>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
          {isBarChart ? <ListIcon className="h-3 w-3" /> : <PieChartIcon className="h-3 w-3" />}
          {answered} {answered === 1 ? "resposta" : "respostas"}
        </span>
      </div>
      <div className={isBarChart ? "h-[220px] mt-3" : "h-[240px] mt-1"}>
        <ResponsiveContainer width="100%" height="100%">
          {isBarChart ? (
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}`, "Respostas"]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}`, "Respostas"]} />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── Main Component ────────────────────────────────────── */

interface FormTemplateProps {
  task: Task;
  onSave: (field: string, value: any) => void;
}

export function FormTemplate({ task, onSave }: FormTemplateProps) {
  const [mode, setMode] = useState<"build" | "preview" | "responses">("build");
  const [copied, setCopied] = useState(false);
  const [responses, setResponses] = useState<any[]>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [responsesView, setResponsesView] = useState<"summary" | "individual">("summary");
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [showCoverUrlInput, setUrlVisible] = useState(false);

  const handleCoverUpload = useCallback(async (file: File) => {
    try {
      const url = await uploadService.uploadImage(file);
      onSave("cover", url);
      setShowCoverMenu(false);
    } catch (err) {
      console.error("Cover upload failed", err);
    }
  }, [onSave]);

  const responsesList = Array.isArray(responses) ? responses : [];

  useEffect(() => {
    taskService.fetchFormResponses(task.id)
      .then(setResponses)
      .catch(() => { });
  }, [task.id]);

  useEffect(() => {
    if (mode === "responses") {
      setLoadingResponses(true);
      taskService.fetchFormResponses(task.id)
        .then((data) => {
          setResponses(data);
          setLoadingResponses(false);
        })
        .catch(() => setLoadingResponses(false));
    }
  }, [mode, task.id]);

  const parseSchema = useCallback((): FormSchema => {
    try {
      const s = task.form_schema ? JSON.parse(task.form_schema as string) : null;
      if (!s) return { ...DEFAULT_SCHEMA, title: task.title };

      const layoutMode = s.layoutMode || "all_at_once";

      let sections: FormSection[] = s.sections || [];
      if (sections.length === 0) {
        sections = [
          {
            id: "sec_default",
            title: "Seção Principal",
            description: "",
            fields: s.fields || []
          }
        ];
      }

      return {
        ...s,
        title: s.title || task.title,
        sections,
        layoutMode,
        fields: s.fields || []
      };
    } catch {
      return { ...DEFAULT_SCHEMA, title: task.title };
    }
  }, [task.form_schema, task.title]);

  const [schema, setSchema] = useState<FormSchema>(parseSchema);

  useEffect(() => {
    setSchema(parseSchema());
  }, [task.form_schema, parseSchema]);

  const saveSchema = useCallback((s: FormSchema) => {
    const flatFields = (s.sections || []).flatMap((sec) => sec.fields || []);
    const updatedSchema = {
      ...s,
      fields: flatFields
    };
    setSchema(updatedSchema);
    onSave("form_schema", JSON.stringify(updatedSchema));
  }, [onSave]);

  function exportToXLSX() {
    if (responsesList.length === 0) return;

    const headers = ["Data de Envio", ...schema.fields.map((f) => f.label)];

    const rows = responsesList.map((res) => {
      let parsedAnswers: Record<string, any> = {};
      try {
        parsedAnswers = JSON.parse(res.answers);
      } catch (e) { }

      return [
        new Date(res.created_at).toLocaleString("pt-BR"),
        ...schema.fields.map((f) => {
          const answer = parsedAnswers[f.id];
          if (answer === undefined || answer === null || answer === "") return "";
          if (typeof answer === "boolean" || answer === "true" || answer === "false") {
            return (answer === true || answer === "true") ? "Sim" : "N\u00E3o";
          }
          return String(answer);
        })
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet["!cols"] = headers.map((h) => ({ wch: Math.max(15, h.length + 2) }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
    XLSX.writeFile(workbook, `respostas_formulario_${task.id}.xlsx`);
  }

  function addSection() {
    const newSection: FormSection = {
      id: uid(),
      title: `Nova Seção ${schema.sections.length + 1}`,
      description: "",
      fields: []
    };
    saveSchema({
      ...schema,
      sections: [...schema.sections, newSection]
    });
  }

  function updateSection(sectionId: string, updated: Partial<FormSection>) {
    saveSchema({
      ...schema,
      sections: schema.sections.map((sec) =>
        sec.id === sectionId ? { ...sec, ...updated } : sec
      )
    });
  }

  function removeSection(sectionId: string) {
    if (schema.sections.length <= 1) return;
    const secToRemove = schema.sections.find((s) => s.id === sectionId);
    const remaining = schema.sections.filter((s) => s.id !== sectionId);

    if (secToRemove && secToRemove.fields.length > 0) {
      remaining[0].fields = [...remaining[0].fields, ...secToRemove.fields];
    }

    saveSchema({
      ...schema,
      sections: remaining
    });
  }

  function moveSection(sectionId: string, direction: "up" | "down") {
    const idx = schema.sections.findIndex((s) => s.id === sectionId);
    if (idx === -1) return;

    const newSections = [...schema.sections];
    if (direction === "up" && idx > 0) {
      [newSections[idx], newSections[idx - 1]] = [newSections[idx - 1], newSections[idx]];
    } else if (direction === "down" && idx < newSections.length - 1) {
      [newSections[idx], newSections[idx + 1]] = [newSections[idx + 1], newSections[idx]];
    }

    saveSchema({
      ...schema,
      sections: newSections
    });
  }

  function addField(type: FormFieldType, sectionId: string) {
    const newField: FormField = {
      id: uid(),
      type,
      label: FIELD_TYPES.find((t) => t.type === type)?.label ?? "Campo",
      placeholder: "Digite aqui...",
      required: false,
    };
    saveSchema({
      ...schema,
      sections: schema.sections.map((sec) =>
        sec.id === sectionId ? { ...sec, fields: [...sec.fields, newField] } : sec
      )
    });
  }

  function updateField(fieldId: string, updated: FormField) {
    saveSchema({
      ...schema,
      sections: schema.sections.map((sec) => ({
        ...sec,
        fields: sec.fields.map((f) => (f.id === fieldId ? updated : f))
      }))
    });
  }

  function removeField(fieldId: string) {
    saveSchema({
      ...schema,
      sections: schema.sections.map((sec) => ({
        ...sec,
        fields: sec.fields.filter((f) => f.id !== fieldId)
      }))
    });
  }

  function moveField(fieldId: string, direction: "up" | "down") {
    saveSchema({
      ...schema,
      sections: schema.sections.map((sec) => {
        const idx = sec.fields.findIndex((f) => f.id === fieldId);
        if (idx === -1) return sec;

        const newFields = [...sec.fields];
        if (direction === "up" && idx > 0) {
          [newFields[idx], newFields[idx - 1]] = [newFields[idx - 1], newFields[idx]];
        } else if (direction === "down" && idx < newFields.length - 1) {
          [newFields[idx], newFields[idx + 1]] = [newFields[idx + 1], newFields[idx]];
        }
        return { ...sec, fields: newFields };
      })
    });
  }

  function changeFieldSection(fieldId: string, targetSectionId: string) {
    let fieldToMove: FormField | null = null;

    const sectionsWithoutField = schema.sections.map((sec) => {
      const found = sec.fields.find((f) => f.id === fieldId);
      if (found) {
        fieldToMove = found;
      }
      return {
        ...sec,
        fields: sec.fields.filter((f) => f.id !== fieldId)
      };
    });

    if (!fieldToMove) return;

    const updatedSections = sectionsWithoutField.map((sec) => {
      if (sec.id === targetSectionId) {
        return {
          ...sec,
          fields: [...sec.fields, fieldToMove!]
        };
      }
      return sec;
    });

    saveSchema({
      ...schema,
      sections: updatedSections
    });
  }

  const publicUrl = `${window.location.origin}/public/task/${task.id}`;

  function copyLink() {
    navigator.clipboard.writeText(publicUrl).catch(() => { });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 flex flex-col sm:flex-row items-center justify-between gap-3 border-b bg-background/95 px-4 sm:px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-1 rounded-lg border p-0.5 w-full sm:w-auto justify-center overflow-x-auto">
          <button
            onClick={() => setMode("build")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === "build" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
              }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Construtor
          </button>
          <button
            onClick={() => setMode("preview")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === "preview" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
              }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Visualizar
          </button>
          <button
            onClick={() => setMode("responses")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === "responses" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
              }`}
          >
            <Database className="h-3.5 w-3.5" />
            Respostas ({responsesList.length})
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-8 flex-1 sm:flex-none"
            onClick={copyLink}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado!" : "Copiar link público"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs h-8"
            onClick={() => window.open(publicUrl, "_blank")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir
          </Button>
        </div>
      </div>

      <div className="relative group border-b">
        {task.cover ? (
          <div className="relative h-40 w-full md:h-64 animate-fade-in">
            <img src={task.cover} alt="cover" className="h-full w-full object-cover" />
            <Button
              variant="secondary"
              size="sm"
              className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              onClick={() => setShowCoverMenu((v) => !v)}
            >
              Alterar capa
            </Button>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center transition-colors hover:bg-muted/30">
            <Button
              variant="ghost"
              className="gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowCoverMenu((v) => !v)}
            >
              <ImageIcon className="h-4 w-4" /> Adicionar capa de fundo
            </Button>
          </div>
        )}
        {showCoverMenu && (
          <div className="absolute right-6 top-2 z-20 w-72 rounded-lg border bg-popover p-2 shadow-md space-y-1">
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent text-foreground">
              <Camera className="h-4 w-4 text-muted-foreground" /> Enviar imagem do computador
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleCoverUpload(e.target.files[0])}
              />
            </label>
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent text-foreground text-left"
              onClick={() => setUrlVisible((v) => !v)}
            >
              <Link2 className="h-4 w-4 text-muted-foreground" /> Inserir link da imagem
            </button>
            {showCoverUrlInput && (
              <div className="flex gap-1 px-2 py-1">
                <Input
                  value={coverUrlInput}
                  onChange={(e) => setCoverUrlInput(e.target.value)}
                  placeholder="https://..."
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    onSave("cover", coverUrlInput);
                    setCoverUrlInput("");
                    setShowCoverMenu(false);
                  }}
                >
                  Ok
                </Button>
              </div>
            )}
            {task.cover && (
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 text-left"
                onClick={() => {
                  onSave("cover", null);
                  setShowCoverMenu(false);
                }}
              >
                <Eraser className="h-4 w-4" /> Remover imagem de capa
              </button>
            )}
          </div>
        )}
      </div>

      <div className={`mx-auto px-4 py-8 md:px-6 transition-all duration-300 ${mode === "responses" ? "max-w-[95%] lg:max-w-[92%]" : "max-w-3xl"}`}>
        {mode === "build" ? (
          <div className="space-y-6">
            <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-primary/10 p-6 space-y-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Configurações do Formulário
              </h2>
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Título do Formulário</Label>
                    <Input
                      value={schema.title}
                      onChange={(e) => setSchema((s) => ({ ...s, title: e.target.value }))}
                      onBlur={() => saveSchema(schema)}
                      className="mt-1"
                      placeholder="Nome do formulário"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Modo de Apresentação das Seções</Label>
                    <select
                      value={schema.layoutMode ?? "all_at_once"}
                      onChange={(e) => saveSchema({ ...schema, layoutMode: e.target.value as "all_at_once" | "step_by_step" })}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 transition-shadow h-10"
                    >
                      <option value="all_at_once">Mostrar todas as seções de uma vez (Scroll)</option>
                      <option value="step_by_step">Passo a passo (uma seção por página)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Descrição / Instruções</Label>
                  <textarea
                    value={schema.description ?? ""}
                    onChange={(e) => setSchema((s) => ({ ...s, description: e.target.value }))}
                    onBlur={() => saveSchema(schema)}
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 transition-shadow min-h-[70px] resize-y"
                    placeholder="Instruções para os respondentes..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Texto do botão de envio</Label>
                    <Input
                      value={schema.submitLabel ?? "Enviar"}
                      onChange={(e) => setSchema((s) => ({ ...s, submitLabel: e.target.value }))}
                      onBlur={() => saveSchema(schema)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Mensagem de sucesso</Label>
                    <Input
                      value={schema.successMessage ?? ""}
                      onChange={(e) => setSchema((s) => ({ ...s, successMessage: e.target.value }))}
                      onBlur={() => saveSchema(schema)}
                      className="mt-1"
                      placeholder="Obrigado por sua resposta!"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-foreground font-display">Seções do Formulário</h2>
                <span className="text-xs text-muted-foreground">
                  {schema.sections.length} seções · {schema.sections.flatMap(s => s.fields).length} campos
                </span>
              </div>

              {schema.sections.map((section, secIdx) => {
                const sectionList = schema.sections.map(s => ({ id: s.id, title: s.title }));
                return (
                  <div
                    key={section.id}
                    className="group border border-border bg-card/60 dark:bg-card/30 backdrop-blur-sm rounded-2xl p-5 shadow-sm space-y-4 hover:shadow-md transition-all relative overflow-hidden"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-primary/80 to-purple-500/80" />

                    <div className="flex items-start justify-between gap-4 pl-2">
                      <SectionHeader
                        section={section}
                        secIdx={secIdx}
                        onUpdate={(patch) => updateSection(section.id, patch)}
                      />

                      <div className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => moveSection(section.id, "up")}
                          disabled={secIdx === 0}
                          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-40"
                          title="Mover seção para cima"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => moveSection(section.id, "down")}
                          disabled={secIdx === schema.sections.length - 1}
                          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-40"
                          title="Mover seção para baixo"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        {schema.sections.length > 1 && (
                          <button
                            onClick={() => removeSection(section.id)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"
                            title="Remover seção (campos serão movidos para a primeira seção)"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 pl-2 border-t pt-4">
                      {section.fields.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-8 text-muted-foreground/60 bg-muted/20">
                          <p className="text-xs">Esta seção está vazia. Adicione campos abaixo.</p>
                        </div>
                      ) : (
                        section.fields.map((field, fieldIdx) => (
                          <FieldRow
                            key={field.id}
                            field={field}
                            onChange={(updated) => updateField(field.id, updated)}
                            onDelete={() => removeField(field.id)}
                            onMoveUp={fieldIdx > 0 ? () => moveField(field.id, "up") : undefined}
                            onMoveDown={fieldIdx < section.fields.length - 1 ? () => moveField(field.id, "down") : undefined}
                            sections={sectionList}
                            currentSectionId={section.id}
                            onSectionChange={(targetSecId) => changeFieldSection(field.id, targetSecId)}
                          />
                        ))
                      )}
                    </div>

                    <div className="pl-2 border-t pt-4">
                      <p className="mb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Adicionar campo nesta seção
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {FIELD_TYPES.map((ft) => {
                          const Icon = ft.icon;
                          return (
                            <button
                              key={ft.type}
                              onClick={() => addField(ft.type, section.id)}
                              className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-accent hover:border-primary/50"
                            >
                              <Icon className="h-3 w-3 text-primary" />
                              {ft.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}

              <Button
                variant="outline"
                className="w-full border-dashed h-12 gap-2 text-muted-foreground hover:text-foreground"
                onClick={addSection}
              >
                <Plus className="h-4 w-4 text-primary" />
                Adicionar Nova Seção
              </Button>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Share2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Link público</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Compartilhe este link com clients ou usuários externos. Não é necessário login.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-background border px-3 py-1.5 text-xs font-mono text-muted-foreground truncate">
                  {publicUrl}
                </code>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs flex-shrink-0" onClick={copyLink}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado!" : "Copiar"}
                </Button>
              </div>
            </div>
          </div>
        ) : mode === "preview" ? (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground leading-tight">
                {schema.title}
              </h1>
              {schema.description && (
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {schema.description}
                </p>
              )}
            </div>
            <div className="mt-8">
              <FormPreview schema={schema} taskId={task.id} />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold font-display">Respostas Coletadas</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {responsesList.length} envios registrados para este formulário
                </p>
              </div>
              <div className="flex items-center gap-2">
                {responsesList.length > 0 && (
                  <div className="flex items-center rounded-lg bg-muted/50 p-1">
                    <button
                      type="button"
                      onClick={() => setResponsesView("summary")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${responsesView === "summary" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"}`}
                    >
                      <PieChartIcon className="h-3.5 w-3.5" />
                      Resumo
                    </button>
                    <button
                      type="button"
                      onClick={() => setResponsesView("individual")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${responsesView === "individual" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"}`}
                    >
                      <ListIcon className="h-3.5 w-3.5" />
                      Individual
                    </button>
                  </div>
                )}
                {responsesList.length > 0 && (
                  <Button onClick={exportToXLSX} className="gap-1.5 text-xs h-8">
                    <Download className="h-3.5 w-3.5" />
                    Exportar Planilha (XLSX)
                  </Button>
                )}
              </div>
            </div>

            {loadingResponses ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Carregando respostas...</p>
              </div>
            ) : responsesList.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-muted-foreground bg-card">
                <Inbox className="h-10 w-10 mb-3 opacity-40 text-primary animate-pulse" />
                <p className="text-sm font-medium">Nenhuma resposta recebida ainda</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm text-center px-4">
                  Compartilhe o link do formulário com seus clientes para começar a coletar informações.
                </p>
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={copyLink}>
                  <Share2 className="h-3.5 w-3.5" />
                  Copiar Link Público
                </Button>
              </div>
            ) : responsesView === "summary" ? (
              schema.fields.filter((f) => CHARTABLE_TYPES.includes(f.type)).length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-16 text-muted-foreground bg-card">
                  <PieChartIcon className="h-10 w-10 mb-3 opacity-40 text-primary" />
                  <p className="text-sm font-medium">Nenhuma pergunta de múltipla escolha, seleção ou sim/não</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm text-center px-4">
                    Gráficos são gerados para perguntas de seleção, múltipla escolha e sim/não. Veja a aba "Individual" para o restante das respostas.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {schema.fields
                    .filter((f) => CHARTABLE_TYPES.includes(f.type))
                    .map((f) => (
                      <FieldResponseChart key={f.id} field={f} responsesList={responsesList} />
                    ))}
                </div>
              )
            ) : (
              <div className="rounded-xl border bg-card shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase">
                      <th className="px-4 py-3 text-left min-w-[150px]">Data de Envio</th>
                      {schema.fields.map((f) => (
                        <th key={f.id} className="px-4 py-3 text-left min-w-[120px]">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {responsesList.map((res) => {
                      let parsedAnswers: Record<string, any> = {};
                      try {
                        parsedAnswers = JSON.parse(res.answers);
                      } catch (e) { }

                      return (
                        <tr key={res.id} className="border-b last:border-b-0 hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {new Date(res.created_at).toLocaleString("pt-BR")}
                          </td>
                          {schema.fields.map((f) => {
                            const val = parsedAnswers[f.id];
                            return (
                              <td key={f.id} className="px-4 py-3 text-xs text-foreground max-w-[200px] truncate">
                                {val === undefined || val === "" ? (
                                  <span className="text-muted-foreground/40">—</span>
                                ) : typeof val === "boolean" || val === "true" || val === "false" ? (
                                  val === true || val === "true" ? "Sim" : "Não"
                                ) : (
                                  String(val)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
