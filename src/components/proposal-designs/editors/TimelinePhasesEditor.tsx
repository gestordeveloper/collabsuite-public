import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { ToneSelect } from "../fields/ToneSelect";
import { PercentSlider } from "../fields/PercentSlider";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { Milestone, TimelinePhase, TimelinePhasesData } from "@/src/lib/proposal-designs/types";

export function TimelinePhasesEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<TimelinePhasesData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <RepeatableList<TimelinePhase>
        label="Fases do cronograma"
        items={data.phases}
        onChange={(phases) => onChange({ ...data, phases })}
        makeItem={() => ({ dateLabel: "", title: "", detail: "", widthPct: 50, offsetPct: 0 })}
        itemTitle={(it) => it.title || "Nova fase"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Período (ex: Mês 1 — 3)" value={it.dateLabel} onChange={(v) => update({ dateLabel: v })} />
              <TextField label="Título da fase" value={it.title} onChange={(v) => update({ title: v })} />
            </div>
            <TextAreaField label="Detalhe" value={it.detail} onChange={(v) => update({ detail: v })} rows={2} />
            <div className="grid grid-cols-2 gap-3">
              <PercentSlider label="Largura da barra" value={it.widthPct} onChange={(widthPct) => update({ widthPct })} />
              <PercentSlider label="Deslocamento da barra" value={it.offsetPct} onChange={(offsetPct) => update({ offsetPct })} />
            </div>
            <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
          </div>
        )}
      />
      <RepeatableList<Milestone>
        label="Marcos (opcional)"
        items={data.milestones || []}
        onChange={(milestones) => onChange({ ...data, milestones })}
        makeItem={() => ({ title: "", text: "" })}
        itemTitle={(it) => it.title || "Novo marco"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <TextField label="Título" value={it.title} onChange={(v) => update({ title: v })} />
            <TextAreaField label="Texto" value={it.text} onChange={(v) => update({ text: v })} rows={2} />
          </div>
        )}
      />
    </div>
  );
}
