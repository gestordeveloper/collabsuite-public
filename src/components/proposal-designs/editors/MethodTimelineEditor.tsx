import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { ToneSelect } from "../fields/ToneSelect";
import { PercentSlider } from "../fields/PercentSlider";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { CardGridItem, MethodTimelineData, TimelinePhase } from "@/src/lib/proposal-designs/types";
import { Label } from "@/src/components/ui/label";

export function MethodTimelineEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<MethodTimelineData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <Label className="text-xs font-semibold block">Etapas do método</Label>
      <RepeatableList<CardGridItem>
        label=""
        items={data.steps}
        onChange={(steps) => onChange({ ...data, steps })}
        makeItem={() => ({ number: String(data.steps.length + 1).padStart(2, "0"), title: "", text: "" })}
        itemTitle={(it) => it.title || "Nova etapa"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-[70px_1fr] gap-2">
              <TextField label="Número" value={it.number || ""} onChange={(v) => update({ number: v })} />
              <TextField label="Título" value={it.title || ""} onChange={(v) => update({ title: v })} />
            </div>
            <TextAreaField label="Texto" value={it.text || ""} onChange={(v) => update({ text: v })} rows={2} />
            <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
          </div>
        )}
      />
      <div className="border-t pt-3">
        <Label className="text-xs font-semibold block mb-2">Fases do cronograma</Label>
        <RepeatableList<TimelinePhase>
          label=""
          items={data.phases}
          onChange={(phases) => onChange({ ...data, phases })}
          makeItem={() => ({ dateLabel: "", title: "", detail: "", widthPct: 50, offsetPct: 0 })}
          itemTitle={(it) => it.title || "Nova fase"}
          renderItem={(it, _i, update) => (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Período" value={it.dateLabel} onChange={(v) => update({ dateLabel: v })} />
                <TextField label="Título" value={it.title} onChange={(v) => update({ title: v })} />
              </div>
              <TextAreaField label="Detalhe" value={it.detail} onChange={(v) => update({ detail: v })} rows={2} />
              <div className="grid grid-cols-2 gap-3">
                <PercentSlider label="Largura" value={it.widthPct} onChange={(widthPct) => update({ widthPct })} />
                <PercentSlider label="Deslocamento" value={it.offsetPct} onChange={(offsetPct) => update({ offsetPct })} />
              </div>
              <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
            </div>
          )}
        />
      </div>
    </div>
  );
}
