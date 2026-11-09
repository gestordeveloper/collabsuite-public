import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { ImageField } from "../fields/ImageField";
import { ToneSelect } from "../fields/ToneSelect";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { SplitBlock, TwoColumnSplitData, NumberedRowsData, StatGridData, CardGridData, TeamGridData, NumberedRow, StatCardItem, CardGridItem, TeamMember } from "@/src/lib/proposal-designs/types";
import { Label } from "@/src/components/ui/label";

function BlockBody({ block, onChange }: { block: SplitBlock; onChange: (b: SplitBlock) => void }) {
  if (block.type === "numbered-rows") {
    const data = block.data as NumberedRowsData;
    return (
      <RepeatableList<NumberedRow>
        label="Linhas numeradas"
        items={data.rows}
        onChange={(rows) => onChange({ ...block, data: { rows } })}
        makeItem={() => ({ number: String(data.rows.length + 1).padStart(2, "0"), title: "", text: "" })}
        itemTitle={(it) => it.title || it.text || "Nova linha"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-[70px_1fr] gap-2">
              <TextField label="Número" value={it.number} onChange={(v) => update({ number: v })} />
              <TextField label="Título (opcional)" value={it.title || ""} onChange={(v) => update({ title: v })} />
            </div>
            <TextAreaField label="Texto" value={it.text} onChange={(v) => update({ text: v })} rows={2} />
          </div>
        )}
      />
    );
  }
  if (block.type === "stat-grid") {
    const data = block.data as StatGridData;
    return (
      <>
        <TextField label="Colunas" value={String(data.columns)} onChange={(v) => onChange({ ...block, data: { ...data, columns: Number(v) || 1 } })} />
        <RepeatableList<StatCardItem>
          label="Cards de número"
          items={data.cards}
          onChange={(cards) => onChange({ ...block, data: { ...data, cards } })}
          makeItem={() => ({ value: "0", label: "" })}
          itemTitle={(it) => it.label || "Novo card"}
          renderItem={(it, _i, update) => (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Valor" value={it.value} onChange={(v) => update({ value: v })} />
                <TextField label="Legenda" value={it.label} onChange={(v) => update({ label: v })} />
              </div>
              <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
            </div>
          )}
        />
        <RepeatableList<{ title: string; text: string }>
          label="Notas (opcional)"
          items={data.notes || []}
          onChange={(notes) => onChange({ ...block, data: { ...data, notes } })}
          makeItem={() => ({ title: "", text: "" })}
          itemTitle={(it) => it.title || "Nova nota"}
          renderItem={(it, _i, update) => (
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Título" value={it.title} onChange={(v) => update({ title: v })} />
              <TextField label="Texto" value={it.text} onChange={(v) => update({ text: v })} />
            </div>
          )}
        />
      </>
    );
  }
  if (block.type === "card-grid") {
    const data = block.data as CardGridData;
    return (
      <>
        <TextField label="Colunas" value={String(data.columns)} onChange={(v) => onChange({ ...block, data: { ...data, columns: Number(v) || 1 } })} />
        <RepeatableList<CardGridItem>
          label="Cards"
          items={data.cards}
          onChange={(cards) => onChange({ ...block, data: { ...data, cards } })}
          makeItem={() => ({ title: "", text: "" })}
          itemTitle={(it) => it.title || it.kicker || "Novo card"}
          renderItem={(it, _i, update) => (
            <div className="space-y-2">
              <TextField label="Número (opcional)" value={it.number || ""} onChange={(v) => update({ number: v })} />
              <TextField label="Título (opcional)" value={it.title || ""} onChange={(v) => update({ title: v })} />
              <TextAreaField label="Texto (opcional)" value={it.text || ""} onChange={(v) => update({ text: v })} rows={2} />
              <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
            </div>
          )}
        />
      </>
    );
  }
  // team-grid
  const data = block.data as TeamGridData;
  return (
    <>
      <TextField label="Colunas" value={String(data.columns)} onChange={(v) => onChange({ ...block, data: { ...data, columns: Number(v) || 1 } })} />
      <RepeatableList<TeamMember>
        label="Integrantes"
        items={data.members}
        onChange={(members) => onChange({ ...block, data: { ...data, members } })}
        makeItem={() => ({ name: "", role: "" })}
        itemTitle={(it) => it.name || "Novo integrante"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Nome" value={it.name} onChange={(v) => update({ name: v })} />
              <TextField label="Cargo" value={it.role} onChange={(v) => update({ role: v })} />
            </div>
            <ImageField label="Foto" value={it.photo} onChange={(photo) => update({ photo })} previewClass="h-16 w-16 rounded-full" />
            <ToneSelect value={it.tone} onChange={(tone) => update({ tone })} />
          </div>
        )}
      />
    </>
  );
}

function PanelEditor({ label, block, onChange }: { label: string; block: SplitBlock; onChange: (b: SplitBlock) => void }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <TextField label="Título da coluna" value={block.title} onChange={(v) => onChange({ ...block, title: v })} />
      <BlockBody block={block} onChange={onChange} />
      <TextField label="Nota adicional (opcional)" value={block.noteText || ""} onChange={(v) => onChange({ ...block, noteText: v })} />
    </div>
  );
}

export function TwoColumnSplitEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<TwoColumnSplitData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true }} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PanelEditor label="Coluna esquerda" block={data.left} onChange={(left) => onChange({ ...data, left })} />
        <PanelEditor label="Coluna direita" block={data.right} onChange={(right) => onChange({ ...data, right })} />
      </div>
    </div>
  );
}
