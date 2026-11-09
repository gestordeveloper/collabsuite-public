import { useEffect, useRef, useState } from "react";
import { DesignElementRenderer } from "./DesignElementRenderer";
import { editorBackgroundCss, type DesignPage } from "@/src/lib/design-studio/types";
import { cn } from "@/src/lib/utils";

interface Props {
  page: DesignPage;
  className?: string;
}

/**
 * Fits `page` into whatever box the parent gives this component, preserving aspect ratio and
 * centering it — shared by the editor's page-thumbnails sidebar and the Designs gallery cards.
 */
export function PagePreview({ page, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setScale(Math.min(rect.width / page.width, rect.height / page.height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.width, page.height]);

  return (
    <div ref={containerRef} className={cn("relative flex h-full w-full items-center justify-center overflow-hidden", className)}>
      {scale > 0 && (
        <div className="relative overflow-hidden shadow-sm" style={{ width: page.width * scale, height: page.height * scale }}>
          <div
            className="pointer-events-none absolute left-0 top-0 origin-top-left"
            style={{ width: page.width, height: page.height, transform: `scale(${scale})`, ...editorBackgroundCss(page.background) }}
          >
            {[...page.elements]
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((el) => (
                <div
                  key={el.id}
                  className="absolute"
                  style={{ left: el.x, top: el.y, width: el.width, height: el.height, transform: `rotate(${el.rotation}deg)`, opacity: el.opacity ?? 1 }}
                >
                  <DesignElementRenderer element={el} />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
