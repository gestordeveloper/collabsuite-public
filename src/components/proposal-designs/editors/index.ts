import type { SlideKind } from "@/src/lib/proposal-designs/types";
import { CoverEditor } from "./CoverEditor";
import { ChapterDividerEditor } from "./ChapterDividerEditor";
import { TocEditor } from "./TocEditor";
import { StatGridEditor } from "./StatGridEditor";
import { CardGridEditor } from "./CardGridEditor";
import { NumberedRowsEditor } from "./NumberedRowsEditor";
import { TimelinePhasesEditor } from "./TimelinePhasesEditor";
import { TeamGridEditor } from "./TeamGridEditor";
import { CasesGridEditor } from "./CasesGridEditor";
import { PricingTiersEditor } from "./PricingTiersEditor";
import { PricingBreakdownEditor } from "./PricingBreakdownEditor";
import { TwoColumnSplitEditor } from "./TwoColumnSplitEditor";
import { MethodTimelineEditor } from "./MethodTimelineEditor";
import { ClosingAcceptanceEditor } from "./ClosingAcceptanceEditor";

export const KIND_EDITORS: Record<SlideKind, React.ComponentType<any>> = {
  cover: CoverEditor,
  "chapter-divider": ChapterDividerEditor,
  toc: TocEditor,
  "stat-grid": StatGridEditor,
  "card-grid": CardGridEditor,
  "numbered-rows": NumberedRowsEditor,
  "timeline-phases": TimelinePhasesEditor,
  "team-grid": TeamGridEditor,
  "cases-grid": CasesGridEditor,
  "pricing-tiers": PricingTiersEditor,
  "pricing-breakdown": PricingBreakdownEditor,
  "two-column-split": TwoColumnSplitEditor,
  "method-timeline": MethodTimelineEditor,
  "closing-acceptance": ClosingAcceptanceEditor,
};
