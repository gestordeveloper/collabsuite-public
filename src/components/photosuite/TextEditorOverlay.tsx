import { useEffect, useRef } from "react";
import { findLayer } from "@/src/lib/photosuite/tree";
import { TEXT_PAD, leadingOf } from "@/src/lib/photosuite/text";
import { cleanFamilyName } from "@/src/lib/design-studio/fonts";
import { usePhotosuite } from "@/src/store/photosuite.store";

/**
 * Editor de texto no próprio documento: um <textarea> transparente por cima da camada, com a mesma
 * fonte e escala. O canvas por baixo mostra o texto renderizado de verdade; o textarea só fornece
 * cursor, seleção e digitação. Cada tecla atualiza a camada (um único passo de histórico por rajada).
 */
export function TextEditorOverlay() {
  const edit = usePhotosuite((s) => s.textEdit);
  const layers = usePhotosuite((s) => s.layers);
  const view = usePhotosuite((s) => s.view);
  const setText = usePhotosuite((s) => s.setText);
  const finish = usePhotosuite((s) => s.finishTextEdit);
  const ref = useRef<HTMLTextAreaElement>(null);

  const layer = edit ? findLayer(layers, edit.id)?.layer : null;
  const text = layer && layer.type === "raster" ? layer.text : undefined;

  // foco ao abrir (e cursor no fim)
  useEffect(() => {
    if (!edit) return;
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, [edit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!edit || !layer || layer.type !== "raster" || !text) return null;

  const z = view.zoom;
  const lead = leadingOf(text) * z;
  const boxW = text.box ? text.box.w * z : Math.max(layer.width * z, 60) + 40;
  const boxH = text.box ? Math.max(text.box.h * z, lead) : Math.max(layer.height * z, lead) + 8;

  return (
    <textarea
      ref={ref}
      value={text.text}
      spellCheck={false}
      onChange={(e) => setText(layer.id, { text: e.target.value }, { label: "Texto", coalesce: `text-${layer.id}` })}
      onBlur={() => finish()}
      onKeyDown={(e) => {
        e.stopPropagation(); // atalhos do editor não valem enquanto se digita
        if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
          e.preventDefault();
          finish();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="absolute resize-none overflow-hidden border border-dashed border-primary/70 bg-transparent p-0 outline-none"
      style={{
        left: view.x + (layer.x + TEXT_PAD) * z,
        top: view.y + (layer.y + TEXT_PAD) * z,
        width: boxW,
        height: boxH,
        fontFamily: `"${cleanFamilyName(text.family)}", sans-serif`,
        fontSize: text.size * z,
        fontWeight: text.weight,
        fontStyle: text.italic ? "italic" : "normal",
        lineHeight: `${lead}px`,
        letterSpacing: `${((text.tracking / 1000) * text.size) * z}px`,
        textAlign: text.align === "justify" ? "justify" : text.align,
        whiteSpace: text.box ? "pre-wrap" : "pre",
        // o texto real é o do canvas; aqui só o cursor aparece
        color: "transparent",
        caretColor: text.color,
        WebkitTextFillColor: "transparent",
      }}
    />
  );
}
