/** Tipos do Estúdio de Carrosséis (espelham os modelos pydantic do CarrosselX). */

export interface BrandColors {
  primary_600: string;
  primary_800: string;
  primary_100: string;
  primary_200: string;
  neutral_50: string;
  neutral_100: string;
  neutral_200: string;
  neutral_600: string;
  neutral_700: string;
  neutral_900: string;
  neutral_950: string;
  neutral_dark: string;
  green_check: string;
}

export const DEFAULT_COLORS: BrandColors = {
  primary_600: "oklch(51% 0.125 165)",
  primary_800: "oklch(35% 0.085 165)",
  primary_100: "oklch(94% 0.045 165)",
  primary_200: "oklch(88% 0.075 165)",
  neutral_50: "oklch(98% 0.004 250)",
  neutral_100: "oklch(96% 0.006 250)",
  neutral_200: "oklch(92% 0.008 250)",
  neutral_600: "oklch(58% 0.014 250)",
  neutral_700: "oklch(46% 0.014 250)",
  neutral_900: "oklch(36% 0.013 250)",
  neutral_950: "oklch(13% 0.007 250)",
  neutral_dark: "oklch(18% 0.009 250)",
  green_check: "oklch(62% 0.135 155)",
};

export interface BrandTypography {
  title_font: string;
  title_weights: string;
  body_font: string;
  body_weights: string;
  mono_font: string;
  mono_weights: string;
}

export const DEFAULT_TYPOGRAPHY: BrandTypography = {
  title_font: "Plus Jakarta Sans",
  title_weights: "700;800",
  body_font: "Inter",
  body_weights: "400;500",
  mono_font: "JetBrains Mono",
  mono_weights: "500",
};

export interface TemplateSlot {
  id: string;
  role: string;
  label: string;
  kind: "content" | "label" | "auto";
  rich: boolean;
  multiline: boolean;
  sample: string;
  max_chars: number | null;
  font_size?: number | null;
}

export interface TemplateGroup {
  id: string;
  label: string;
  min_items: number;
  max_items: number;
  item_slots: TemplateSlot[];
  sample_items: Record<string, string>[];
}

export type ThemeName = "dark" | "light";

export interface SlideTemplateDef {
  code: string;
  name: string;
  archetype: string;
  description: string | null;
  default_bg: "dark" | "light" | "primary" | null;
  html: string | null;
  slots: TemplateSlot[];
  groups: TemplateGroup[];
  needs_image: boolean;
  builtin?: boolean;
}

export interface ThemeTokens {
  dark: { bg: string; text: string; hl?: string | null; annotation?: string | null };
  light: { bg: string; text: string; hl?: string | null; annotation?: string | null };
  asset_filter?: { dark: Record<string, string>; light: Record<string, string> };
  [k: string]: any;
}

export interface Brandbook {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  colors: BrandColors;
  typography: BrandTypography;
  logo_filename: string | null;
  icon_filename: string | null;
  writing_rules: string[];
  default_theme: ThemeName;
  slide_templates: SlideTemplateDef[];
  theme_tokens: ThemeTokens | Record<string, never>;
  source_file: string | null;
  import_report: Record<string, any>;
  is_default: boolean;
  /** logos/ícones da marca, por nome de arquivo, como data URI (ficam no próprio registro). */
  assets: Record<string, string>;
  /** HTML original do brand book (permite reanalisar sem novo upload). */
  source_html?: string | null;
}

export const DEFAULT_WRITING_RULES = [
  "NUNCA use travessão (—, -, –). Use frases curtas e diretas separadas por pontos.",
  "Nível de leitura simples: escreva como para uma criança de 10 anos entender.",
  "Frases curtas: máximo 12 palavras por frase.",
  "Sem jargões técnicos sem explicação imediata.",
  "Voz ativa e positiva.",
  "Números concretos e diretos.",
  "Máximo de 40 palavras no corpo por slide.",
];

export interface SlideTypography {
  title_size?: number | null;
  body_size?: number | null;
  stat_size?: number | null;
  title_font?: string | null;
  title_weight?: number | null;
  title_italic?: boolean;
  body_font?: string | null;
  body_weight?: number | null;
  body_italic?: boolean;
}

export interface SlideAnimation {
  preset: string; // none, fade-up, slide-left, slide-right, zoom-in, blur-in, pop
  ken_burns: boolean;
}

export interface SlideData {
  id: string;
  index: number;
  template_type: string;
  template_code?: string | null;
  fields: Record<string, any>;
  category?: string | null;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  annotation?: string | null;
  step_number?: string | null;
  step_label?: string | null;
  stat_number?: string | null;
  stat_source?: string | null;
  quote_author?: string | null;
  quote_role?: string | null;
  cta_primary?: string | null;
  cta_secondary?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  show_pagination: boolean;
  custom_typography: SlideTypography;
  field_font_sizes: Record<string, number>;
  theme?: ThemeName | null;
  bg_override?: string | null;
  padding?: number | null;
  footer_margin?: number | null;
  animation: SlideAnimation;
}

export interface CarouselProjectData {
  id: string;
  title: string;
  brandbook_id: string;
  archetype: string;
  theme: string; // brand | dark | light | alternating
  is_single_slide: boolean;
  slides: SlideData[];
  warnings: string[];
  jev_validation?: Record<string, any> | null;
  created_at?: string | null;
  updated_at?: string | null;
  carousel_model: string; // brandbook | image_text
  person_id?: string | null;
  topic?: string | null;
  source_context?: string | null;
  target_audience?: string | null;
  additional_instructions?: string | null;
  /** Projeto da CollabSuite ao qual o carrossel está vinculado. */
  project_id?: number | null;
  /** Biblioteca de imagens do carrossel (enviadas ou geradas por IA). */
  images?: { url: string; kind: "upload" | "ai"; type: "image" | "video"; name?: string }[];
}

export interface GenerateRequest {
  topic?: string;
  context?: string | null;
  brandbook_id: string;
  archetype: string;
  theme?: string;
  is_single_slide?: boolean;
  slide_count?: number;
  target_audience?: string | null;
  additional_instructions?: string | null;
  provider?: string | null;
  model?: string | null;
  carousel_model?: string;
  person_id?: string | null;
  background?: string;
  image_mode?: string;
  scene?: string | null;
  /** Imagem já escolhida (background "file") para todos os slides do Imagem e Texto. */
  image_url?: string | null;
  project_id?: number | null;
}

export function newSlide(partial: Partial<SlideData> & { id: string; index: number; template_type: string }): SlideData {
  return {
    fields: {},
    title: "",
    show_pagination: true,
    custom_typography: {},
    field_font_sizes: {},
    animation: { preset: "none", ken_burns: false },
    padding: 88,
    footer_margin: 88,
    ...partial,
  };
}
