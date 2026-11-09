import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as designService from "@/src/services/design.service";
import * as customFontService from "@/src/services/custom-font.service";
import { exportDesignToPdf, exportPageToImage } from "@/src/lib/design-studio/design-pdf-export";
import { useDesignEditorStore } from "@/src/store/design-editor.store";
import { Toolbar, type ExportFormat } from "@/src/components/design-studio/Toolbar";
import { PagesPanel } from "@/src/components/design-studio/PagesPanel";
import { DesignCanvas } from "@/src/components/design-studio/DesignCanvas";
import { PropertiesPanel } from "@/src/components/design-studio/PropertiesPanel";

export function DesignEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const doc = useDesignEditorStore((s) => s.doc);
  const loadDesign = useDesignEditorStore((s) => s.loadDesign);
  const setCustomFonts = useDesignEditorStore((s) => s.setCustomFonts);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstLoad = useRef(true);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    isFirstLoad.current = true;
    Promise.all([
      designService.getDesign(Number(id)),
      customFontService.listCustomFonts().catch(() => []),
    ])
      .then(([design, fonts]) => {
        setCustomFonts(fonts);
        loadDesign(design);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Autosave the working document whenever its pages change (debounced), mirroring
  // the pattern used by other task templates (ProposalConfig, WhiteboardTemplate).
  useEffect(() => {
    if (!doc || loading) return;
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      setSaving(true);
      designService
        .updateDesign(doc.id, { name: doc.name, pages: JSON.stringify(doc.pages) })
        .catch((err) => console.error("Falha ao salvar design", err))
        .finally(() => setSaving(false));
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [doc, loading]);

  // Flush a still-pending debounced save on true unmount (e.g. hitting "Voltar" or navigating
  // away right after typing) — without this, edits made in the last ~700ms before leaving the
  // page were silently discarded: the timer above got cleared by its own cleanup, but nothing
  // ever sent that final save. This effect's cleanup only runs on unmount (empty deps), unlike
  // the one above which also reruns on every keystroke, so it won't fire a save on every edit.
  useEffect(() => {
    return () => {
      if (saveTimer.current && docRef.current) {
        clearTimeout(saveTimer.current);
        const pending = docRef.current;
        designService
          .updateDesign(pending.id, { name: pending.name, pages: JSON.stringify(pending.pages) })
          .catch((err) => console.error("Falha ao salvar design ao sair", err));
      }
    };
  }, []);

  function handleRename(name: string) {
    useDesignEditorStore.setState((s) => (s.doc ? { doc: { ...s.doc, name } } : s));
  }

  async function handleExport(format: ExportFormat) {
    if (!doc) return;
    const baseName = doc.name || "design";
    if (format === "pdf") {
      await exportDesignToPdf(doc.pages, `${baseName}.pdf`);
      return;
    }
    const { currentPageId } = useDesignEditorStore.getState();
    const page = doc.pages.find((p) => p.id === currentPageId) ?? doc.pages[0];
    if (!page) return;
    await exportPageToImage(page, format, `${baseName}.${format}`);
  }

  if (loading || !doc) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando design...
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar
        name={doc.name}
        onRename={handleRename}
        onBack={() => navigate("/designs")}
        onExport={handleExport}
        saving={saving}
      />
      <div className="flex flex-1 overflow-hidden">
        <PagesPanel />
        <DesignCanvas />
        <PropertiesPanel />
      </div>
    </div>
  );
}
