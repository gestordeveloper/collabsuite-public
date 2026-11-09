import { createElement } from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { KIND_RENDERERS } from "@/src/components/proposal-designs/renderers";
import { proxyImageUrl } from "@/src/services/upload.service";
import type { SlideEnvelope, ThemeTokens } from "./types";

const DESIGN_W = 1920;
const DESIGN_H = 1080;

// jsPDF's `unit: "px"` does not map 1:1 to CSS pixels (it applies its own,
// non-standard scale factor) — using `pt` with an explicit 96dpi conversion
// (1px = 0.75pt) is the reliable way to get an exact physical page size.
const PAGE_W_PT = DESIGN_W * 0.75;
const PAGE_H_PT = DESIGN_H * 0.75;

async function waitForImages(container: HTMLElement) {
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      })
    )
  );
}

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * html2canvas rasterizes each <img> by reading its pixels into a canvas, which the browser only
 * allows for a cross-origin image (our uploads live on S3) if that host sends CORS headers — the
 * bucket doesn't, so those images silently render blank in the exported PDF even though they
 * display fine as normal <img> tags on screen. Routing them through our own backend proxy makes
 * them same-origin, sidestepping the restriction.
 */
function rewriteCrossOriginImages(container: HTMLElement) {
  const imgs = Array.from(container.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.getAttribute("src");
    if (!src) continue;
    let absolute: URL;
    try {
      absolute = new URL(src, window.location.href);
    } catch {
      continue;
    }
    if (absolute.origin === window.location.origin) continue;
    img.crossOrigin = "anonymous";
    img.src = proxyImageUrl(absolute.href);
  }
}

/**
 * Renders every enabled slide off-screen at its native 1920×1080 size,
 * rasterizes each with html2canvas, and assembles a PDF whose pages are
 * exactly that size — so the export doesn't depend on the browser's print
 * dialog (paper size, orientation, "fit to page") to get proportions right.
 */
export async function exportDeckToPdf(
  slides: SlideEnvelope[],
  theme: ThemeTokens,
  filename: string,
  onProgress?: (done: number, total: number) => void
) {
  const enabled = slides.filter((s) => s.enabled);
  if (enabled.length === 0) return;

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${DESIGN_W}px`;
  host.style.height = `${DESIGN_H}px`;
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  const root = createRoot(host);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_W_PT, PAGE_H_PT], compress: true });

  try {
    for (let i = 0; i < enabled.length; i++) {
      const slide = enabled[i];
      const Renderer = KIND_RENDERERS[slide.kind];
      if (!Renderer) continue;

      await new Promise<void>((resolve) => {
        root.render(
          createElement(Renderer, {
            data: slide.data,
            header: slide.header,
            tone: slide.tone,
            runningHeader: slide.runningHeader,
            theme,
          })
        );
        resolve();
      });
      await nextPaint();
      rewriteCrossOriginImages(host);
      await waitForImages(host);

      const canvas = await html2canvas(host, {
        width: DESIGN_W,
        height: DESIGN_H,
        scale: 1,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);

      if (i > 0) doc.addPage([PAGE_W_PT, PAGE_H_PT], "landscape");
      doc.addImage(imgData, "JPEG", 0, 0, PAGE_W_PT, PAGE_H_PT);

      onProgress?.(i + 1, enabled.length);
    }
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }

  doc.save(filename);
}
