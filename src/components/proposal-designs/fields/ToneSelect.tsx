import { Label } from "@/src/components/ui/label";
import type { CardTone } from "@/src/lib/proposal-designs/types";

const TONE_OPTIONS: Array<{ value: CardTone | ""; label: string }> = [
  { value: "", label: "Padrão" },
  { value: "dark", label: "Escuro" },
  { value: "mid", label: "Médio" },
  { value: "light", label: "Claro" },
  { value: "accent", label: "Destaque" },
  { value: "outline", label: "Contorno" },
];

interface Props {
  label?: string;
  value: CardTone | undefined;
  onChange: (v: CardTone | undefined) => void;
}

export function ToneSelect({ label = "Cor do card", value, onChange }: Props) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold">{label}</Label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as CardTone | undefined)}
        className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {TONE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
