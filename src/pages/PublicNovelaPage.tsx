import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, BadgeCheck, Check, ChevronLeft, ChevronRight, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";

interface PublicEpisode {
  series_name: string;
  number: number;
  title: string;
  slides: { n: number; image: string }[];
  approved_at: string | null;
  approved_by: string | null;
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Página pública: o cliente passa os quadros da mini-novela um a um e aprova (sem roteiro nem textos internos). */
export function PublicNovelaPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicEpisode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    fetch(`/api/public/novela/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Link inválido ou desativado.");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);

  const count = data?.slides.length ?? 0;
  const prev = useCallback(() => setI((x) => Math.max(0, x - 1)), []);
  const next = useCallback(() => setI((x) => Math.min(count - 1, x + 1)), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  async function handleApproval(approved: boolean) {
    if (approving) return;
    setApproving(true);
    try {
      const r = await fetch(`/api/public/novela/${token}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      alert("Não foi possível registrar a aprovação. Tente novamente.");
    } finally {
      setApproving(false);
    }
  }

  if (error) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-destructive/30 bg-destructive/10 p-8">
        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
        <h2 className="mb-1 text-lg font-semibold">Link indisponível</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    </div>
  );
  if (!data) return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const slide = data.slides[Math.min(i, count - 1)];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-xl space-y-4 px-4 py-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{data.series_name}</p>
          <h1 className="font-display text-2xl font-bold leading-tight">Ep. {String(data.number).padStart(2, "0")}{data.title ? ` · ${data.title}` : ""}</h1>
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${data.approved_at ? "border-emerald-500/30 bg-emerald-500/10" : "border-border bg-card"}`}>
          <div className="flex items-center gap-3">
            <BadgeCheck className={`h-6 w-6 ${data.approved_at ? "text-emerald-500" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-semibold">{data.approved_at ? "Episódio aprovado" : "Aguardando sua aprovação"}</p>
              <p className="text-xs text-muted-foreground">
                {data.approved_at ? `Por ${data.approved_by ?? "Cliente"} em ${fmt(data.approved_at)}` : "Passe pelos quadros e aprove quando estiver tudo certo."}
              </p>
            </div>
          </div>
          {data.approved_at ? (
            <Button variant="outline" size="sm" className="gap-2" disabled={approving} onClick={() => handleApproval(false)}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Desfazer aprovação
            </Button>
          ) : (
            <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={approving} onClick={() => handleApproval(true)}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Aprovar
            </Button>
          )}
        </div>

        {slide ? (
          <>
            <div className="aspect-[4/5] overflow-hidden rounded-xl bg-black">
              <img src={slide.image} alt={`Quadro ${slide.n}`} className="h-full w-full object-contain" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" onClick={prev} disabled={i === 0}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
              <span className="text-xs text-muted-foreground">Quadro {i + 1} de {count}</span>
              <Button variant="outline" size="sm" onClick={next} disabled={i === count - 1}>Próximo <ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="flex justify-center gap-1.5">
              {data.slides.map((s, k) => (
                <button key={s.n} type="button" onClick={() => setI(k)} aria-label={`Quadro ${s.n}`} className={`h-2 w-2 rounded-full ${k === i ? "bg-primary" : "bg-muted-foreground/30"}`} />
              ))}
            </div>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Este episódio ainda não tem quadros desenhados.</p>
        )}
      </main>
    </div>
  );
}
