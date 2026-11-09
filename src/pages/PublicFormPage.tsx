import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Switch } from "@/src/components/ui/switch";
import { formatMask } from "@/src/lib/utils";

/* ─── Types (inline, no auth needed) ─── */

interface FormField {
  id: string;
  type: "short_text" | "long_text" | "number" | "date" | "select" | "boolean" | "multiple_choice";
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  taskField?: string;
  mask?: "none" | "cpf_cnpj" | "phone" | "cep";
}

interface FormSection {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
}

interface FormSchema {
  title: string;
  description?: string;
  sections: FormSection[];
  fields: FormField[];
  layoutMode: "all_at_once" | "step_by_step";
  submitLabel?: string;
  successMessage?: string;
}

interface PublicTask {
  id: number;
  title: string;
  form_schema?: string | null;
}

/* ─── Component ─── */

export function PublicFormPage() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<PublicTask | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    fetch(`/api/public/task/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Formulário não encontrado");
        return r.json();
      })
      .then((data: PublicTask) => {
        setTask(data);
        if (data.form_schema) {
          try {
            const s = JSON.parse(data.form_schema);
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
            setSchema({
              ...s,
              sections,
              layoutMode,
              fields: s.fields || []
            });
          } catch {
            setSchema(null);
          }
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !schema) return;

    if (schema.layoutMode === "step_by_step") {
      const sections = schema.sections || [];
      const totalSteps = sections.length;
      const currentSection = sections[currentStep];
      if (currentSection) {
        const newErrors: Record<string, string> = {};
        currentSection.fields.forEach((f) => {
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
    } catch (e) {
      console.error("Submit error:", e);
    } finally {
      setSubmitting(false);
    }
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

  /* Loading */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Carregando formulário...</p>
        </div>
      </div>
    );
  }

  /* Error */
  if (error || !task || !schema) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="max-w-sm text-center px-4">
          <div className="text-5xl mb-4">📋</div>
          <h1 className="text-xl font-bold mb-2">Formulário não disponível</h1>
          <p className="text-sm text-muted-foreground">
            {error ?? "Este formulário não existe ou não foi configurado ainda."}
          </p>
        </div>
      </div>
    );
  }

  /* Success */
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4">
        <div className="max-w-md w-full rounded-2xl border bg-card p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">
            {schema.successMessage ?? "Resposta enviada!"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Obrigado pelo envio. Suas informações foram registradas.
          </p>
          <Button variant="outline" onClick={() => { setSubmitted(false); setValues({}); }}>
            Enviar outra resposta
          </Button>
        </div>
      </div>
    );
  }

  /* Form */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Form card */}
        <div className="rounded-2xl border bg-card shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-br px-8 pt-8 pb-6 border-b" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--primary, #4f46e5) 12%, transparent), color-mix(in srgb, var(--primary, #4f46e5) 5%, transparent))" }}>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {schema.title}
            </h1>
            {schema.description && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{schema.description}</p>
            )}
          </div>

          {/* Body */}
          {(() => {
            if (!schema) return null;
            const sections = schema.sections || [];
            const totalSteps = sections.length;
            const isStepByStep = schema.layoutMode === "step_by_step" && totalSteps > 1;

            const renderField = (field: any) => {
              const hasError = !!errors[field.id];
              return (
                <div key={field.id} className="space-y-2">
                  <label className="block text-sm font-medium">
                    {field.label}
                    {field.required && <span className="ml-1 text-red-500">*</span>}
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
                          ? "border-red-500 focus:ring-red-500/30" 
                          : "bg-surface border-input focus:ring-primary"
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
                          ? "border-red-500 focus:ring-red-500/30" 
                          : "bg-surface border-input focus:ring-primary"
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
                          ? "border-red-500 focus:ring-red-500/30" 
                          : "bg-surface border-input focus:ring-primary"
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
                          ? "border-red-500 focus:ring-red-500/30" 
                          : "bg-surface border-input focus:ring-primary"
                      }`}
                    />
                  )}

                  {field.type === "select" && (
                    <select
                      required={field.required}
                      value={values[field.id] ?? ""}
                      onChange={(e) => handleValueChange(field.id, e.target.value)}
                      className={`w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 transition-shadow bg-card text-foreground ${
                        hasError 
                          ? "border-red-500 focus:ring-red-500/30" 
                          : "bg-surface border-input focus:ring-primary"
                      }`}
                    >
                      <option value="">Selecione uma opção...</option>
                      {(field.options ?? []).map((opt: string) => (
                        <option key={opt} value={opt}>{opt}</option>
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

                  {field.type === "multiple_choice" && (
                    <div className="flex flex-col gap-2 mt-2">
                      {(field.options ?? []).map((opt: string) => {
                        const currentVals = values[field.id] ? values[field.id].split(", ") : [];
                        const isChecked = currentVals.includes(opt);
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
                                let newVals = [...currentVals];
                                if (e.target.checked) {
                                  newVals.push(opt);
                                } else {
                                  newVals = newVals.filter(v => v !== opt);
                                }
                                handleValueChange(field.id, newVals.join(", "));
                              }}
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {hasError && (
                    <p className="text-xs text-red-500 mt-1 font-medium animate-fade-in">
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
                <form onSubmit={handleSubmit} className="px-8 py-6 space-y-6">
                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-muted-foreground">
                      <span>Passo {currentStep + 1} de {totalSteps}</span>
                      <span>{progressPercent}% concluído</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-input/70 overflow-hidden">
                      <div 
                        className="h-full transition-all duration-300 ease-out" 
                        style={{ width: `${progressPercent}%`, backgroundColor: "var(--primary, #4f46e5)" }} 
                      />
                    </div>
                  </div>

                  {/* Current Section Container */}
                  {currentSection && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="border-b pb-4">
                        <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
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
                      <button
                        type="submit"
                        className="flex-1 h-11 rounded-xl text-sm font-semibold text-white transition-opacity"
                        style={{ background: "var(--primary, #4f46e5)" }}
                      >
                        Avançar
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 h-11 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                        style={{ background: "var(--primary, #4f46e5)" }}
                      >
                        {submitting ? "Enviando..." : (schema.submitLabel ?? "Enviar")}
                      </button>
                    )}
                  </div>
                </form>
              );
            }

            // All at once
            return (
              <form onSubmit={handleSubmit} className="px-8 py-6 space-y-8">
                {sections.map((section: any, secIdx: number) => (
                  <div key={section.id} className="space-y-6">
                    <div className="border-b pb-4">
                      <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
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

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                  style={{ background: "var(--primary, #4f46e5)" }}
                >
                  {submitting ? "Enviando..." : (schema.submitLabel ?? "Enviar")}
                </button>
              </form>
            );
          })()}
        </div>

        <p className="mt-4 text-center text-xs text-subtle">
          Powered by CollabSuite
        </p>
      </div>
    </div>
  );
}
