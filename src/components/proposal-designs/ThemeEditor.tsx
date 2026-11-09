import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { ImageUpload } from "@/src/components/common/ImageUpload";
import type { ThemeTokens } from "@/src/lib/proposal-designs/types";

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="flex gap-2 items-center">
        <Input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-16 h-11 p-1" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
      </div>
    </div>
  );
}

export function ThemeEditor({ theme, onChange }: { theme: ThemeTokens; onChange: (t: ThemeTokens) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Cores e marca</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Nome da empresa</Label>
            <Input value={theme.companyName} onChange={(e) => onChange({ ...theme, companyName: e.target.value })} />
          </div>
          <ImageUpload
            label="Logo"
            value={theme.logoUrl}
            onChange={(url) => onChange({ ...theme, logoUrl: url })}
            previewClass="h-12 w-12"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorField label="Cor principal (fundos escuros)" value={theme.primaryColor} onChange={(v) => onChange({ ...theme, primaryColor: v })} />
          <ColorField label="Cor secundária" value={theme.midColor} onChange={(v) => onChange({ ...theme, midColor: v })} />
          <ColorField label="Cor de destaque" value={theme.accentColor} onChange={(v) => onChange({ ...theme, accentColor: v })} />
          <ColorField label="Cor de fundo clara (cards)" value={theme.lightColor} onChange={(v) => onChange({ ...theme, lightColor: v })} />
        </div>
      </CardContent>
    </Card>
  );
}
