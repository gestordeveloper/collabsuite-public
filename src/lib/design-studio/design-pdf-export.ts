import { createElement } from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { DesignElementRenderer } from "@/src/components/design-studio/DesignElementRenderer";
import { proxyImageUrl } from "@/src/services/upload.service";
import { backgroundToCss, type DesignPage } from "./types";

// jsPDF's `unit: "px"` does not map 1:1 to CSS pixels — using `pt` with an
// explicit 96dpi conversion (1px = 0.75pt) gives an exact physical page size.
const PX_TO_PT = 0.75;

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
 * html2canvas rasterizes each <img> by reading its pixels, which the browser only allows
 * for cross-origin images (our uploads live on S3) if that host sends CORS headers — it
 * doesn't, so those images render blank in the export. Routing them through our own
 * backend proxy makes them same-origin, sidestepping the restriction.
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

function renderPageMarkup(page: DesignPage) {
  return createElement(
    "div",
    { style: { position: "relative", width: "100%", height: "100%", ...backgroundToCss(page.background) } },
    [...page.elements]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((el) =>
        createElement(
          "div",
          {
            key: el.id,
            style: {
              position: "absolute",
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              transform: `rotate(${el.rotation}deg)`,
              opacity: el.opacity ?? 1,
            },
          },
          createElement(DesignElementRenderer, { element: el })
        )
      )
  );
}

/**
 * Renders every page off-screen at its own native size (pages in a design
 * can each have a different size/orientation), rasterizes each with
 * html2canvas, and assembles a PDF whose pages match those sizes exactly.
 */
export async function exportDesignToPdf(
  pages: DesignPage[],
  filename: string,
  onProgress?: (done: number, total: number) => void
) {
  if (pages.length === 0) return;

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  const root = createRoot(host);

  let doc: jsPDF | null = null;

  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageWpt = page.width * PX_TO_PT;
      const pageHpt = page.height * PX_TO_PT;
      const orientation = page.width >= page.height ? "landscape" : "portrait";

      host.style.width = `${page.width}px`;
      host.style.height = `${page.height}px`;

      await new Promise<void>((resolve) => {
        root.render(renderPageMarkup(page));
        resolve();
      });
      await nextPaint();
      rewriteCrossOriginImages(host);
      await waitForImages(host);
      // Custom/Google fonts are requested lazily (see DesignElementRenderer's ensureFontLoaded
      // effect, which only fires once this page's text is actually mounted above) — wait for
      // them here so html2canvas doesn't rasterize a fallback font while they're still fetching.
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const canvas = await html2canvas(host, {
        width: page.width,
        height: page.height,
        scale: 1,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);

      if (!doc) {
        doc = new jsPDF({ orientation, unit: "pt", format: [pageWpt, pageHpt], compress: true });
      } else {
        doc.addPage([pageWpt, pageHpt], orientation);
      }
      doc.addImage(imgData, "JPEG", 0, 0, pageWpt, pageHpt);

      onProgress?.(i + 1, pages.length);
    }
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }

  doc?.save(filename);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Rasterizes a single page as a PNG or JPEG and triggers a browser download. PNG keeps a
 * transparent background when the page's own background is set to "transparent" — JPEG can't
 * represent alpha at all, so it always gets a white backdrop regardless of the page's setting.
 */
export async function exportPageToImage(page: DesignPage, format: "png" | "jpg", filename: string) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.overflow = "hidden";
  host.style.width = `${page.width}px`;
  host.style.height = `${page.height}px`;
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    await new Promise<void>((resolve) => {
      root.render(renderPageMarkup(page));
      resolve();
    });
    await nextPaint();
    rewriteCrossOriginImages(host);
    await waitForImages(host);
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const isTransparentPng = format === "png" && page.background.type === "transparent";
    const canvas = await html2canvas(host, {
      width: page.width,
      height: page.height,
      scale: 1,
      backgroundColor: isTransparentPng ? null : "#ffffff",
      useCORS: true,
      logging: false,
    });

    const dataUrl = format === "png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.95);
    downloadDataUrl(dataUrl, filename);
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}
