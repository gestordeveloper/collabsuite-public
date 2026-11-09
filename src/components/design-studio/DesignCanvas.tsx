import { useEffect, useRef, useState } from "react";
import Moveable from "react-moveable";
import Selecto from "react-selecto";
import { useDesignEditorStore } from "@/src/store/design-editor.store";
import { DesignElementRenderer } from "./DesignElementRenderer";
import { editorBackgroundCss } from "@/src/lib/design-studio/types";
import { cn } from "@/src/lib/utils";

const CANVAS_PADDING = 64; // matches the outer container's p-8 (32px on each side)
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA";
}

/** Scale that shows the whole page inside the available area — used as the default view and
 *  whenever the page (or its size) changes, so switching pages or resizing never leaves the
 *  canvas showing only part of (or a tiny sliver of) the page. */
function computeFitScale(containerWidth: number, containerHeight: number, pageWidth: number, pageHeight: number): number {
  const availW = Math.max(containerWidth - CANVAS_PADDING, 50);
  const availH = Math.max(containerHeight - CANVAS_PADDING, 50);
  return Math.min(availW / pageWidth, availH / pageHeight, MAX_ZOOM);
}

export function DesignCanvas() {
  const doc = useDesignEditorStore((s) => s.doc);
  const currentPageId = useDesignEditorStore((s) => s.currentPageId);
  const selectedElementIds = useDesignEditorStore((s) => s.selectedElementIds);
  const selectElements = useDesignEditorStore((s) => s.selectElements);
  const updateElement = useDesignEditorStore((s) => s.updateElement);
  const removeElements = useDesignEditorStore((s) => s.removeElements);
  const snapshot = useDesignEditorStore((s) => s.snapshot);
  const undo = useDesignEditorStore((s) => s.undo);
  const redo = useDesignEditorStore((s) => s.redo);

  const outerRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const elRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasManualZoomRef = useRef(false);

  const [scale, setScale] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  const page = doc?.pages.find((p) => p.id === currentPageId) ?? null;

  // Always show the whole page whenever it (or its size) changes — a custom page size
  // shouldn't leave the canvas zoomed into whatever scale the previous page happened to use.
  useEffect(() => {
    hasManualZoomRef.current = false;
    const el = outerRef.current;
    if (!el || !page) return;
    const rect = el.getBoundingClientRect();
    setScale(computeFitScale(rect.width, rect.height, page.width, page.height));
  }, [page?.id, page?.width, page?.height]);

  // Keep re-fitting on container resize, but only until the user takes over with the wheel.
  useEffect(() => {
    const el = outerRef.current;
    if (!el || !page) return;
    const ro = new ResizeObserver((entries) => {
      if (hasManualZoomRef.current) return;
      const rect = entries[0]?.contentRect;
      if (rect) setScale(computeFitScale(rect.width, rect.height, page.width, page.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page?.width, page?.height, page?.id]);

  // Mouse-wheel zoom, anchored at the cursor (CorelDraw/Figma-style) — attached as a native,
  // non-passive listener because React's onWheel can't reliably preventDefault the page scroll.
  useEffect(() => {
    const container = outerRef.current;
    if (!container || !page) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const artboard = artboardRef.current;
      if (!container || !artboard || !page) return;

      const oldScale = scale;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newScale = Math.min(Math.max(oldScale * factor, MIN_ZOOM), MAX_ZOOM);
      if (newScale === oldScale) return;

      hasManualZoomRef.current = true;

      const containerRect = container.getBoundingClientRect();
      const artboardRect = artboard.getBoundingClientRect();

      // Cursor position in unscaled page units, and where the artboard currently sits
      // within the scrollable content — both measured before the scale change.
      const pageX = (e.clientX - artboardRect.left) / oldScale;
      const pageY = (e.clientY - artboardRect.top) / oldScale;
      const artboardContentLeft = artboardRect.left - containerRect.left + container.scrollLeft;
      const artboardContentTop = artboardRect.top - containerRect.top + container.scrollTop;

      // The artboard is horizontally/vertically centered (mx-auto) whenever it fits the
      // container, so its offset shifts by half the size delta — this keeps the point under
      // the cursor pinned in that (common) case without having to re-measure after the resize.
      const deltaW = page.width * newScale - page.width * oldScale;
      const deltaH = page.height * newScale - page.height * oldScale;
      const newArtboardContentLeft = artboardContentLeft - deltaW / 2;
      const newArtboardContentTop = artboardContentTop - deltaH / 2;

      const cursorOffsetX = e.clientX - containerRect.left;
      const cursorOffsetY = e.clientY - containerRect.top;
      const newScrollLeft = newArtboardContentLeft + pageX * newScale - cursorOffsetX;
      const newScrollTop = newArtboardContentTop + pageY * newScale - cursorOffsetY;

      setScale(newScale);
      requestAnimationFrame(() => {
        container.scrollLeft = newScrollLeft;
        container.scrollTop = newScrollTop;
      });
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [scale, page?.id, page?.width, page?.height]);

  // Keyboard shortcuts: delete/backspace removes selection, ctrl+z/ctrl+shift+z undo/redo.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(document.activeElement) || editingId) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedElementIds.length && page) {
        e.preventDefault();
        removeElements(page.id, selectedElementIds);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (page && selectedElementIds.length === 1) {
        const step = e.shiftKey ? 10 : 1;
        const el = page.elements.find((it) => it.id === selectedElementIds[0]);
        if (!el) return;
        if (e.key === "ArrowUp") { e.preventDefault(); updateElement(page.id, el.id, { y: el.y - step }); }
        else if (e.key === "ArrowDown") { e.preventDefault(); updateElement(page.id, el.id, { y: el.y + step }); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); updateElement(page.id, el.id, { x: el.x - step }); }
        else if (e.key === "ArrowRight") { e.preventDefault(); updateElement(page.id, el.id, { x: el.x + step }); }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedElementIds, page, editingId, removeElements, undo, redo, updateElement]);

  if (!doc || !page) return null;

  const target = !editingId && selectedElementIds.length === 1 ? elRefs.current[selectedElementIds[0]] ?? null : null;
  const canTransform = selectedElementIds.length === 1;

  return (
    <div ref={outerRef} className="relative h-full w-full overflow-auto bg-muted/30 p-8">
      <div
        ref={artboardRef}
        className="relative mx-auto overflow-hidden rounded-sm shadow-xl"
        style={{ width: page.width * scale, height: page.height * scale }}
      >
        <div
          className="relative origin-top-left"
          style={{ width: page.width, height: page.height, transform: `scale(${scale})`, ...editorBackgroundCss(page.background) }}
        >
          {[...page.elements]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((el) => (
              <div
                key={el.id}
                ref={(node) => { elRefs.current[el.id] = node; }}
                data-el-id={el.id}
                className={cn(
                  "ds-element absolute",
                  selectedElementIds.includes(el.id) && !editingId && "outline outline-2 outline-primary/70 outline-offset-2"
                )}
                style={{
                  left: el.x,
                  top: el.y,
                  width: el.width,
                  height: el.height,
                  transform: `rotate(${el.rotation}deg)`,
                  zIndex: el.zIndex,
                  opacity: el.opacity ?? 1,
                }}
                onDoubleClick={() => {
                  if (el.kind === "text" && editingId !== el.id) {
                    snapshot();
                    setEditingId(el.id);
                  }
                }}
              >
                <DesignElementRenderer
                  element={el}
                  editing={editingId === el.id}
                  onCommitText={(text) => updateElement(page.id, el.id, { text })}
                  onStopEditing={() => setEditingId(null)}
                />
              </div>
            ))}
        </div>
      </div>

      <Selecto
        ref={selectoRef}
        dragContainer={outerRef.current || undefined}
        selectableTargets={[".ds-element"]}
        hitRate={0}
        selectByClick
        selectFromInside={false}
        toggleContinueSelect={["shift"]}
        onDragStart={(e) => {
          const clicked = e.inputEvent.target as Element;
          if (
            moveableRef.current?.isMoveableElement(clicked) ||
            selectedElementIds.some((id) => elRefs.current[id]?.contains(clicked))
          ) {
            e.stop();
          }
        }}
        onSelectEnd={(e) => {
          const ids = e.selected
            .map((node) => (node as HTMLElement).dataset.elId)
            .filter((v): v is string => !!v);
          selectElements(ids);
          setEditingId(null);
          if (e.isDragStart) {
            e.inputEvent.preventDefault();
            moveableRef.current?.waitToChangeTarget().then(() => {
              moveableRef.current?.dragStart(e.inputEvent);
            });
          }
        }}
      />

      {target && (
        <Moveable
          ref={moveableRef}
          target={target}
          draggable
          resizable={canTransform}
          rotatable={canTransform}
          throttleDrag={0}
          throttleResize={0}
          throttleRotate={0}
          origin={false}
          onDragStart={() => snapshot()}
          onDrag={({ target, left, top }) => {
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
          }}
          onDragEnd={({ target, lastEvent }) => {
            if (!lastEvent) return;
            const id = (target as HTMLElement).dataset.elId!;
            updateElement(page.id, id, { x: lastEvent.left, y: lastEvent.top });
          }}
          onResizeStart={() => snapshot()}
          onResize={({ target, width, height, drag }) => {
            target.style.width = `${width}px`;
            target.style.height = `${height}px`;
            target.style.left = `${drag.left}px`;
            target.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target, lastEvent }) => {
            if (!lastEvent) return;
            const id = (target as HTMLElement).dataset.elId!;
            updateElement(page.id, id, {
              width: lastEvent.width,
              height: lastEvent.height,
              x: lastEvent.drag.left,
              y: lastEvent.drag.top,
            });
          }}
          onRotateStart={() => snapshot()}
          onRotate={({ target, transform }) => {
            target.style.transform = transform;
          }}
          onRotateEnd={({ target, lastEvent }) => {
            if (!lastEvent) return;
            const id = (target as HTMLElement).dataset.elId!;
            updateElement(page.id, id, { rotation: lastEvent.rotation });
          }}
        />
      )}
    </div>
  );
}
