import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { ImageField } from "../fields/ImageField";
import type { KindEditorProps } from "./types";
import type { ChapterDividerData } from "@/src/lib/proposal-designs/types";

export function ChapterDividerEditor({ data, onChange }: KindEditorProps<ChapterDividerData>) {
  return (
    <div className="space-y-3">
      <TextField label="Texto de destaque (kicker)" value={data.kicker} onChange={(v) => onChange({ ...data, kicker: v })} placeholder="Ex: Capítulo 01" />
      <TextAreaField label="Título" value={data.title} onChange={(v) => onChange({ ...data, title: v })} rows={2} hint="Use uma quebra de linha para dividir em duas linhas." />
      <TextAreaField label="Texto de apoio" value={data.body} onChange={(v) => onChange({ ...data, body: v })} rows={3} />
      <ImageField label="Imagem" value={data.image} onChange={(img) => onChange({ ...data, image: img })} previewClass="h-24 w-full" />
    </div>
  );
}
