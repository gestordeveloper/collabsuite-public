import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, TriangleAlert, LayoutGrid, Sparkles, ListVideo, Scissors, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { studioxService } from "@/src/services/studiox.service";
import { cn } from "@/src/lib/utils";

type Phase = "starting" | "ready" | "error";

/** As telas do StudioX; a navegação delas mora aqui para o editor herdar o menu e o tema do CollabSuite. */
const TABS: { page: string; label: string; icon: LucideIcon }[] = [
  { page: "", label: "Projetos", icon: LayoutGrid },
  { page: "clips.html", label: "Cortes com IA", icon: Sparkles },
  { page: "queue.html", label: "Fila de edição", icon: ListVideo },
  { page: "editor.html", label: "Editor", icon: Scissors },
  { page: "settings.html", label: "Configurações", icon: SlidersHorizontal },
];

const pageOf = (pathname: string) => pathname.replace(/^\/studiox\/?/, "").replace(/^index\.html$/, "");

/** Editor de vídeo (StudioX): app próprio servido em /studiox, embutido aqui para herdar o login do CollabSuite. */
export function VideoEditorPage() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState("");
  const [current, setCurrent] = useState("editor.html");
  const frame = useRef<HTMLIFrameElement>(null);

  const start = useCallback(async () => {
    setPhase("starting");
    try {
      await studioxService.openSession();
      setPhase("ready");
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Não foi possível abrir o editor.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void start();
    // o cookie dura 12h; renova enquanto a página fica aberta
    const timer = setInterval(() => { void studioxService.openSession().catch(() => {}); }, 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [start]);

  // Links dentro do editor ("Abrir no editor"...) também mudam a aba ativa.
  const syncTab = () => {
    try {
      const loc = frame.current?.contentWindow?.location;
      if (loc) setCurrent(pageOf(loc.pathname));
    } catch { /* fora do mesmo domínio */ }
  };

  if (phase !== "ready") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        {phase === "starting" ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Iniciando o editor de vídeo… na primeira vez pode levar alguns segundos.</p>
          </>
        ) : (
          <>
            <TriangleAlert className="h-6 w-6 text-destructive" />
            <p className="max-w-xl text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => void start()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <RefreshCw className="h-4 w-4" /> Tentar de novo
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-1.5" aria-label="Telas do editor de vídeo">
        {TABS.map(({ page, label, icon: Icon }) => (
          <button
            key={page || "projetos"}
            onClick={() => frame.current?.contentWindow?.location.assign(`/studiox/${page}`)}
            aria-current={current === page ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              current === page ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("h-4 w-4", current === page && "text-primary")} />
            {label}
          </button>
        ))}
      </nav>
      <iframe
        ref={frame}
        title="Editor de vídeo"
        src="/studiox/editor.html"
        onLoad={syncTab}
        className="min-h-0 w-full flex-1 border-0 bg-background"
        allow="fullscreen; clipboard-read; clipboard-write; autoplay"
      />
    </div>
  );
}
