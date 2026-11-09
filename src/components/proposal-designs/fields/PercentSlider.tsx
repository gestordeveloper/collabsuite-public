import { Label } from "@/src/components/ui/label";

interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
}

export function PercentSlider({ label, value, onChange }: Props) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold">{label}</Label>
        <span className="text-[11px] tabular-nums text-muted-foreground">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
