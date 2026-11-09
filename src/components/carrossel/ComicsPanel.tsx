import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Loader2, Plus } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import * as comic from "@/src/services/comic.service";
import { errorMessage } from "@/src/services/carrossel.service";
import type { Series } from "@/src/services/comic.service";

/** Lista de séries de mini-novela HQ; cada uma abre no seu próprio espaço de trabalho (/novelas/:id). */
export function ComicsPanel() {
  const navigate = useNavigate();
  const [series, setSeries] = useState<Series[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    comic.listSeries().then(setSeries).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>;
  if (!series) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Histórias em quadrinhos para o Instagram: você cadastra os personagens, a IA escreve o roteiro, desenha cada quadro mantendo o rosto de cada um e monta as páginas com balões e narração.
        </p>
        <Button onClick={() => navigate("/novelas/nova")}><Plus className="h-4 w-4" /> Nova mini-novela</Button>
      </div>
      {series.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-input py-16 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Você ainda não criou nenhuma mini-novela.</p>
          <Button onClick={() => navigate("/novelas/nova")}><Plus className="h-4 w-4" /> Criar a primeira</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <button key={s.id} type="button" onClick={() => navigate(`/novelas/${s.id}`)} className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50">
              <div className="mb-3 flex gap-1.5">
                {Object.values(s.palette).map((c, i) => <span key={i} className="h-4 w-4 rounded-full border border-white/10" style={{ background: c }} />)}
                <div className="ml-auto flex -space-x-2">
                  {s.characters.filter((c) => c.sheets[0]).slice(0, 4).map((c) => <img key={c.id} src={c.sheets[0]} alt={c.name} className="h-6 w-6 rounded-full border border-card object-cover" />)}
                </div>
              </div>
              <div className="font-display text-sm font-bold">{s.name}</div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.premise || "Sem premissa"}</div>
              <div className="mt-2 text-[11px] text-muted-foreground">{s.characters.length} personagem(ns)</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
