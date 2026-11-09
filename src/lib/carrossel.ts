import type { BrandbookSummary, SlideData, SlideTemplateDef } from "@/src/services/carrossel.service";

export type TemplateInfo = BrandbookSummary["slide_templates"][number];

export const ARCHETYPES: { id: string; label: string }[] = [
  { id: "educativo", label: "Educativo / Como fazer" },
  { id: "comparativo", label: "Comparativo (antes vs depois)" },
  { id: "narrativa", label: "Storytelling / Caso real" },
  { id: "dado", label: "Dado estatístico / Pesquisa" },
  { id: "checklist", label: "Passo a passo / Lista" },
  { id: "objecao", label: "Quebra de objeção" },
];

export const THEMES: { id: string; label: string; hint: string }[] = [
  { id: "brand", label: "Padrão da marca", hint: "Cada modelo no desenho original" },
  { id: "dark", label: "Tudo escuro", hint: "Usa a variante escura da marca" },
  { id: "light", label: "Tudo claro", hint: "Usa a variante clara da marca" },
  { id: "alternating", label: "Alternado", hint: "Escuro e claro, slide a slide" },
];

export const ARCHETYPE_LABELS: Record<string, string> = {
  capa: "Capa", capa_rosa: "Capa (cor da marca)", capa_imagem: "Capa com imagem", afirmacao: "Afirmação", passo: "Passo",
  topico: "Tópico", lista: "Lista", dado: "Número de destaque", depoimento: "Depoimento", comparativo: "Comparativo",
  conversa: "Conversa", print: "Print / imagem", cta: "Chamada para ação",
};

export const FONT_SUGGESTIONS = [
  "Inter", "Plus Jakarta Sans", "Sora", "Geist", "Poppins", "Montserrat", "Playfair Display", "Space Grotesk", "DM Sans",
  "Bebas Neue", "Oswald", "Lora", "Roboto", "Caveat",
];

export const contentSlots = (t: TemplateInfo) => t.slots.filter((s) => s.kind === "content" && s.role !== "initials");

export function findTemplate(templates: TemplateInfo[], slide: Pick<SlideData, "template_code" | "template_type">): TemplateInfo | undefined {
  const code = (slide.template_code || "").toLowerCase();
  return (
    templates.find((t) => t.code.toLowerCase() === code) ||
    templates.find((t) => t.code.toLowerCase() === (slide.template_type || "").toLowerCase()) ||
    templates.find((t) => t.archetype.toLowerCase() === (slide.template_type || "").toLowerCase())
  );
}

/** Leva o conteúdo de um modelo para outro (mesmo id, senão mesmo papel). */
export function remapFields(fields: Record<string, any>, old: TemplateInfo | undefined, next: TemplateInfo): Record<string, any> {
  const out: Record<string, any> = {};
  const oldByRole: Record<string, any> = {};
  if (old) for (const s of contentSlots(old)) if (s.id in fields && !(s.role in oldByRole)) oldByRole[s.role] = fields[s.id];
  for (const s of contentSlots(next)) {
    if (s.id in fields) out[s.id] = fields[s.id];
    else if (s.role in oldByRole) out[s.role === "image" ? s.id : s.id] = oldByRole[s.role];
  }
  for (const g of next.groups) if (g.id in fields) out[g.id] = fields[g.id];
  return out;
}

export function slideTitle(fields: Record<string, any>, tpl?: TemplateInfo): string {
  return String(fields.title || fields.body || fields.text_1 || tpl?.name || "Slide").replace(/\*\*/g, "");
}

export function blankSlide(index: number, tpl: TemplateInfo, theme?: "dark" | "light" | null): SlideData {
  return {
    id: `slide_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, index, template_type: tpl.archetype,
    template_code: tpl.code, fields: {}, title: tpl.name, show_pagination: true, custom_typography: {}, field_font_sizes: {},
    theme: theme ?? null, animation: { preset: "none", ken_burns: false }, padding: 88, footer_margin: 88,
  };
}

/** Reindexa e renomeia ids após mover/remover slides (o índice define a paginação). */
export function reindex(slides: SlideData[]): SlideData[] {
  return slides.map((s, i) => ({ ...s, index: i + 1 }));
}

export type { SlideTemplateDef };
