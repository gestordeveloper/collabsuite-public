import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { PricingBreakdownData, PricingPhaseRow } from "@/src/lib/proposal-designs/types";
import { Label } from "@/src/components/ui/label";

export function PricingBreakdownEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<PricingBreakdownData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <div className="space-y-1">
        <Label className="text-xs font-semibold">Layout</Label>
        <select
          value={data.layout}
          onChange={(e) => onChange({ ...data, layout: e.target.value as PricingBreakdownData["layout"] })}
          className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
        >
          <option value="cards">Cards</option>
          <option value="table">Tabela</option>
        </select>
      </div>
      <TextField label="Título do bloco principal" value={data.mainKicker} onChange={(v) => onChange({ ...data, mainKicker: v })} placeholder="Ex: Projeto de implantação" />
      <RepeatableList<PricingPhaseRow>
        label="Linhas de fase"
        items={data.rows}
        onChange={(rows) => onChange({ ...data, rows })}
        makeItem={() => ({ label: "", price: "R$ 0" })}
        itemTitle={(it) => it.label || "Nova fase"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Rótulo" value={it.label} onChange={(v) => update({ label: v })} />
              <TextField label="Preço" value={it.price} onChange={(v) => update({ price: v })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Detalhe (opcional)" value={it.detail || ""} onChange={(v) => update({ detail: v })} />
              <TextField label="Horas (opcional)" value={it.hours || ""} onChange={(v) => update({ hours: v })} />
            </div>
          </div>
        )}
      />
      <div className="grid grid-cols-2 gap-2 border-t pt-3">
        <TextField label="Total — rótulo (opcional)" value={data.totalLabel || ""} onChange={(v) => onChange({ ...data, totalLabel: v })} />
        <TextField label="Total — horas (opcional)" value={data.totalHours || ""} onChange={(v) => onChange({ ...data, totalHours: v })} />
      </div>
      <TextField label="Total — preço (opcional)" value={data.totalPrice || ""} onChange={(v) => onChange({ ...data, totalPrice: v })} />
      <TextAreaField label="Nota de pagamento" value={data.paymentNote || ""} onChange={(v) => onChange({ ...data, paymentNote: v })} rows={2} />
      <div className="border-t pt-3 space-y-2">
        <Label className="text-xs font-semibold">Card de sustentação mensal</Label>
        <TextField label="Título" value={data.feeKicker} onChange={(v) => onChange({ ...data, feeKicker: v })} />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Preço" value={data.feePrice} onChange={(v) => onChange({ ...data, feePrice: v })} />
          <TextField label="Sufixo (ex: /mês)" value={data.feeSuffix} onChange={(v) => onChange({ ...data, feeSuffix: v })} />
        </div>
        <TextAreaField label="Detalhe" value={data.feeDetail} onChange={(v) => onChange({ ...data, feeDetail: v })} rows={2} />
      </div>
      <div className="border-t pt-3 space-y-2">
        <TextField label="Nota adicional — título (opcional)" value={data.noteTitle || ""} onChange={(v) => onChange({ ...data, noteTitle: v })} />
        <TextAreaField label="Nota adicional — texto (opcional)" value={data.noteText || ""} onChange={(v) => onChange({ ...data, noteText: v })} rows={2} />
      </div>
      <TextField label="Rodapé (opcional)" value={data.footerNote || ""} onChange={(v) => onChange({ ...data, footerNote: v })} />
    </div>
  );
}
