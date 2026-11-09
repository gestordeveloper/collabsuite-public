import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { ImageField } from "../fields/ImageField";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { CaseItem, CasesGridData } from "@/src/lib/proposal-designs/types";
import { Label } from "@/src/components/ui/label";

export function CasesGridEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<CasesGridData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <div className="space-y-1">
        <Label className="text-xs font-semibold">Layout</Label>
        <select
          value={data.layout}
          onChange={(e) => onChange({ ...data, layout: e.target.value as CasesGridData["layout"] })}
          className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
        >
          <option value="image-top">Imagem em cima</option>
          <option value="image-left">Imagem à esquerda</option>
        </select>
      </div>
      <RepeatableList<CaseItem>
        label="Cases"
        items={data.cases}
        onChange={(cases) => onChange({ ...data, cases })}
        makeItem={() => ({ title: "", text: "", stats: [] })}
        itemTitle={(it) => it.title || "Novo case"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <ImageField label="Imagem" value={it.image} onChange={(image) => update({ image })} previewClass="h-24 w-full" />
            <TextField label="Título" value={it.title} onChange={(v) => update({ title: v })} />
            <TextAreaField label="Texto" value={it.text} onChange={(v) => update({ text: v })} rows={2} />
            <RepeatableList<{ value: string; label: string }>
              label="Estatísticas do case"
              items={it.stats}
              onChange={(stats) => update({ stats })}
              makeItem={() => ({ value: "0", label: "" })}
              itemTitle={(s) => s.label || "Nova estatística"}
              renderItem={(s, _si, supdate) => (
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Valor" value={s.value} onChange={(v) => supdate({ value: v })} />
                  <TextField label="Legenda" value={s.label} onChange={(v) => supdate({ label: v })} />
                </div>
              )}
            />
          </div>
        )}
      />
    </div>
  );
}
