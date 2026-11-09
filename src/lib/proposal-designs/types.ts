/**
 * Shared data model for the "designed" proposal decks (Modelo 1 / Modelo 2).
 * Framework-agnostic (no React/DOM) so it can be imported from both the
 * client (editor/renderer components) and the server (merge + validation).
 */

export type CardTone = "dark" | "mid" | "light" | "accent" | "outline";

export interface ImageRef {
  url: string;
  alt?: string;
}

export type SlideKind =
  | "cover"
  | "chapter-divider"
  | "toc"
  | "stat-grid"
  | "card-grid"
  | "numbered-rows"
  | "timeline-phases"
  | "team-grid"
  | "cases-grid"
  | "pricing-tiers"
  | "pricing-breakdown"
  | "two-column-split"
  | "method-timeline"
  | "closing-acceptance";

export interface SlideHeader {
  title?: string;
  intro?: string;
  introQuote?: { text: string; attribution: string };
}

export interface RunningHeader {
  left?: string;
  right?: string;
}

/** Every slide in a design is one of these envelopes. `data` shape depends on `kind` (see below). */
export interface SlideEnvelope<D = any> {
  id: string;
  kind: SlideKind;
  label: string; // shown in the editor's slide list, e.g. "01 · Capa"
  enabled: boolean;
  tone: "dark" | "light";
  runningHeader?: RunningHeader;
  header?: SlideHeader;
  data: D;
}

export interface ThemeTokens {
  primaryColor: string; // dark section background / headline family
  midColor: string; // secondary dark tone
  accentColor: string; // highlight/accent tone
  lightColor: string; // light section background
  textMutedColor: string; // muted body text on light backgrounds
  logoUrl: string;
  companyName: string;
}

/* ── Per-kind data shapes ── */

export interface CoverData {
  layout: "hero-right" | "full-bleed-right" | "panorama-bottom";
  kicker: string;
  headline: string;
  headlineHighlight?: string;
  body: string;
  image?: ImageRef;
  footerRows: Array<{ label: string; value: string }>;
}

export interface ChapterDividerData {
  kicker: string;
  title: string;
  body: string;
  image?: ImageRef;
}

export interface TocData {
  items: Array<{ number: string; label: string }>;
}

export interface StatCardItem {
  value: string;
  label: string;
  tone?: CardTone;
}

export interface StatGridData {
  columns: number;
  cards: StatCardItem[];
  image?: ImageRef;
  notes?: Array<{ title: string; text: string }>;
}

export interface CardGridItem {
  number?: string;
  kicker?: string;
  title?: string;
  text?: string;
  bullets?: string[];
  tone?: CardTone;
}

export interface CardGridData {
  columns: number;
  cards: CardGridItem[];
  footnote?: { label: string; text: string };
}

export interface NumberedRow {
  number: string;
  title: string;
  text: string;
  resultText?: string;
  statValue?: string;
  statLabel?: string;
}

export interface NumberedRowsData {
  rows: NumberedRow[];
}

export interface TimelinePhase {
  dateLabel: string;
  title: string;
  detail: string;
  widthPct: number;
  offsetPct: number;
  tone?: CardTone;
}

export interface Milestone {
  title: string;
  text: string;
}

export interface TimelinePhasesData {
  phases: TimelinePhase[];
  milestones?: Milestone[];
}

export interface TeamMember {
  photo?: ImageRef;
  name: string;
  role: string;
  tone?: CardTone;
}

export interface TeamGridData {
  columns: number;
  members: TeamMember[];
  noteText?: string;
}

export interface CaseItem {
  image?: ImageRef;
  title: string;
  text: string;
  stats: Array<{ value: string; label: string }>;
}

export interface CasesGridData {
  layout: "image-top" | "image-left";
  cases: CaseItem[];
}

export interface PricingTier {
  name: string;
  text: string;
  price: string;
  period: string;
  features: string[];
  tone?: CardTone;
  recommended?: boolean;
  badgeLabel?: string;
}

export interface PricingTiersData {
  tiers: PricingTier[];
  footerNotes: Array<{ label: string; text: string }>;
}

export interface PricingPhaseRow {
  label: string;
  detail?: string;
  hours?: string;
  price: string;
}

export interface PricingBreakdownData {
  layout: "cards" | "table";
  mainKicker: string;
  rows: PricingPhaseRow[];
  totalLabel?: string;
  totalHours?: string;
  totalPrice?: string;
  paymentNote?: string;
  feeKicker: string;
  feePrice: string;
  feeSuffix: string;
  feeDetail: string;
  noteTitle?: string;
  noteText?: string;
  footerNote?: string;
}

export type SplitBlockType = "numbered-rows" | "stat-grid" | "card-grid" | "team-grid";

export interface SplitBlock {
  type: SplitBlockType;
  title: string;
  data: NumberedRowsData | StatGridData | CardGridData | TeamGridData;
  noteText?: string;
}

export interface TwoColumnSplitData {
  left: SplitBlock;
  right: SplitBlock;
}

export interface MethodTimelineData {
  steps: CardGridItem[];
  phases: TimelinePhase[];
}

export interface Signer {
  party: string;
  detail: string;
}

export interface ClosingAcceptanceData {
  title: string;
  steps: Array<{ number: string; text: string }>;
  footerContact?: string;
  acceptanceKicker: string;
  acceptanceText: string;
  signers: Signer[];
  footerNote?: string;
}

export type DesignId = "classic" | "model1" | "model2";

export const DESIGN_LABELS: Record<DesignId, string> = {
  classic: "Clássico",
  model1: "Modelo 1",
  model2: "Modelo 2",
};

export const SLIDE_KIND_LABELS: Record<SlideKind, string> = {
  cover: "Capa",
  "chapter-divider": "Divisor de capítulo",
  toc: "Sumário",
  "stat-grid": "Números e destaques",
  "card-grid": "Grade de cards",
  "numbered-rows": "Linhas numeradas",
  "timeline-phases": "Cronograma",
  "team-grid": "Time",
  "cases-grid": "Cases",
  "pricing-tiers": "Investimento (pacotes)",
  "pricing-breakdown": "Investimento (detalhado)",
  "two-column-split": "Duas colunas",
  "method-timeline": "Metodologia e cronograma",
  "closing-acceptance": "Encerramento e aceite",
};

/** Per-task override shape stored inside Task.proposal_data under these keys. */
export interface DesignSlideOverride {
  enabled?: boolean;
  header?: Partial<SlideHeader>;
  data?: Record<string, any>;
}

export interface DesignOverrides {
  designTheme?: Partial<ThemeTokens>;
  designSlides?: Record<string, DesignSlideOverride>;
}
