import { useEffect } from "react";
import { usePhotosuite, type Tool } from "@/src/store/photosuite.store";
import { findLayer } from "@/src/lib/photosuite/tree";

const TOOL_KEYS: Record<string, Tool> = { v: "move", l: "lasso", w: "wand", c: "crop", b: "brush", e: "eraser", s: "clone", i: "eyedropper", h: "hand", z: "zoom", t: "text", p: "pen", a: "direct", u: "shape" };
/** Teclas que alternam entre ferramentas do mesmo grupo com Shift (como no Photoshop). */
const CYCLES: Record<string, Tool[]> = { m: ["marquee", "ellipse"], g: ["gradient", "bucket"] };

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "INPUT") {
    // sliders, caixas e seletores de cor não consomem teclas de atalho
    const type = (el as HTMLInputElement).type;
    return !["range", "checkbox", "radio", "color", "button"].includes(type);
  }
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** Atalhos de teclado do PhotoCraft/Photoshop. */
export function useShortcuts({ onSave }: { onSave: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      const s = usePhotosuite.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Edição modal (transformação livre / recorte)
      if (key === "enter") {
        if (s.transform) {
          e.preventDefault();
          return s.commitTransform();
        }
        if (s.crop) {
          e.preventDefault();
          return s.commitCrop();
        }
      }
      if (key === "escape") {
        if (s.transform) return s.cancelTransform();
        if (s.crop) return s.setCrop(null);
      }

      if (mod) {
        if (key === "z") {
          e.preventDefault();
          return e.shiftKey ? s.redo() : s.undo();
        }
        if (key === "y") {
          e.preventDefault();
          return s.redo();
        }
        if (key === "s") {
          e.preventDefault();
          return onSave();
        }
        if (key === "a") {
          e.preventDefault();
          return s.selectAll();
        }
        if (key === "d") {
          e.preventDefault();
          return s.deselect();
        }
        if (key === "i" && e.shiftKey) {
          e.preventDefault();
          return s.invertSelection();
        }
        if (key === "t") {
          e.preventDefault();
          return s.startTransform();
        }
        if (key === "c") {
          e.preventDefault();
          return s.copySelection({ merged: e.shiftKey, cut: false });
        }
        if (key === "x") {
          e.preventDefault();
          return s.copySelection({ merged: false, cut: true });
        }
        if (key === "j") {
          e.preventDefault();
          return s.layerViaCopy(e.shiftKey);
        }
        if (key === "backspace") {
          e.preventDefault();
          return s.fillSelection("bg");
        }
        if (key === "n" && e.shiftKey) {
          e.preventDefault();
          s.addLayer();
          return;
        }
        if (key === "g") {
          e.preventDefault();
          if (e.shiftKey) {
            const a = s.activeId ? findLayer(s.layers, s.activeId)?.layer : null;
            if (a?.type === "group") s.ungroup(a.id);
          } else {
            s.groupSelected();
          }
          return;
        }
        if (key === "e") {
          e.preventDefault();
          return e.shiftKey && e.altKey ? s.stampVisible() : s.mergeDown();
        }
        if (key === "0") {
          e.preventDefault();
          return s.requestView("fit");
        }
        if (key === "1") {
          e.preventDefault();
          return s.requestView("actual");
        }
        if (key === "=" || key === "+") {
          e.preventDefault();
          return s.requestView("in");
        }
        if (key === "-") {
          e.preventDefault();
          return s.requestView("out");
        }
        return;
      }

      if (e.altKey && key === "backspace") {
        e.preventDefault();
        return s.fillSelection("fg");
      }
      if (e.altKey) return;

      // Delete: com âncoras selecionadas exclui os pontos; com seleção apaga os pixels; senão exclui a camada
      if ((key === "delete" || key === "backspace") && s.tool === "direct" && s.anchorSel?.items.length) {
        e.preventDefault();
        return s.deleteAnchors();
      }
      if (key === "delete" || key === "backspace") {
        e.preventDefault();
        return s.hasSelection ? s.clearSelection() : s.deleteSelected();
      }
      if (key === "x") return s.swapColors();
      if (key === "d") return s.resetColors();
      if (key === "[" || key === "]") {
        const { size } = s.brush;
        const step = size < 10 ? 1 : size < 50 ? 5 : size < 200 ? 10 : 25;
        s.setBrush({ size: Math.min(500, Math.max(1, size + (key === "]" ? step : -step))) });
        return;
      }
      // 1..9 = 10%..90%, 0 = 100% (opacidade da camada ativa)
      if (/^[0-9]$/.test(key) && s.activeId) {
        s.updateLayer(s.activeId, { opacity: key === "0" ? 1 : Number(key) / 10 }, { label: "Opacidade da camada", coalesce: `opacity-${s.activeId}` });
        return;
      }
      const cycle = CYCLES[key];
      if (cycle) {
        const i = cycle.indexOf(s.tool);
        s.setTool(i >= 0 ? (e.shiftKey ? cycle[(i + 1) % cycle.length] : s.tool) : cycle[0]);
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool) s.setTool(tool);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSave]);
}
