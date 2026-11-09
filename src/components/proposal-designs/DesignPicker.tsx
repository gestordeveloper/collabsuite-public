import { FileText, LayoutTemplate, Newspaper, Check } from "lucide-react";
import type { DesignId } from "@/src/lib/proposal-designs/types";

const OPTIONS: Array<{ id: DesignId; title: string; description: string; icon: React.ReactNode; swatch: string[] }> = [
  {
    id: "classic",
    title: "Clássico",
    description: "5 seções simples (capa, empresa, escopo, valores, agradecimento).",
    icon: <FileText className="h-5 w-5" />,
    swatch: ["#4f46e5", "#64748b"],
  },
  {
    id: "model1",
    title: "Modelo 1",
    description: "Deck completo de 17 slides: capa, diagnóstico, escopo, cronograma, time, cases, investimento e mais.",
    icon: <LayoutTemplate className="h-5 w-5" />,
    swatch: ["#0C4A45", "#7FD3C4"],
  },
  {
    id: "model2",
    title: "Modelo 2",
    description: "Deck editorial de 15 slides, com divisores de capítulo — mesmo conteúdo, narrativa mais longa.",
    icon: <Newspaper className="h-5 w-5" />,
    swatch: ["#146A62", "#F4F1EA"],
  },
];

export function DesignPicker({ value, onSelect }: { value?: DesignId; onSelect: (id: DesignId) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onSelect(opt.id)}
          className={`relative text-left rounded-2xl border-2 p-5 transition-colors ${
            value === opt.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-accent/40"
          }`}
        >
          {value === opt.id && (
            <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3 w-3" />
            </span>
          )}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{opt.icon}</div>
            <span className="font-semibold text-sm">{opt.title}</span>
          </div>
          <div className="flex gap-1.5 mb-3">
            {opt.swatch.map((c, i) => (
              <span key={i} className="h-4 w-4 rounded-full border" style={{ background: c }} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{opt.description}</p>
        </button>
      ))}
    </div>
  );
}
