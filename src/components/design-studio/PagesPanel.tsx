import { Plus, Copy, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useDesignEditorStore } from "@/src/store/design-editor.store";
import { PagePreview } from "./PagePreview";
import type { DesignPage } from "@/src/lib/design-studio/types";
import { cn } from "@/src/lib/utils";

const THUMB_BOX_H = 130;

function PageThumbnail({ page, active, onClick }: { page: DesignPage; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full overflow-hidden rounded-md border-2 bg-muted/20 transition-colors",
        active ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
      )}
      style={{ height: THUMB_BOX_H }}
    >
      <PagePreview page={page} />
    </button>
  );
}

export function PagesPanel() {
  const doc = useDesignEditorStore((s) => s.doc);
  const currentPageId = useDesignEditorStore((s) => s.currentPageId);
  const setCurrentPageId = useDesignEditorStore((s) => s.setCurrentPageId);
  const addPage = useDesignEditorStore((s) => s.addPage);
  const duplicatePage = useDesignEditorStore((s) => s.duplicatePage);
  const removePage = useDesignEditorStore((s) => s.removePage);
  const reorderPages = useDesignEditorStore((s) => s.reorderPages);

  if (!doc) return null;

  return (
    <aside className="flex w-52 flex-shrink-0 flex-col border-r bg-card">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {doc.pages.map((page, idx) => (
          <div key={page.id} className="space-y-1">
            <PageThumbnail
              page={page}
              active={page.id === currentPageId}
              onClick={() => setCurrentPageId(page.id)}
            />
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] text-muted-foreground">Página {idx + 1}</span>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => reorderPages(idx, idx - 1)} title="Mover para cima">
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === doc.pages.length - 1} onClick={() => reorderPages(idx, idx + 1)} title="Mover para baixo">
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicatePage(page.id)} title="Duplicar página">
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  disabled={doc.pages.length <= 1}
                  onClick={() => removePage(page.id)}
                  title="Excluir página"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t p-3">
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={addPage}>
          <Plus className="h-4 w-4" /> Nova página
        </Button>
      </div>
    </aside>
  );
}
