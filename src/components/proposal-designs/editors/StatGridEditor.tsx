import { TextField } from "../fields/TextField";
import { ImageField } from "../fields/ImageField";
import { ToneSelect } from "../fields/ToneSelect";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { StatCardItem, StatGridData } from "@/src/lib/proposal-designs/types";

export function StatGridEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<StatGridData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <TextField label="Número de colunas" value={String(data.columns)} onChange={(v) => onChange({ ...data, columns: Number(v) || 1 })} />
      <RepeatableList<StatCardItem>
        label="Cards de número"
        items={data.cards}
        onChange={(cards) => onChange({ ...data, cards })}
        makeItem={() => ({ value: "0", label: "" })}
        itemTitle={(it) => it.label || "Novo card"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Valor (número)" value={it.value} onChange={(v) => update({ value: v })} />
              <TextField label="Legenda" value={it.label} onChange={(v) => update({ label: v })} />
            </div>
            <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
          </div>
        )}
      />
      <ImageField label="Imagem (opcional)" value={data.image} onChange={(img) => onChange({ ...data, image: img })} previewClass="h-24 w-full" />
      <RepeatableList<{ title: string; text: string }>
        label="Notas adicionais (opcional)"
        items={data.notes || []}
        onChange={(notes) => onChange({ ...data, notes })}
        makeItem={() => ({ title: "", text: "" })}
        itemTitle={(it) => it.title || "Nova nota"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <TextField label="Título" value={it.title} onChange={(v) => update({ title: v })} />
            <TextField label="Texto" value={it.text} onChange={(v) => update({ text: v })} />
          </div>
        )}
      />
    </div>
  );
}
