import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MenuBar, type SaveState } from "@/src/components/photosuite/MenuBar";
import { OptionsBar } from "@/src/components/photosuite/OptionsBar";
import { SidePanels } from "@/src/components/photosuite/SidePanels";
import { Toolbox } from "@/src/components/photosuite/Toolbox";
import { useShortcuts } from "@/src/components/photosuite/useShortcuts";
import { Viewport } from "@/src/components/photosuite/Viewport";
import { LayerStyleDialog } from "@/src/components/photosuite/LayerStyleDialog";
import { ShareDialog } from "@/src/components/photosuite/ShareDialog";
import { cloneCanvas, createCanvas, hasDirty } from "@/src/lib/photosuite/engine";
import { getClip } from "@/src/lib/photosuite/selection";
import { OPEN_ACCEPT, exportDocumentAs, kindOf, readFile, EXPORT_EXT, type VectorExportFormat } from "@/src/lib/photosuite/formats";
import { downloadBlob, exportImage, fileToCanvas, hasUnsavedChanges, markClean, openDocument, saveDocument, type ExportFormat } from "@/src/lib/photosuite/session";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { TooltipProvider } from "@/src/components/ui/tooltip";

const AUTOSAVE_MS = 2500;

export function PhotosuiteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const docId = usePhotosuite((s) => s.docId);
  const changes = usePhotosuite((s) => s.changes);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  /** avisos de importação/exportação (o que não foi possível trazer ou gravar fielmente) */
  const [notice, setNotice] = useState<{ title: string; items: string[] } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    openDocument(Number(id))
      .then(() => {
        if (cancelled) return;
        markClean();
        try {
          const raw = sessionStorage.getItem(`photosuite-warnings-${id}`);
          if (raw) {
            sessionStorage.removeItem(`photosuite-warnings-${id}`);
            setNotice({ title: "Arquivo aberto com avisos", items: JSON.parse(raw) });
          }
        } catch {
          /* sem avisos */
        }
        // Um documento novo traz o fundo como `fill`, que ainda não existe como PNG no servidor.
        if (hasDirty()) void save();
      })
      .catch((err) => {
        console.error("Falha ao abrir documento", err);
        if (!cancelled) setError(err?.response?.data?.error || err?.message || "Falha ao abrir o documento");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      usePhotosuite.getState().reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      await saveDocument();
      setSaveState(hasUnsavedChanges() ? "dirty" : "saved");
    } catch (err) {
      console.error("Falha ao salvar", err);
      setSaveState("error");
    }
  }, []);

  // Autosave com debounce a cada alteração.
  useEffect(() => {
    if (loading || docId == null || !hasUnsavedChanges()) return;
    setSaveState((s) => (s === "saving" ? s : "dirty"));
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [changes, loading, docId, save]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges() || hasDirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useShortcuts({ onSave: () => void save() });

  /** Coloca uma imagem como nova camada, reduzida para caber e centralizada. */
  const placeImage = useCallback(async (blob: Blob, name: string) => {
    try {
      const src = await fileToCanvas(blob);
      const { width, height } = usePhotosuite.getState();
      // Veio de Copiar/Recortar aqui dentro? Então volta para onde estava (como no Photoshop).
      const clip = getClip();
      if (name === "Colado" && clip && clip.canvas.width === src.width && clip.canvas.height === src.height) {
        usePhotosuite.getState().addLayerFromCanvas(src, "Colado", clip.x, clip.y);
        return;
      }
      let canvas = src;
      const scale = Math.min(1, width / src.width, height / src.height);
      if (scale < 1) {
        canvas = createCanvas(Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      }
      usePhotosuite.getState().addLayerFromCanvas(canvas, name.replace(/\.[^.]+$/, "") || "Imagem", Math.round((width - canvas.width) / 2), Math.round((height - canvas.height) / 2));
    } catch (err) {
      console.error("Falha ao inserir imagem", err);
      alert("Não foi possível ler essa imagem.");
    }
  }, []);

  // Colar imagem da área de transferência
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void placeImage(file, "Colado");
        return;
      }
      // Sem imagem no clipboard do sistema (escrita bloqueada): usa o recorte interno.
      const clip = getClip();
      if (clip && !e.clipboardData?.types.includes("text/plain")) {
        e.preventDefault();
        usePhotosuite.getState().addLayerFromCanvas(cloneCanvas(clip.canvas), "Colado", clip.x, clip.y);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [placeImage]);

  /** Insere um arquivo no documento: imagens entram redimensionadas; PSD/SVG/.photosuite trazem as camadas. */
  const insertFile = useCallback(async (file: File) => {
    if (kindOf(file) === "image") return placeImage(file, file.name);
    try {
      const result = await readFile(file);
      usePhotosuite.getState().insertImport(result);
      if (result.warnings.length) setNotice({ title: `${file.name}: avisos`, items: result.warnings });
    } catch (err: any) {
      alert(err?.message || "Não foi possível abrir o arquivo.");
    }
  }, [placeImage]);

  async function handleExport(format: ExportFormat | VectorExportFormat) {
    try {
      if (format === "psd" || format === "svg" || format === "photosuite") {
        const s = usePhotosuite.getState();
        const { blob, warnings } = await exportDocumentAs(format, { name: s.name, width: s.width, height: s.height, layers: s.layers, globalLight: s.globalLight });
        const base = (s.name || "photosuite").replace(/[\\/:*?"<>|]+/g, "-");
        downloadBlob(blob, `${base}.${EXPORT_EXT[format]}`);
        if (warnings.length) setNotice({ title: `Exportado como ${format.toUpperCase()} com avisos`, items: warnings });
        return;
      }
      const blob = await exportImage(format);
      const name = (usePhotosuite.getState().name || "photosuite").replace(/[\\/:*?"<>|]+/g, "-");
      downloadBlob(blob, `${name}.${format === "jpeg" ? "jpg" : format}`);
    } catch (err) {
      console.error("Falha ao exportar", err);
      alert("Falha ao exportar a imagem.");
    }
  }

  async function handleBack() {
    if (hasUnsavedChanges() || hasDirty()) await save();
    navigate("/photosuite");
  }

  if (loading || error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        {error ? (
          <>
            <p className="text-destructive">{error}</p>
            <button className="underline" onClick={() => navigate("/photosuite")}>
              Voltar para documentos
            </button>
          </>
        ) : (
          "Carregando documento…"
        )}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <MenuBar
          onBack={() => void handleBack()}
          onSave={() => void save()}
          onExport={(f) => void handleExport(f)}
          onOpenImage={() => fileInput.current?.click()}
          onShare={() => setShareOpen(true)}
          saveState={saveState}
        />
        <OptionsBar />
        <div className="flex min-h-0 flex-1">
          <Toolbox />
          <main
            className="relative min-w-0 flex-1"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              setDragOver(false);
              const files = [...e.dataTransfer.files].filter((f) => kindOf(f));
              if (!files.length) return;
              e.preventDefault();
              files.forEach((f) => void insertFile(f));
            }}
          >
            <Viewport />
            {dragOver && (
              <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-sm font-medium">
                Solte a imagem para inserir como camada
              </div>
            )}
          </main>
          <SidePanels />
        </div>
        <LayerStyleDialog />
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} onBeforeShare={save} />
        <input
          ref={fileInput}
          type="file"
          accept={OPEN_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            [...(e.target.files ?? [])].forEach((f) => void insertFile(f));
            e.target.value = "";
          }}
        />
        {notice && (
          <div role="status" className="fixed bottom-4 left-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold">{notice.title}</div>
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setNotice(null)}>Fechar</button>
            </div>
            <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-muted-foreground">
              {notice.items.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
