import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { RepeatableList } from "../fields/RepeatableList";
import type { KindEditorProps } from "./types";
import type { ClosingAcceptanceData, Signer } from "@/src/lib/proposal-designs/types";
import { Label } from "@/src/components/ui/label";

export function ClosingAcceptanceEditor({ data, onChange }: KindEditorProps<ClosingAcceptanceData>) {
  return (
    <div className="space-y-3">
      <TextAreaField label="Título" value={data.title} onChange={(v) => onChange({ ...data, title: v })} rows={2} hint="Use uma quebra de linha para dividir em duas linhas." />
      <RepeatableList<{ number: string; text: string }>
        label="Próximos passos"
        items={data.steps}
        onChange={(steps) => onChange({ ...data, steps })}
        makeItem={() => ({ number: String(data.steps.length + 1), text: "" })}
        itemTitle={(it) => it.text || "Novo passo"}
        renderItem={(it, _i, update) => (
          <div className="grid grid-cols-[70px_1fr] gap-2">
            <TextField label="Número" value={it.number} onChange={(v) => update({ number: v })} />
            <TextField label="Texto" value={it.text} onChange={(v) => update({ text: v })} />
          </div>
        )}
      />
      <TextField label="Contato de rodapé (opcional)" value={data.footerContact || ""} onChange={(v) => onChange({ ...data, footerContact: v })} />
      <div className="border-t pt-3 space-y-2">
        <Label className="text-xs font-semibold">Card de aceite</Label>
        <TextField label="Título" value={data.acceptanceKicker} onChange={(v) => onChange({ ...data, acceptanceKicker: v })} />
        <TextAreaField label="Texto" value={data.acceptanceText} onChange={(v) => onChange({ ...data, acceptanceText: v })} rows={3} />
        <RepeatableList<Signer>
          label="Assinaturas"
          items={data.signers}
          onChange={(signers) => onChange({ ...data, signers })}
          makeItem={() => ({ party: "", detail: "" })}
          itemTitle={(it) => it.party || "Novo signatário"}
          renderItem={(it, _i, update) => (
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Parte" value={it.party} onChange={(v) => update({ party: v })} />
              <TextField label="Detalhe" value={it.detail} onChange={(v) => update({ detail: v })} />
            </div>
          )}
        />
        <TextField label="Nota de rodapé do card (opcional)" value={data.footerNote || ""} onChange={(v) => onChange({ ...data, footerNote: v })} />
      </div>
    </div>
  );
}
