import { useState, useEffect, useRef } from "react";
import {
  FileSignature, Check, Copy, ExternalLink, Building2, Briefcase, DollarSign, HeartHandshake, FileText, Plus, Trash2, ChevronDown, ChevronRight, Images
} from "lucide-react";
import type { Task, ProposalTemplate } from "@/src/types";
import * as taskService from "@/src/services/task.service";
import * as proposalService from "@/src/services/proposal.service";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { ImageUpload } from "@/src/components/common/ImageUpload";
import { useTaskStore } from "@/src/store/task.store";
import { ThemeEditor } from "@/src/components/proposal-designs/ThemeEditor";
import { SlideAccordionList } from "@/src/components/proposal-designs/SlideAccordionList";
import { DEFAULT_THEME } from "@/src/lib/proposal-designs/theme.defaults";
import { mergeDesignSlides, mergeTheme, safeParseJson } from "@/src/lib/proposal-designs/merge";
import type { DesignId, DesignSlideOverride, SlideEnvelope, ThemeTokens } from "@/src/lib/proposal-designs/types";

interface Props {
  task: Task;
}

/* ── Default data shapes ── */
const defaultCover = {
  enabled: true, title: "Proposta Comercial", subtitle: "Transformando ideias em resultados",
  backgroundImage: "", logoUrl: "", companyName: "Sua Empresa", contactInfo: "contato@empresa.com • (11) 99999-9999", primaryColor: "#4f46e5",
};
const defaultAboutCompany = { enabled: true, title: "Sobre Nós", content: "", images: [] };
const defaultAboutWork = { enabled: true, title: "O que será feito", content: "" };
const defaultValues = { enabled: true, title: "Investimento", description: "", items: [{ label: "Serviço", value: "R$ 0,00", description: "Descrição" }], paymentInfo: "" };
const defaultThankYou = { enabled: true, title: "Obrigado!", message: "Agradecemos pela oportunidade de apresentar nossa proposta." };
const defaultStyles = { fontFamily: "Inter, sans-serif", primaryColor: "#4f46e5", secondaryColor: "#64748b" };

type SectionName = "cover" | "aboutCompany" | "aboutWork" | "values" | "thankYou";

export function ProposalConfig({ task }: Props) {
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);

  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(task.proposal_template_id || null);
  const [selectedTemplate, setSelectedTemplate] = useState<ProposalTemplate | null>(null);
  const [expandedSection, setExpandedSection] = useState<SectionName | null>(null);

  // Per-task overrides – initialized from task.proposal_data or empty
  const [overrides, setOverrides] = useState<Record<string, any>>(() => {
    if (task.proposal_data) {
      try { return JSON.parse(task.proposal_data); } catch { return {}; }
    }
    return {};
  });

  const [linkCopied, setLinkCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    proposalService.listTemplates().then(setTemplates).catch(() => {});
  }, []);

  // When selected template changes, load it
  useEffect(() => {
    if (!selectedTemplateId) { setSelectedTemplate(null); return; }
    proposalService.getTemplate(selectedTemplateId).then(setSelectedTemplate).catch(() => {});
  }, [selectedTemplateId]);

  // Auto-save with debounce. `data` is the full overrides snapshot already computed and applied
  // to local state by the caller (handleOverride) — we just persist it after the user pauses.
  // Crucially, we never write this snapshot back into `overrides` on success: if the request is
  // still in flight when the user keeps typing, a late response setting state back to this
  // (by-then-stale) snapshot would erase the newer keystrokes. Local state is always the source
  // of truth; the network call is fire-and-forget persistence.
  function scheduleSave(data: Record<string, any>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      taskService.updateTask(task.id, {
        proposal_template_id: selectedTemplateId,
        proposal_data: JSON.stringify(data),
      }).then((updated) => {
        updateTaskInState(updated);
      }).finally(() => setSaving(false));
    }, 600);
  }

  function handleTemplateChange(tmplId: number | null) {
    setSelectedTemplateId(tmplId);
    setSaving(true);
    taskService.updateTask(task.id, {
      proposal_template_id: tmplId,
      proposal_data: task.proposal_data || null,
    }).then((updated) => {
      updateTaskInState(updated);
    }).finally(() => setSaving(false));
  }

  function handleOverride(section: string, value: any) {
    const data = { ...overrides, [section]: value };
    setOverrides(data);
    scheduleSave(data);
  }

  function copyProposalLink() {
    const url = `${window.location.origin}/public/proposal/${task.id}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  }

  // Merge template + overrides for display
  function getMerged(section: SectionName): any {
    const templateData = selectedTemplate ? (() => {
      try {
        const raw = selectedTemplate[section === "aboutCompany" ? "about_company" :
          section === "aboutWork" ? "about_work" :
          section === "thankYou" ? "thank_you" : section];
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    })() : null;

    const defaults: Record<SectionName, any> = {
      cover: defaultCover,
      aboutCompany: defaultAboutCompany,
      aboutWork: defaultAboutWork,
      values: defaultValues,
      thankYou: defaultThankYou,
    };

    return { ...defaults[section], ...templateData, ...(overrides[section] || {}) };
  }

  const design = (selectedTemplate?.design || "classic") as DesignId;

  const mergedTheme: ThemeTokens =
    design !== "classic"
      ? mergeTheme(
          mergeTheme(DEFAULT_THEME[design], safeParseJson<Partial<ThemeTokens> | null>(selectedTemplate?.theme, null)),
          overrides.designTheme
        )
      : DEFAULT_THEME.model1;

  const mergedSlides: SlideEnvelope[] =
    design !== "classic"
      ? mergeDesignSlides(safeParseJson<SlideEnvelope[]>(selectedTemplate?.slides, []), overrides.designSlides)
      : [];

  function handleDesignSlidesChange(slides: SlideEnvelope[]) {
    const designSlides: Record<string, DesignSlideOverride> = {};
    slides.forEach((s) => {
      designSlides[s.id] = { enabled: s.enabled, header: s.header, data: s.data };
    });
    handleOverride("designSlides", designSlides);
  }

  const proposalUrl = task.proposal_template_id
    ? `${window.location.origin}/public/proposal/${task.id}`
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      {/* Template selector header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" /> Proposta Comercial
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Escolha um modelo e personalize o conteúdo da proposta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-muted-foreground animate-pulse">Salvando...</span>}
        </div>
      </div>

      {/* Template selector */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Modelo de Proposta
        </Label>
        <div className="flex items-center gap-3">
          <select
            value={selectedTemplateId ?? ""}
            onChange={(e) => handleTemplateChange(e.target.value ? Number(e.target.value) : null)}
            className="flex-1 h-11 rounded-xl border border-input bg-surface px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">— Selecione um modelo —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {/* Public link */}
          {proposalUrl && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={copyProposalLink} className="h-11 gap-2 whitespace-nowrap">
                {linkCopied ? <><Check className="h-4 w-4 text-green-500" /> Copiado!</> : <><Copy className="h-4 w-4" /> Copiar Link</>}
              </Button>
              <Button variant="ghost" size="icon" asChild className="h-11 w-11">
                <a href={proposalUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>

      {!selectedTemplateId ? (
        <div className="text-center py-16 text-muted-foreground rounded-xl border border-dashed">
          <FileSignature className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Selecione um modelo acima</p>
          <p className="text-sm">As seções personalizáveis aparecerão aqui.</p>
        </div>
      ) : design !== "classic" ? (
        <>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            As alterações abaixo salvam automaticamente e substituem o conteúdo do modelo apenas nesta proposta.
          </p>
          <ThemeEditor theme={mergedTheme} onChange={(theme) => handleOverride("designTheme", theme)} />
          <SlideAccordionList slides={mergedSlides} onChange={handleDesignSlidesChange} mode="override" />
        </>
      ) : (
        <>
          {/* Preview note */}
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            As alterações abaixo salvam automaticamente e substituem o conteúdo do modelo apenas nesta proposta.
          </p>

          {/* Collapsible sections */}
          <SectionEditor
            icon={<FileText className="h-4 w-4" />}
            title="Capa"
            section="cover"
            expanded={expandedSection === "cover"}
            onToggle={() => setExpandedSection(expandedSection === "cover" ? null : "cover")}
            data={getMerged("cover")}
            onData={(v) => handleOverride("cover", v)}
            enabledField="enabled"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Título" value={getMerged("cover").title} onChange={(v) => {
                const d = { ...getMerged("cover"), title: v };
                handleOverride("cover", d);
              }} />
              <Field label="Subtítulo" value={getMerged("cover").subtitle} onChange={(v) => {
                const d = { ...getMerged("cover"), subtitle: v };
                handleOverride("cover", d);
              }} />
              <Field label="Nome da Empresa" value={getMerged("cover").companyName} onChange={(v) => {
                const d = { ...getMerged("cover"), companyName: v };
                handleOverride("cover", d);
              }} />
              <Field label="Contato" value={getMerged("cover").contactInfo} onChange={(v) => {
                const d = { ...getMerged("cover"), contactInfo: v };
                handleOverride("cover", d);
              }} />
              <ImageUpload
                label="Logo da Empresa"
                value={getMerged("cover").logoUrl}
                onChange={(url) => {
                  const d = { ...getMerged("cover"), logoUrl: url };
                  handleOverride("cover", d);
                }}
                previewClass="h-16 w-16"
              />
              <ImageUpload
                label="Imagem de Fundo da Capa"
                value={getMerged("cover").backgroundImage}
                onChange={(url) => {
                  const d = { ...getMerged("cover"), backgroundImage: url };
                  handleOverride("cover", d);
                }}
                previewClass="h-24 w-full"
              />
              <Field label="Cor Primária" type="color" value={getMerged("cover").primaryColor} onChange={(v) => {
                const d = { ...getMerged("cover"), primaryColor: v };
                handleOverride("cover", d);
              }} />
            </div>
          </SectionEditor>

          <SectionEditor
            icon={<Building2 className="h-4 w-4" />}
            title="Sobre a Empresa"
            section="aboutCompany"
            expanded={expandedSection === "aboutCompany"}
            onToggle={() => setExpandedSection(expandedSection === "aboutCompany" ? null : "aboutCompany")}
            data={getMerged("aboutCompany")}
            onData={(v) => handleOverride("aboutCompany", v)}
            enabledField="enabled"
          >
            <TextareaField
              label="Conteúdo"
              value={getMerged("aboutCompany").content}
              onChange={(v) => {
                const d = { ...getMerged("aboutCompany"), content: v };
                handleOverride("aboutCompany", d);
              }}
              rows={5}
            />

            {/* Portfolio images */}
            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Images className="h-3.5 w-3.5" /> Imagens de Portfólio
                </Label>
                <Button variant="outline" size="sm" onClick={() => {
                  const d = { ...getMerged("aboutCompany") };
                  d.images = [...(d.images || []), { url: "", caption: "" }];
                  handleOverride("aboutCompany", d);
                }} className="h-7 gap-1 text-xs">
                  <Plus className="h-3 w-3" /> Adicionar
                </Button>
              </div>
              {(getMerged("aboutCompany").images || []).map((img: any, idx: number) => (
                <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <ImageUpload
                        label={`Imagem ${idx + 1}`}
                        value={img.url}
                        onChange={(url) => {
                          const d = { ...getMerged("aboutCompany") };
                          d.images = [...(d.images || [])];
                          d.images[idx] = { ...d.images[idx], url };
                          handleOverride("aboutCompany", d);
                        }}
                        previewClass="h-24 w-full"
                      />
                      <input
                        value={img.caption || ""}
                        onChange={(e) => {
                          const d = { ...getMerged("aboutCompany") };
                          d.images = [...(d.images || [])];
                          d.images[idx] = { ...d.images[idx], caption: e.target.value };
                          handleOverride("aboutCompany", d);
                        }}
                        placeholder="Legenda da imagem (opcional)"
                        className="w-full h-8 rounded-md border border-input bg-surface px-2 text-xs"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const d = { ...getMerged("aboutCompany") };
                        d.images = (d.images || []).filter((_: any, i: number) => i !== idx);
                        handleOverride("aboutCompany", d);
                      }}
                      className="shrink-0 mt-6 text-destructive hover:bg-destructive/10 rounded p-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {(!getMerged("aboutCompany").images || getMerged("aboutCompany").images.length === 0) && (
                <p className="text-xs text-muted-foreground italic">Nenhuma imagem adicionada.</p>
              )}
            </div>
          </SectionEditor>

          <SectionEditor
            icon={<Briefcase className="h-4 w-4" />}
            title="O que será feito"
            section="aboutWork"
            expanded={expandedSection === "aboutWork"}
            onToggle={() => setExpandedSection(expandedSection === "aboutWork" ? null : "aboutWork")}
            data={getMerged("aboutWork")}
            onData={(v) => handleOverride("aboutWork", v)}
            enabledField="enabled"
          >
            <TextareaField
              label="Conteúdo"
              value={getMerged("aboutWork").content}
              onChange={(v) => {
                const d = { ...getMerged("aboutWork"), content: v };
                handleOverride("aboutWork", d);
              }}
              rows={5}
            />
          </SectionEditor>

          <SectionEditor
            icon={<DollarSign className="h-4 w-4" />}
            title="Valores e Pagamento"
            section="values"
            expanded={expandedSection === "values"}
            onToggle={() => setExpandedSection(expandedSection === "values" ? null : "values")}
            data={getMerged("values")}
            onData={(v) => handleOverride("values", v)}
            enabledField="enabled"
          >
            <TextareaField label="Descrição" value={getMerged("values").description} onChange={(v) => {
              const d = { ...getMerged("values"), description: v };
              handleOverride("values", d);
            }} rows={2} />
            <TextareaField label="Info de Pagamento" value={getMerged("values").paymentInfo} onChange={(v) => {
              const d = { ...getMerged("values"), paymentInfo: v };
              handleOverride("values", d);
            }} rows={2} />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Itens de Valor</Label>
                <Button variant="outline" size="sm" onClick={() => {
                  const d = { ...getMerged("values") };
                  d.items = [...(d.items || []), { label: "", value: "", description: "" }];
                  handleOverride("values", d);
                }} className="h-7 gap-1 text-xs">
                  <Plus className="h-3 w-3" /> Item
                </Button>
              </div>
              {getMerged("values").items?.map((item: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3">
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <input value={item.label} onChange={(e) => {
                      const d = { ...getMerged("values") };
                      d.items = [...d.items];
                      d.items[idx] = { ...d.items[idx], label: e.target.value };
                      handleOverride("values", d);
                    }} placeholder="Nome" className="h-8 rounded-md border border-input bg-surface px-2 text-xs" />
                    <input value={item.value} onChange={(e) => {
                      const d = { ...getMerged("values") };
                      d.items = [...d.items];
                      d.items[idx] = { ...d.items[idx], value: e.target.value };
                      handleOverride("values", d);
                    }} placeholder="Valor" className="h-8 rounded-md border border-input bg-surface px-2 text-xs" />
                    <input value={item.description} onChange={(e) => {
                      const d = { ...getMerged("values") };
                      d.items = [...d.items];
                      d.items[idx] = { ...d.items[idx], description: e.target.value };
                      handleOverride("values", d);
                    }} placeholder="Descrição" className="h-8 rounded-md border border-input bg-surface px-2 text-xs" />
                  </div>
                  <button onClick={() => {
                    const d = { ...getMerged("values") };
                    d.items = d.items.filter((_: any, i: number) => i !== idx);
                    handleOverride("values", d);
                  }} className="text-destructive hover:bg-destructive/10 rounded p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </SectionEditor>

          <SectionEditor
            icon={<HeartHandshake className="h-4 w-4" />}
            title="Agradecimento"
            section="thankYou"
            expanded={expandedSection === "thankYou"}
            onToggle={() => setExpandedSection(expandedSection === "thankYou" ? null : "thankYou")}
            data={getMerged("thankYou")}
            onData={(v) => handleOverride("thankYou", v)}
            enabledField="enabled"
          >
            <TextareaField label="Mensagem" value={getMerged("thankYou").message} onChange={(v) => {
              const d = { ...getMerged("thankYou"), message: v };
              handleOverride("thankYou", d);
            }} rows={4} />
          </SectionEditor>
        </>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function SectionEditor({
  icon, title, section, expanded, onToggle, data, onData, enabledField, children,
}: {
  icon: React.ReactNode;
  title: string;
  section: string;
  expanded: boolean;
  onToggle: () => void;
  data: any;
  onData: (v: any) => void;
  enabledField: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-accent/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 font-medium text-sm">
          {icon}
          <span>{title}</span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={data?.[enabledField] !== false}
              onChange={(e) => onData({ ...data, [enabledField]: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
            />
            Ativo
          </label>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (data?.[enabledField] !== false) && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold">{label}</Label>
      {type === "color" ? (
        <div className="flex gap-2 items-center">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-16 rounded-md border border-input p-0.5 cursor-pointer" />
          <input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 h-9 rounded-md border border-input bg-surface px-2 text-sm" />
        </div>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-9 rounded-md border border-input bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      )}
    </div>
  );
}

function TextareaField({ label, value, onChange, rows }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold">{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y min-h-[80px]"
      />
    </div>
  );
}
