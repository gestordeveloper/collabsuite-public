import type { SlideKind } from "@/src/lib/proposal-designs/types";
import { CoverRenderer } from "./CoverRenderer";
import { ChapterDividerRenderer } from "./ChapterDividerRenderer";
import { TocRenderer } from "./TocRenderer";
import { StatGridRenderer } from "./StatGridRenderer";
import { CardGridRenderer } from "./CardGridRenderer";
import { NumberedRowsRenderer } from "./NumberedRowsRenderer";
import { TimelinePhasesRenderer } from "./TimelinePhasesRenderer";
import { TeamGridRenderer } from "./TeamGridRenderer";
import { CasesGridRenderer } from "./CasesGridRenderer";
import { PricingTiersRenderer } from "./PricingTiersRenderer";
import { PricingBreakdownRenderer } from "./PricingBreakdownRenderer";
import { TwoColumnSplitRenderer } from "./TwoColumnSplitRenderer";
import { MethodTimelineRenderer } from "./MethodTimelineRenderer";
import { ClosingAcceptanceRenderer } from "./ClosingAcceptanceRenderer";

export const KIND_RENDERERS: Record<SlideKind, React.ComponentType<any>> = {
  cover: CoverRenderer,
  "chapter-divider": ChapterDividerRenderer,
  toc: TocRenderer,
  "stat-grid": StatGridRenderer,
  "card-grid": CardGridRenderer,
  "numbered-rows": NumberedRowsRenderer,
  "timeline-phases": TimelinePhasesRenderer,
  "team-grid": TeamGridRenderer,
  "cases-grid": CasesGridRenderer,
  "pricing-tiers": PricingTiersRenderer,
  "pricing-breakdown": PricingBreakdownRenderer,
  "two-column-split": TwoColumnSplitRenderer,
  "method-timeline": MethodTimelineRenderer,
  "closing-acceptance": ClosingAcceptanceRenderer,
};
