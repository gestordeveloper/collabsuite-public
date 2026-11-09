import { TextField } from "../fields/TextField";
import { TextAreaField } from "../fields/TextAreaField";
import { RepeatableList } from "../fields/RepeatableList";
import { SlideHeaderFields } from "../fields/SlideHeaderFields";
import type { KindEditorProps } from "./types";
import type { PricingTier, PricingTiersData } from "@/src/lib/proposal-designs/types";
import { Label } from "@/src/components/ui/label";

function FeaturesField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <TextAreaField
      label="Itens incluídos (um por linha)"
      value={(value || []).join("\n")}
      onChange={(v) => onChange(v.split("\n").map((l) => l.trim()).filter(Boolean))}
      rows={4}
    />
  );
}

export function PricingTiersEditor({ header, onHeaderChange, data, onChange }: KindEditorProps<PricingTiersData>) {
  return (
    <div className="space-y-3">
      <SlideHeaderFields header={header} onChange={onHeaderChange} show={{ title: true, intro: true }} />
      <RepeatableList<PricingTier>
        label="Pacotes"
        items={data.tiers}
        onChange={(tiers) => onChange({ ...data, tiers })}
        makeItem={() => ({ name: "", text: "", price: "R$ 0", period: "", features: [] })}
        itemTitle={(it) => it.name || "Novo pacote"}
        renderItem={(it, _i, update) => (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Nome do pacote" value={it.name} onChange={(v) => update({ name: v })} />
              <TextField label="Preço" value={it.price} onChange={(v) => update({ price: v })} />
            </div>
            <TextField label="Descrição curta" value={it.text} onChange={(v) => update({ text: v })} />
            <TextField label="Período (ex: projeto · 6 meses)" value={it.period} onChange={(v) => update({ period: v })} />
            <FeaturesField value={it.features} onChange={(features) => update({ features })} />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!!it.recommended} onChange={(e) => update({ recommended: e.target.checked })} className="h-3.5 w-3.5" />
                Destacar como recomendado
              </label>
              {it.recommended && (
                <div className="flex-1">
                  <TextField label="Rótulo do selo" value={it.badgeLabel || "Recomendado"} onChange={(v) => update({ badgeLabel: v })} />
                </div>
              )}
            </div>
          </div>
        )}
      />
      <div className="border-t pt-3">
        <Label className="text-xs font-semibold mb-2 block">Notas de rodapé</Label>
        <RepeatableList<{ label: string; text: string }>
          label=""
          items={data.footerNotes}
          onChange={(footerNotes) => onChange({ ...data, footerNotes })}
          makeItem={() => ({ label: "", text: "" })}
          itemTitle={(it) => it.label || "Nova nota"}
          renderItem={(it, _i, update) => (
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Rótulo" value={it.label} onChange={(v) => update({ label: v })} />
              <TextField label="Texto" value={it.text} onChange={(v) => update({ text: v })} />
            </div>
          )}
        />
      </div>
    </div>
  );
}
