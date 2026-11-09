import { TextField } from "../fields/TextField";
import { ImageField } from "../fields/ImageField";
import { ToneSelect } from "../fields/ToneSelect";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { TeamGridData, TeamMember } from "@/src/lib/proposal-designs/types";

export function TeamGridEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<TeamGridData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <TextField label="Número de colunas" value={String(data.columns)} onChange={(v) => onChange({ ...data, columns: Number(v) || 1 })} />
      <RepeatableList<TeamMember>
        label="Integrantes do time"
        items={data.members}
        onChange={(members) => onChange({ ...data, members })}
        makeItem={() => ({ name: "", role: "" })}
        itemTitle={(it) => it.name || "Novo integrante"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Nome" value={it.name} onChange={(v) => update({ name: v })} />
              <TextField label="Cargo" value={it.role} onChange={(v) => update({ role: v })} />
            </div>
            <ImageField label="Foto" value={it.photo} onChange={(photo) => update({ photo })} previewClass="h-20 w-20 rounded-full" />
            <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
          </div>
        )}
      />
      <TextField label="Nota adicional (opcional)" value={data.noteText || ""} onChange={(v) => onChange({ ...data, noteText: v })} />
    </div>
  );
}
