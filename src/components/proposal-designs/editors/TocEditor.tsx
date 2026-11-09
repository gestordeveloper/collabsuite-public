import { TextField } from "../fields/TextField";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { TocData } from "@/src/lib/proposal-designs/types";

export function TocEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<TocData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true }} />
      <RepeatableList<{ number: string; label: string }>
        label="Itens do sumário"
        items={data.items}
        onChange={(items) => onChange({ ...data, items })}
        makeItem={() => ({ number: String(data.items.length + 1).padStart(2, "0"), label: "" })}
        itemTitle={(it) => it.label || "Novo item"}
        renderItem={(it, _i, update) => (
          <div className="grid grid-cols-[80px_1fr] gap-2">
            <TextField label="Número" value={it.number} onChange={(v) => update({ number: v })} />
            <TextField label="Texto" value={it.label} onChange={(v) => update({ label: v })} />
          </div>
        )}
      />
    </div>
  );
}
