import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { NumberedRow, NumberedRowsData } from "@/src/lib/proposal-designs/types";

export function NumberedRowsEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<NumberedRowsData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <RepeatableList<NumberedRow>
        label="Linhas numeradas"
        items={data.rows}
        onChange={(rows) => onChange({ ...data, rows })}
        makeItem={() => ({ number: String(data.rows.length + 1).padStart(2, "0"), title: "", text: "" })}
        itemTitle={(it) => it.title || "Nova linha"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <TextField label="Número" value={it.number} onChange={(v) => update({ number: v })} />
              <TextField label="Título (opcional)" value={it.title || ""} onChange={(v) => update({ title: v })} />
            </div>
            <TextAreaField label="Texto" value={it.text} onChange={(v) => update({ text: v })} rows={2} />
            <TextAreaField label="Texto de resultado (opcional)" value={it.resultText || ""} onChange={(v) => update({ resultText: v })} rows={2} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Estatística — valor (opcional)" value={it.statValue || ""} onChange={(v) => update({ statValue: v })} />
              <TextField label="Estatística — legenda (opcional)" value={it.statLabel || ""} onChange={(v) => update({ statLabel: v })} />
            </div>
          </div>
        )}
      />
    </div>
  );
}
