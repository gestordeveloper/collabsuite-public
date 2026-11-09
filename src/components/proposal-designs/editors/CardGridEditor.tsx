import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { ToneSelect } from "../fields/ToneSelect";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { CardGridData, CardGridItem } from "@/src/lib/proposal-designs/types";

function BulletsField({ value, onChange }: { value: string[] | undefined; onChange: (v: string[]) => void }) {
  const text = (value || []).join("\n");
  return (
    <TextAreaField
      label="Itens da lista (um por linha, opcional)"
      value={text}
      onChange={(v) => onChange(v.split("\n").map((l) => l.trim()).filter(Boolean))}
      rows={3}
    />
  );
}

export function CardGridEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<CardGridData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true, introQuote: true }} />
      <TextField label="Número de colunas" value={String(data.columns)} onChange={(v) => onChange({ ...data, columns: Number(v) || 1 })} />
      <RepeatableList<CardGridItem>
        label="Cards"
        items={data.cards}
        onChange={(cards) => onChange({ ...data, cards })}
        makeItem={() => ({ title: "", text: "" })}
        itemTitle={(it) => it.title || it.kicker || "Novo card"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Número (opcional)" value={it.number || ""} onChange={(v) => update({ number: v })} />
              <TextField label="Rótulo curto / kicker (opcional)" value={it.kicker || ""} onChange={(v) => update({ kicker: v })} />
            </div>
            <TextField label="Título (opcional)" value={it.title || ""} onChange={(v) => update({ title: v })} />
            <TextAreaField label="Texto (opcional)" value={it.text || ""} onChange={(v) => update({ text: v })} rows={2} />
            <BulletsField value={it.bullets} onChange={(bullets) => update({ bullets })} />
            <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
          </div>
        )}
      />
      <div className="grid grid-cols-2 gap-2 border-t pt-3">
        <TextField label="Rodapé — rótulo (opcional)" value={data.footnote?.label || ""} onChange={(v) => onChange({ ...data, footnote: { label: v, text: data.footnote?.text || "" } })} />
        <TextField label="Rodapé — texto (opcional)" value={data.footnote?.text || ""} onChange={(v) => onChange({ ...data, footnote: { label: data.footnote?.label || "", text: v } })} />
      </div>
    </div>
  );
}
