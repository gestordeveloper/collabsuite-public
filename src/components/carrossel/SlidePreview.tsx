import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import * as service from "@/src/services/carrossel.service";
import type { SlideData } from "@/src/services/carrossel.service";

interface Props {
  brandbookId: string;
  slide: SlideData;
  total: number;
  isSingle: boolean;
  /** Largura em px que o slide (1080 de base) ocupa na tela; "fluid" ocupa a largura do contêiner pai. */
  width: number | "fluid";
  className?: string;
  /** Toca a animação de entrada do slide em loop. */
  animated?: boolean;
  /** Atraso antes de pedir a prévia ao servidor (digitação rápida não dispara uma requisição por tecla). */
  debounceMs?: number;
}

const SLIDE_W = 1080;
const SLIDE_H = 1350;

/** Prévia fiel do slide: o servidor monta o mesmo HTML que será renderizado na exportação. */
export function SlidePreview({ brandbookId, slide, total, isSingle, width, className, animated = false, debounceMs = 350 }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(260);
  const key = JSON.stringify([brandbookId, slide, total, isSingle, animated]);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      service
        .previewSlideHtml(brandbookId, slide, total, isSingle, animated)
        .then((h) => {
          if (mine !== seq.current) return;
          setHtml(h);
          setError(null);
        })
        .catch((e) => mine === seq.current && setError(service.errorMessage(e, "Não foi possível montar a prévia.")));
    }, html === null ? 0 : debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (width !== "fluid" || !wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setMeasured(el.clientWidth || 260));
    setMeasured(el.clientWidth || 260);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const w = width === "fluid" ? measured : width;
  const scale = w / SLIDE_W;
  return (
    <div
      ref={wrapRef}
      className={cn("relative overflow-hidden rounded-lg bg-black", className)}
      style={width === "fluid" ? { width: "100%", aspectRatio: "1080 / 1350" } : { width, height: SLIDE_H * scale }}
    >
      {html !== null && (
        <iframe
          title={`Slide ${slide.index}`}
          srcDoc={html}
          sandbox="allow-scripts"
          scrolling="no"
          className="pointer-events-none absolute left-0 top-0 border-0"
          style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
      )}
      {html === null && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-destructive">{error}</div>}
    </div>
  );
}
