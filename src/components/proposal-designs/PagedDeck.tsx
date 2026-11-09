import { useState } from "react";
import { ChevronLeft, ChevronRight, Printer, Loader2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";

export interface DeckPage {
  id: string;
  render: () => React.ReactNode;
}

interface Props {
  pages: DeckPage[];
  title: string;
  /** Wraps the whole viewer — lets the caller pick a light (classic/A4) or dark (widescreen deck) chrome. */
  variant?: "light" | "dark";
  /** When provided, the "Imprimir / PDF" button calls this instead of window.print() —
   *  used by the widescreen decks to export a PDF whose page size doesn't depend on
   *  the browser's print dialog (paper size / orientation / "fit to page"). */
  onExport?: () => Promise<void> | void;
}

/** Shared prev/next + print chrome for a paginated proposal — used by both the
 *  classic section-based pages and the new design decks. */
export function PagedDeck({ pages, title, variant = "light", onExport }: Props) {
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const totalPages = pages.length;
  const currentPage = pages[page];
  const dark = variant === "dark";

  async function handlePrint() {
    if (!onExport) { window.print(); return; }
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  }
  function handlePrev() { setPage((p) => Math.max(0, p - 1)); }
  function handleNext() { setPage((p) => Math.min(totalPages - 1, p + 1)); }

  return (
    <div className={dark ? "min-h-screen bg-neutral-950 print:bg-white" : "min-h-screen bg-gray-50 print:bg-white"}>
      <div className={`sticky top-0 z-50 backdrop-blur-md border-b print:hidden ${dark ? "bg-neutral-900/80 border-white/10" : "bg-white/80"}`}>
        <div className={`mx-auto px-4 py-3 flex items-center justify-between ${dark ? "max-w-[1600px]" : "max-w-[210mm]"}`}>
          <span className={`text-sm font-semibold ${dark ? "text-white/70" : "text-muted-foreground"}`}>{title}</span>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1 text-sm ${dark ? "text-white/70" : "text-muted-foreground"}`}>
              <Button variant="ghost" size="sm" onClick={handlePrev} disabled={page === 0} className="h-8 w-8 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[60px] text-center font-medium tabular-nums">{page + 1} / {totalPages}</span>
              <Button variant="ghost" size="sm" onClick={handleNext} disabled={page >= totalPages - 1} className="h-8 w-8 p-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className={`h-4 w-px ${dark ? "bg-white/15" : "bg-border"}`} />
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={exporting} className="gap-1.5 h-8 text-xs">
              {exporting ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Gerando PDF...</>
              ) : (
                <><Printer className="h-3.5 w-3.5" /> Imprimir / PDF</>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className={`py-8 print:hidden ${dark ? "max-w-[1600px] mx-auto px-6" : ""}`}>
        {currentPage?.render()}
      </div>

      <div className="hidden print:block">
        {pages.map((p) => <div key={p.id}>{p.render()}</div>)}
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 print:hidden">
        {pages.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setPage(i)}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === page ? "w-6 bg-primary" : dark ? "w-2 bg-white/25 hover:bg-white/40" : "w-2 bg-gray-300 hover:bg-gray-400"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
