import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { ImageField } from "../fields/ImageField";
import { RepeatableList } from "../fields/RepeatableList";
import type { KindEditorProps } from "./types";
import type { CoverData } from "@/src/lib/proposal-designs/types";
import { Label } from "@/src/components/ui/label";

const LAYOUTS: Array<{ value: CoverData["layout"]; label: string }> = [
  { value: "hero-right", label: "Imagem à direita" },
  { value: "full-bleed-right", label: "Imagem vertical à direita" },
  { value: "panorama-bottom", label: "Imagem larga embaixo" },
];

export function CoverEditor({ data, onChange }: KindEditorProps<CoverData>) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs font-semibold">Layout da capa</Label>
        <select
          value={data.layout}
          onChange={(e) => onChange({ ...data, layout: e.target.value as CoverData["layout"] })}
          className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
        >
          {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>
      <TextField label="Texto de destaque (kicker)" value={data.kicker} onChange={(v) => onChange({ ...data, kicker: v })} />
      <TextAreaField label="Título principal" value={data.headline} onChange={(v) => onChange({ ...data, headline: v })} rows={2} hint="Use uma quebra de linha para dividir em duas linhas." />
      <TextField label="Trecho do título em destaque (opcional)" value={data.headlineHighlight || ""} onChange={(v) => onChange({ ...data, headlineHighlight: v })} placeholder="Um trecho do título acima para colorir com a cor de destaque" />
      <TextAreaField label="Texto de apoio" value={data.body} onChange={(v) => onChange({ ...data, body: v })} rows={3} />
      <ImageField label="Imagem" value={data.image} onChange={(img) => onChange({ ...data, image: img })} previewClass="h-28 w-full" />
      <RepeatableList<{ label: string; value: string }>
        label="Linhas de rodapé (responsável, validade, etc.)"
        items={data.footerRows}
        onChange={(footerRows) => onChange({ ...data, footerRows })}
        makeItem={() => ({ label: "", value: "" })}
        itemTitle={(it) => it.label || "Nova linha"}
        renderItem={(it, _i, update) => (
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Rótulo" value={it.label} onChange={(v) => update({ label: v })} />
            <TextField label="Valor" value={it.value} onChange={(v) => update({ value: v })} />
          </div>
        )}
      />
    </div>
  );
}
