import { useEffect, useRef } from "react";
import type { DesignElement, TextElement } from "@/src/lib/design-studio/types";
import { SHAPE_CLIP_PATHS, frameToClipPath } from "@/src/lib/design-studio/types";
import { ensureFontLoaded, fontFamilyCss } from "@/src/lib/design-studio/fonts";
import { DESIGN_ICONS } from "@/src/lib/design-studio/icons";

interface Props {
  element: DesignElement;
  editing?: boolean;
  onCommitText?: (text: string) => void;
  onStopEditing?: () => void;
}

/**
 * Uncontrolled by design: the div's text is set imperatively once on mount and never
 * re-rendered from `element.text` afterwards. Every keystroke's `onInput` commits the new
 * text up to the store, which re-renders this component with an updated `element` prop —
 * if the JSX children were `{element.text}`, React would reconcile the text node on every
 * one of those re-renders and reset the caret to position 0, so each new character would
 * get inserted *before* the previous one (the text comes out reversed). Keeping the DOM as
 * the sole source of truth for the text content (only `style` stays reactive) avoids that.
 */
function EditableText({ element, onCommitText, onStopEditing }: {
  element: TextElement;
  onCommitText?: (text: string) => void;
  onStopEditing?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initialText = useRef(element.text);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initialText.current;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="h-full w-full outline-none"
      style={{
        fontFamily: fontFamilyCss(element.fontFamily),
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        fontStyle: element.italic ? "italic" : "normal",
        textDecoration: element.underline ? "underline" : "none",
        color: element.color,
        textAlign: element.align,
        cursor: "text",
      }}
      onInput={(e) => onCommitText?.(e.currentTarget.textContent || "")}
      onBlur={(e) => {
        onCommitText?.(e.currentTarget.textContent || "");
        onStopEditing?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur();
        e.stopPropagation();
      }}
    />
  );
}

/**
 * Pure visual rendering of one element's *content* — the caller is responsible
 * for the absolutely-positioned/rotated wrapper (see DesignCanvas), since that
 * wrapper is also the DOM node react-moveable targets directly.
 */
export function DesignElementRenderer({ element, editing = false, onCommitText, onStopEditing }: Props) {
  const textFontFamily = element.kind === "text" ? element.fontFamily : undefined;
  useEffect(() => {
    if (textFontFamily) ensureFontLoaded(textFontFamily);
  }, [textFontFamily]);

  switch (element.kind) {
    case "text":
      return editing ? (
        <EditableText element={element} onCommitText={onCommitText} onStopEditing={onStopEditing} />
      ) : (
        <div
          className="h-full w-full select-none whitespace-pre-wrap break-words"
          style={{
            fontFamily: fontFamilyCss(element.fontFamily),
            fontSize: element.fontSize,
            fontWeight: element.fontWeight,
            fontStyle: element.italic ? "italic" : "normal",
            textDecoration: element.underline ? "underline" : "none",
            color: element.color,
            textAlign: element.align,
          }}
        >
          {element.text}
        </div>
      );

    case "image":
      return element.url ? (
        <img
          src={element.url}
          alt=""
          draggable={false}
          className="h-full w-full select-none"
          style={{
            objectFit: element.objectFit,
            borderRadius: element.frame ? undefined : element.borderRadius,
            clipPath: frameToClipPath(element.frame),
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed bg-muted/30 text-xs text-muted-foreground">
          Sem imagem
        </div>
      );

    case "shape": {
      if (element.shape === "line") {
        return <div className="h-full w-full" style={{ backgroundColor: element.fill, borderRadius: element.borderRadius }} />;
      }
      if (element.shape === "rect" || element.shape === "ellipse") {
        return (
          <div
            className="h-full w-full"
            style={{
              backgroundColor: element.fill,
              border: element.strokeWidth ? `${element.strokeWidth}px solid ${element.stroke || "transparent"}` : undefined,
              borderRadius: element.shape === "ellipse" ? "9999px" : element.borderRadius,
            }}
          />
        );
      }
      // Polygon shapes (triangle, star, arrows, speech-bubble, ...) — clip-path can't
      // follow a CSS border, so these are fill-only (no stroke/border-radius controls).
      return <div className="h-full w-full" style={{ backgroundColor: element.fill, clipPath: SHAPE_CLIP_PATHS[element.shape] }} />;
    }

    case "icon": {
      const Icon = DESIGN_ICONS[element.name] || DESIGN_ICONS.Star;
      return (
        <div className="flex h-full w-full items-center justify-center">
          <Icon color={element.color} style={{ width: "100%", height: "100%" }} strokeWidth={1.5} />
        </div>
      );
    }

    default:
      return null;
  }
}
