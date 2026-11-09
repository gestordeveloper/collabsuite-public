import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import type { Episode } from "@/src/services/comic.service";

interface Props {
  episode: Episode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startAt?: number;
}

/** Lê o episódio como o leitor: a página montada (ou só a arte) ao lado do roteiro do quadro. */
export function EpisodeViewer({ episode, open, onOpenChange, startAt = 0 }: Props) {
  const [i, setI] = useState(startAt);
  useEffect(() => { if (open) setI(startAt); }, [open, startAt]);
  const slides = episode.slides;
  const s = slides[Math.min(i, slides.length - 1)];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(slides.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, slides.length]);
  if (!s) return null;
  const img = s.final || s.art;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display">Ep. {String(episode.number).padStart(2, "0")} · {episode.title}</DialogTitle>
          <DialogDescription>Quadro {s.n} de {slides.length}{s.element ? ` · ${s.element}` : ""}. Use as setas do teclado para navegar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr]">
          <div className="aspect-[4/5] overflow-hidden rounded-lg bg-black">
            {img ? <img src={img} alt={`Quadro ${s.n}`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">Este quadro ainda não tem imagem.</div>}
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-[13px]">
            <div className="font-semibold">{s.title}</div>
            {s.narrator && <div><div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Narrador</div><p className="rounded-md border border-input p-2">{s.narrator}</p></div>}
            {s.dialogues.map((d, k) => (
              <div key={k}><div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{d.character}</div><p className="rounded-md bg-secondary p-2">{d.text}</p></div>
            ))}
            {s.action && <div><div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Cena</div><p className="text-muted-foreground">{s.action}</p></div>}
            {s.n === 1 && episode.synopsis && <div><div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Sinopse</div><p className="text-muted-foreground">{episode.synopsis}</p></div>}
            {s.n === slides.length && episode.caption && <div><div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Legenda do post</div><p className="whitespace-pre-wrap text-muted-foreground">{episode.caption}</p></div>}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
          <div className="flex gap-1">{slides.map((x, k) => <button key={x.n} type="button" onClick={() => setI(k)} aria-label={`Quadro ${x.n}`} className={`h-2 w-2 rounded-full ${k === i ? "bg-primary" : "bg-muted-foreground/30"}`} />)}</div>
          <Button variant="outline" size="sm" onClick={() => setI(Math.min(slides.length - 1, i + 1))} disabled={i === slides.length - 1}>Próximo <ChevronRight className="h-4 w-4" /></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
