import { useState, useEffect } from "react";
import { FileText, Plus, Trash2, Save, FileSignature, Building2, Briefcase, DollarSign, HeartHandshake, Check, Eye, X, ChevronRight, Images } from "lucide-react";
import type { ProposalTemplate } from "@/src/types";
import * as proposalService from "@/src/services/proposal.service";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { ImageUpload } from "@/src/components/common/ImageUpload";
import { DesignPicker } from "@/src/components/proposal-designs/DesignPicker";
import { ThemeEditor } from "@/src/components/proposal-designs/ThemeEditor";
import { SlideAccordionList } from "@/src/components/proposal-designs/SlideAccordionList";
import { DEFAULT_THEME } from "@/src/lib/proposal-designs/theme.defaults";
import { MODEL1_SLIDES } from "@/src/lib/proposal-designs/model1.defaults";
import { MODEL2_SLIDES } from "@/src/lib/proposal-designs/model2.defaults";
import { DESIGN_LABELS, type DesignId, type SlideEnvelope, type ThemeTokens } from "@/src/lib/proposal-designs/types";

interface Props {
  onBack: () => void;
}

interface TemplateForm {
  name: string;
  cover: {
    enabled: boolean;
    title: string;
    subtitle: string;
    backgroundImage: string;
    logoUrl: string;
    companyName: string;
    contactInfo: string;
    primaryColor: string;
  };
  aboutCompany: {
    enabled: boolean;
    title: string;
    content: string;
    images: Array<{ url: string; caption: string }>;
  };
  aboutWork: {
    enabled: boolean;
    title: string;
    content: string;
  };
  values: {
    enabled: boolean;
    title: string;
    description: string;
    items: Array<{ label: string; value: string; description: string }>;
    paymentInfo: string;
  };
  thankYou: {
    enabled: boolean;
    title: string;
    message: string;
  };
  styles: {
    fontFamily: string;
    primaryColor: string;
    secondaryColor: string;
  };
  design: DesignId;
  theme: ThemeTokens;
  slides: SlideEnvelope[];
}

const defaultForm: TemplateForm = {
  name: "Novo Modelo",
  cover: {
    enabled: true,
    title: "Proposta Comercial",
    subtitle: "Transformando ideias em resultados",
    backgroundImage: "",
    logoUrl: "",
    companyName: "Sua Empresa",
    contactInfo: "contato@empresa.com • (11) 99999-9999",
    primaryColor: "#4f46e5",
  },
  aboutCompany: {
    enabled: true,
    title: "Sobre Nós",
    content: "Somos uma empresa especializada em...",
    images: [],
  },
  aboutWork: {
    enabled: true,
    title: "O que será feito",
    content: "Descreva aqui o escopo do trabalho...",
  },
  values: {
    enabled: true,
    title: "Investimento",
    description: "",
    items: [{ label: "Serviço", value: "R$ 0,00", description: "Descrição do serviço" }],
    paymentInfo: "Forma de pagamento: à vista ou parcelado em até 12x",
  },
  thankYou: {
    enabled: true,
    title: "Obrigado!",
    message: "Agradecemos pela oportunidade de apresentar nossa proposta. Estamos à disposição para esclarecer qualquer dúvida.",
  },
  styles: {
    fontFamily: "Inter, sans-serif",
    primaryColor: "#4f46e5",
    secondaryColor: "#64748b",
  },
  design: "classic",
  theme: DEFAULT_THEME.model1,
  slides: [],
};

function serializeForm(form: TemplateForm) {
  if (form.design !== "classic") {
    return {
      name: form.name,
      cover: null,
      about_company: null,
      about_work: null,
      values: null,
      thank_you: null,
      styles: JSON.stringify(form.styles),
      design: form.design,
      theme: JSON.stringify(form.theme),
      slides: JSON.stringify(form.slides),
    };
  }
  return {
    name: form.name,
    cover: form.cover.enabled ? JSON.stringify(form.cover) : null,
    about_company: form.aboutCompany.enabled ? JSON.stringify(form.aboutCompany) : null,
    about_work: form.aboutWork.enabled ? JSON.stringify(form.aboutWork) : null,
    values: form.values.enabled ? JSON.stringify(form.values) : null,
    thank_you: form.thankYou.enabled ? JSON.stringify(form.thankYou) : null,
    styles: JSON.stringify(form.styles),
    design: "classic" as const,
    theme: null,
    slides: null,
  };
}

function deserializeTemplate(t: ProposalTemplate): TemplateForm {
  const parseSafe = (json: string | null | undefined, fallback: any) => {
    if (!json) return fallback;
    try { return JSON.parse(json); } catch { return fallback; }
  };

  const design = (t.design || "classic") as DesignId;
  return {
    name: t.name,
    cover: parseSafe(t.cover, defaultForm.cover),
    aboutCompany: parseSafe(t.about_company, defaultForm.aboutCompany),
    aboutWork: parseSafe(t.about_work, defaultForm.aboutWork),
    values: parseSafe(t.values, defaultForm.values),
    thankYou: parseSafe(t.thank_you, defaultForm.thankYou),
    styles: parseSafe(t.styles, defaultForm.styles),
    design,
    theme: parseSafe(t.theme, design !== "classic" ? DEFAULT_THEME[design] : DEFAULT_THEME.model1),
    slides: parseSafe(t.slides, []),
  };
}

export function ProposalTemplateEditor({ onBack }: Props) {
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<TemplateForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const list = await proposalService.listTemplates();
      setTemplates(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setForm({ ...defaultForm, name: `Modelo ${templates.length + 1}` });
    setEditingId(null);
    setIsCreating(true);
  }

  function startEdit(t: ProposalTemplate) {
    setForm(deserializeTemplate(t));
    setEditingId(t.id);
    setIsCreating(false);
  }

  function cancelEditing() {
    setEditingId(null);
    setIsCreating(false);
    setForm(defaultForm);
  }

  function updateForm<K extends keyof TemplateForm>(section: K, value: TemplateForm[K]) {
    setForm((prev) => ({ ...prev, [section]: value }));
  }

  function handleDesignSelect(design: DesignId) {
    setForm((prev) => {
      if (design === "classic") return { ...prev, design };
      const theme = structuredClone(DEFAULT_THEME[design]);
      const slides = structuredClone(design === "model1" ? MODEL1_SLIDES : MODEL2_SLIDES);
      return { ...prev, design, theme, slides };
    });
  }

  function updateNested(section: keyof TemplateForm, field: string, value: any) {
    setForm((prev) => {
      const sectionValue = prev[section];
      if (typeof sectionValue !== 'object' || sectionValue === null) {
        return prev;
      }
      return {
        ...prev,
        [section]: { ...(sectionValue as any), [field]: value },
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = serializeForm(form);
      if (editingId) {
        await proposalService.updateTemplate(editingId, payload);
      } else {
        await proposalService.createTemplate(payload as any);
      }
      await loadTemplates();
      setEditingId(null);
      setIsCreating(false);
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar modelo");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir este modelo de proposta?")) return;
    try {
      await proposalService.deleteTemplate(id);
      if (editingId === id || isCreating) { setEditingId(null); setIsCreating(false); setForm(defaultForm); }
      await loadTemplates();
    } catch (err) {
      console.error(err);
      alert("Erro ao excluir modelo");
    }
  }

  function addValueItem() {
    updateForm("values", {
      ...form.values,
      items: [...form.values.items, { label: "", value: "", description: "" }],
    });
  }

  function removeValueItem(idx: number) {
    const items = form.values.items.filter((_, i) => i !== idx);
    updateForm("values", { ...form.values, items });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <FileText className="h-5 w-5 animate-pulse mr-2" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold font-display flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" /> Modelos de Proposta
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Crie e gerencie modelos de proposta comercial. Cada modelo pode ser vinculado a uma tarefa.
          </p>
        </div>
        {!editingId && (
          <Button onClick={startNew} className="gap-2 h-10">
            <Plus className="h-4 w-4" /> Novo Modelo
          </Button>
        )}
      </div>

      {isCreating || editingId !== null || templates.length === 0 ? (
        /* ── Editor ── */
        <div className="space-y-6">
          {/* Template Name */}
          <Card>
            <CardHeader><CardTitle className="text-base">Nome do Modelo</CardTitle></CardHeader>
            <CardContent>
              <Input
                value={form.name}
                onChange={(e) => updateForm("name", e.target.value)}
                placeholder="Ex: Proposta Padrão"
                className="h-11"
              />
            </CardContent>
          </Card>

          {/* ── Design ── */}
          {!editingId ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Design</CardTitle></CardHeader>
              <CardContent>
                <DesignPicker value={form.design} onSelect={handleDesignSelect} />
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSignature className="h-4 w-4" />
              Design: <span className="font-semibold text-foreground">{DESIGN_LABELS[form.design]}</span>
              <span className="text-xs">(fixo após a criação — crie um novo modelo para trocar o design)</span>
            </div>
          )}

          {form.design !== "classic" ? (
            <>
              <ThemeEditor theme={form.theme} onChange={(theme) => updateForm("theme", theme)} />
              <SlideAccordionList slides={form.slides} onChange={(slides) => updateForm("slides", slides)} mode="template" />
            </>
          ) : (
          <>
          {/* ── Cover Page ── */}
          <PageSection
            icon={<FileText className="h-4 w-4" />}
            title="Capa"
            enabled={form.cover.enabled}
            onToggle={(v) => updateNested("cover", "enabled", v)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Título Principal</Label>
                <Input value={form.cover.title} onChange={(e) => updateNested("cover", "title", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Subtítulo</Label>
                <Input value={form.cover.subtitle} onChange={(e) => updateNested("cover", "subtitle", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nome da Empresa</Label>
                <Input value={form.cover.companyName} onChange={(e) => updateNested("cover", "companyName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Informações de Contato</Label>
                <Input value={form.cover.contactInfo} onChange={(e) => updateNested("cover", "contactInfo", e.target.value)} />
              </div>
              <ImageUpload
                label="Logo da Empresa"
                value={form.cover.logoUrl}
                onChange={(url) => updateNested("cover", "logoUrl", url)}
                previewClass="h-16 w-16"
              />
              <ImageUpload
                label="Imagem de Fundo da Capa"
                value={form.cover.backgroundImage}
                onChange={(url) => updateNested("cover", "backgroundImage", url)}
                previewClass="h-24 w-full"
              />
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Cor Primária</Label>
                <div className="flex gap-2 items-center">
                  <Input type="color" value={form.cover.primaryColor} onChange={(e) => updateNested("cover", "primaryColor", e.target.value)} className="w-16 h-11 p-1" />
                  <Input value={form.cover.primaryColor} onChange={(e) => updateNested("cover", "primaryColor", e.target.value)} className="flex-1" />
                </div>
              </div>
            </div>
          </PageSection>

          {/* ── About Company ── */}
          <PageSection
            icon={<Building2 className="h-4 w-4" />}
            title="Sobre a Empresa"
            enabled={form.aboutCompany.enabled}
            onToggle={(v) => updateNested("aboutCompany", "enabled", v)}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Título da Seção</Label>
                <Input value={form.aboutCompany.title} onChange={(e) => updateNested("aboutCompany", "title", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Conteúdo</Label>
                <Textarea
                  rows={6}
                  value={form.aboutCompany.content}
                  onChange={(e) => updateNested("aboutCompany", "content", e.target.value)}
                  placeholder="Descreva sua empresa, missão, valores, experiência..."
                  className="resize-y min-h-[150px]"
                />
              </div>

              {/* Portfolio images */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Images className="h-3.5 w-3.5" /> Imagens de Portfólio
                  </Label>
                  <Button variant="outline" size="sm" onClick={() => {
                    const imgs = [...(form.aboutCompany.images || [])];
                    imgs.push({ url: "", caption: "" });
                    updateNested("aboutCompany", "images", imgs);
                  }} className="h-7 gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Adicionar
                  </Button>
                </div>
                {(form.aboutCompany.images || []).map((img, idx) => (
                  <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-2">
                        <ImageUpload
                          label={`Imagem ${idx + 1}`}
                          value={img.url}
                          onChange={(url) => {
                            const imgs = [...(form.aboutCompany.images || [])];
                            imgs[idx] = { ...imgs[idx], url };
                            updateNested("aboutCompany", "images", imgs);
                          }}
                          previewClass="h-24 w-full"
                        />
                        <Input
                          value={img.caption}
                          onChange={(e) => {
                            const imgs = [...(form.aboutCompany.images || [])];
                            imgs[idx] = { ...imgs[idx], caption: e.target.value };
                            updateNested("aboutCompany", "images", imgs);
                          }}
                          placeholder="Legenda da imagem (opcional)"
                          className="h-8 text-xs"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const imgs = (form.aboutCompany.images || []).filter((_, i) => i !== idx);
                          updateNested("aboutCompany", "images", imgs);
                        }}
                        className="shrink-0 mt-6 text-destructive hover:bg-destructive/10 rounded p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {(!form.aboutCompany.images || form.aboutCompany.images.length === 0) && (
                  <p className="text-xs text-muted-foreground italic">Nenhuma imagem adicionada. Clique em "Adicionar" para incluir fotos do portfólio.</p>
                )}
              </div>
            </div>
          </PageSection>

          {/* ── About Work ── */}
          <PageSection
            icon={<Briefcase className="h-4 w-4" />}
            title="O que será feito"
            enabled={form.aboutWork.enabled}
            onToggle={(v) => updateNested("aboutWork", "enabled", v)}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Título da Seção</Label>
                <Input value={form.aboutWork.title} onChange={(e) => updateNested("aboutWork", "title", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Conteúdo</Label>
                <Textarea
                  rows={6}
                  value={form.aboutWork.content}
                  onChange={(e) => updateNested("aboutWork", "content", e.target.value)}
                  placeholder="Descreva detalhadamente o escopo do trabalho, entregáveis, cronograma..."
                  className="resize-y min-h-[150px]"
                />
              </div>
            </div>
          </PageSection>

          {/* ── Values ── */}
          <PageSection
            icon={<DollarSign className="h-4 w-4" />}
            title="Valores e Pagamento"
            enabled={form.values.enabled}
            onToggle={(v) => updateNested("values", "enabled", v)}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Título da Seção</Label>
                <Input value={form.values.title} onChange={(e) => updateNested("values", "title", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Descrição</Label>
                <Textarea
                  rows={2}
                  value={form.values.description}
                  onChange={(e) => updateNested("values", "description", e.target.value)}
                  placeholder="Descrição geral do investimento..."
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Informações de Pagamento</Label>
                <Textarea
                  rows={2}
                  value={form.values.paymentInfo}
                  onChange={(e) => updateNested("values", "paymentInfo", e.target.value)}
                  placeholder="Formas de pagamento, parcelamento..."
                />
              </div>

              {/* Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Itens de Valor</Label>
                  <Button variant="outline" size="sm" onClick={addValueItem} className="h-8 gap-1">
                    <Plus className="h-3 w-3" /> Adicionar
                  </Button>
                </div>
                {form.values.items.map((item, idx) => (
                  <div key={idx} className="rounded-xl border bg-muted/20 p-3 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-muted-foreground">Item {idx + 1}</span>
                      <Button variant="ghost" size="sm" onClick={() => removeValueItem(idx)} className="h-7 w-7 p-0 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold">Nome</Label>
                        <Input value={item.label} onChange={(e) => {
                          const items = [...form.values.items];
                          items[idx] = { ...items[idx], label: e.target.value };
                          updateForm("values", { ...form.values, items });
                        }} placeholder="Ex: Consultoria" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold">Valor</Label>
                        <Input value={item.value} onChange={(e) => {
                          const items = [...form.values.items];
                          items[idx] = { ...items[idx], value: e.target.value };
                          updateForm("values", { ...form.values, items });
                        }} placeholder="Ex: R$ 5.000,00" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold">Descrição</Label>
                        <Input value={item.description} onChange={(e) => {
                          const items = [...form.values.items];
                          items[idx] = { ...items[idx], description: e.target.value };
                          updateForm("values", { ...form.values, items });
                        }} placeholder="Descrição do serviço" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PageSection>

          {/* ── Thank You ── */}
          <PageSection
            icon={<HeartHandshake className="h-4 w-4" />}
            title="Página de Agradecimento"
            enabled={form.thankYou.enabled}
            onToggle={(v) => updateNested("thankYou", "enabled", v)}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Título</Label>
                <Input value={form.thankYou.title} onChange={(e) => updateNested("thankYou", "title", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Mensagem</Label>
                <Textarea
                  rows={4}
                  value={form.thankYou.message}
                  onChange={(e) => updateNested("thankYou", "message", e.target.value)}
                  placeholder="Mensagem de agradecimento..."
                  className="resize-y min-h-[100px]"
                />
              </div>
            </div>
          </PageSection>

          {/* ── Style Settings ── */}
          <Card>
            <CardHeader><CardTitle className="text-base">Estilos</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Cor Primária</Label>
                  <div className="flex gap-2 items-center">
                    <Input type="color" value={form.styles.primaryColor} onChange={(e) => updateNested("styles", "primaryColor", e.target.value)} className="w-16 h-11 p-1" />
                    <Input value={form.styles.primaryColor} onChange={(e) => updateNested("styles", "primaryColor", e.target.value)} className="flex-1" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Cor Secundária</Label>
                  <div className="flex gap-2 items-center">
                    <Input type="color" value={form.styles.secondaryColor} onChange={(e) => updateNested("styles", "secondaryColor", e.target.value)} className="w-16 h-11 p-1" />
                    <Input value={form.styles.secondaryColor} onChange={(e) => updateNested("styles", "secondaryColor", e.target.value)} className="flex-1" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 justify-end">
            <Button variant="outline" onClick={cancelEditing} className="gap-2">
              <X className="h-4 w-4" /> Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar Modelo"}
            </Button>
          </div>
        </div>
      ) : (
        /* ── List ── */
        <div className="grid gap-3">
          {templates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Nenhum modelo cadastrado</p>
              <p className="text-sm">Clique em "Novo Modelo" para criar o primeiro.</p>
            </div>
          ) : (
            templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border bg-card p-4 hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileSignature className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.design && t.design !== "classic"
                        ? `${DESIGN_LABELS[t.design as DesignId]} • ${t.slides ? JSON.parse(t.slides).filter((s: any) => s.enabled).length : 0} slides ativos`
                        : `Capa: ${t.cover ? "✅" : "❌"} • Empresa: ${t.about_company ? "✅" : "❌"} • Escopo: ${t.about_work ? "✅" : "❌"} • Valores: ${t.values ? "✅" : "❌"} • Agradecimento: ${t.thank_you ? "✅" : "❌"}`}
                    </p>
                  </div>
                  {t.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 border border-emerald-500/20">
                      <Check className="h-3 w-3" /> Padrão
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(t)} className="h-9 gap-1">
                    <Eye className="h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(t.id)} className="h-9 w-9 p-0 text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Reusable section wrapper ── */
function PageSection({
  icon, title, enabled, onToggle, children,
}: {
  icon: React.ReactNode;
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Card className={!enabled ? "opacity-50" : ""}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon} {title}
        </CardTitle>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          Ativo
        </label>
      </CardHeader>
      {enabled && <CardContent>{children}</CardContent>}
    </Card>
  );
}
