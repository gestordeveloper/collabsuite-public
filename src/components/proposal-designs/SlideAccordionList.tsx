import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { RunningHeaderFields } from "./fields/SlideHeaderFields";
import { KIND_EDITORS } from "./editors";
import { SLIDE_KIND_LABELS } from "@/src/lib/proposal-designs/types";
import type { SlideEnvelope } from "@/src/lib/proposal-designs/types";

interface Props {
  slides: SlideEnvelope[];
  onChange: (slides: SlideEnvelope[]) => void;
  /** 'template' keeps every slide expanded (like the classic PageSection editor).
   *  'override' collapses slides by default (like the classic per-task SectionEditor). */
  mode: "template" | "override";
}

export function SlideAccordionList({ slides, onChange, mode }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function updateSlide(id: string, patch: Partial<SlideEnvelope>) {
    onChange(slides.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  return (
    <div className="space-y-3">
      {slides.map((slide) => {
        const Editor = KIND_EDITORS[slide.kind];
        const expanded = mode === "template" ? true : expandedId === slide.id;
        return (
          <Card key={slide.id} className={!slide.enabled ? "opacity-50" : ""}>
            <CardHeader
              className={`flex flex-row items-center justify-between pb-3 ${mode === "override" ? "cursor-pointer" : ""}`}
              onClick={mode === "override" ? () => setExpandedId(expanded ? null : slide.id) : undefined}
            >
              <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                {slide.label}
                <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wide">{SLIDE_KIND_LABELS[slide.kind]}</span>
              </CardTitle>
              <div className="flex items-center gap-3">
                <label
                  className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={slide.enabled}
                    onChange={(e) => updateSlide(slide.id, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Ativo
                </label>
                {mode === "override" && (expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />)}
              </div>
            </CardHeader>
            {expanded && slide.enabled && (
              <CardContent className="space-y-3 border-t pt-3">
                <RunningHeaderFields value={slide.runningHeader} onChange={(runningHeader) => updateSlide(slide.id, { runningHeader })} />
                {Editor && (
                  <Editor
                    header={slide.header}
                    onHeaderChange={(header: any) => updateSlide(slide.id, { header })}
                    data={slide.data}
                    onChange={(data: any) => updateSlide(slide.id, { data })}
                  />
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
