import { useEffect, useRef, useState } from "react";

const DESIGN_W = 1920;
const DESIGN_H = 1080;

/**
 * Scales a fixed 1920×1080 slide (authored with literal px values, like the
 * reference decks) down to fit the available width, preserving aspect ratio —
 * the same technique models_proposals/deck-stage.js uses for its `.canvas`.
 */
export function SlideCanvas({ children, className }: { children: React.ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setScale(width / DESIGN_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      className={`proposal-deck-canvas relative w-full overflow-hidden rounded-2xl shadow-lg ${className || ""}`}
      style={{ aspectRatio: `${DESIGN_W} / ${DESIGN_H}` }}
    >
      <div
        className="proposal-deck-page"
        style={{
          position: "absolute", top: 0, left: 0, width: DESIGN_W, height: DESIGN_H,
          transform: `scale(${scale})`, transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
