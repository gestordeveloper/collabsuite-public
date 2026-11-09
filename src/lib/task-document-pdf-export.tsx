import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { DocumentContentViewer } from "@/src/components/editor/DocumentContentViewer";
import { proxyImageUrl } from "@/src/services/upload.service";
import type { Task } from "@/src/types";

const EXPORT_WIDTH = 900;

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** TipTap mounts its ProseMirror view asynchronously (an effect that runs after
 *  React commits), so two RAFs aren't reliably enough time for rich content to
 *  actually be in the DOM yet — poll for it instead of guessing a fixed delay. */
function waitForEditorMount(container: HTMLElement, timeoutMs = 2000) {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    function check() {
      if (container.querySelector(".ProseMirror") || Date.now() - start > timeoutMs) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    }
    check();
  });
}

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

/** Same cross-origin workaround as proposal-designs/pdf-export.ts — S3-hosted
 *  images don't send CORS headers, so html2canvas would render them blank;
 *  routing through our backend proxy makes them same-origin. */
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

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");
function slugifyFilename(input: string): string {
  const slug = input
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug || "documento";
}

const priorityLabels: Record<string, string> = {
  high: "Alta Prioridade",
  medium: "Média Prioridade",
  low: "Baixa Prioridade",
};

function PdfDocument({ task }: { task: Task }) {
  const html = task.content || task.description || "";
  const properties: string[] = [];
  if (task.user) properties.push(`Responsável: ${task.user.first_name} ${task.user.last_name ?? ""}`.trim());
  if (task.priority && priorityLabels[task.priority]) properties.push(priorityLabels[task.priority]);
  if (task.due_at) properties.push(`Prazo: ${new Date(task.due_at).toLocaleString("pt-BR")}`);
  if (task.end_at) properties.push(`Entrega: ${new Date(task.end_at).toLocaleString("pt-BR")}`);

  return (
    <div style={{ padding: "48px 56px", background: "#ffffff", color: "#111827", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: properties.length ? 8 : 24, lineHeight: 1.25 }}>
        {task.title}
      </h1>
      {properties.length > 0 && (
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 24 }}>{properties.join("   •   ")}</p>
      )}
      {html && <DocumentContentViewer html={html} task={task} />}
    </div>
  );
}

/**
 * Renders the task's title/properties/rich-text content (read-only, same
 * TipTap extensions as the editor), rasterizes it with html2canvas, and
 * slices the resulting canvas into A4-sized pages — documents can be much
 * taller than a single page, unlike the fixed-size proposal slides.
 *
 * The render host is mounted on-screen at normal (0,0) coordinates rather
 * than pushed off-screen with a large negative `left` — html2canvas clones
 * the page into a hidden iframe to rasterize it, and that clone can't
 * represent negative-coordinate content, which silently produced a blank
 * canvas. A full-viewport opaque overlay covers the host from the user
 * instead, so nothing actually flashes on screen during export.
 */
export async function exportTaskDocumentToPdf(task: Task) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "9999",
    background: "#f8fafc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: "14px",
    color: "#475569",
  });
  overlay.textContent = "Gerando PDF...";
  document.body.appendChild(overlay);

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = `${EXPORT_WIDTH}px`;
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    root.render(<PdfDocument task={task} />);
    await nextPaint();
    rewriteCrossOriginImages(host);
    await waitForImages(host);
    if (task.content || task.description) {
      await waitForEditorMount(host);
    }
    await nextPaint();

    const canvas = await html2canvas(host, {
      width: EXPORT_WIDTH,
      windowWidth: EXPORT_WIDTH,
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const pageHeightPx = (pageHeight * canvas.width) / pageWidth;

    let renderedHeight = 0;
    let pageIndex = 0;
    while (renderedHeight < canvas.height) {
      const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedHeight);

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeightPx;
      const ctx = pageCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, renderedHeight, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

      const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
      if (pageIndex > 0) pdf.addPage();
      const sliceHeightPt = (sliceHeightPx * imgWidth) / canvas.width;
      pdf.addImage(imgData, "JPEG", 0, 0, imgWidth, sliceHeightPt);

      renderedHeight += sliceHeightPx;
      pageIndex++;
    }

    pdf.save(`${slugifyFilename(task.title)}.pdf`);
  } finally {
    root.unmount();
    document.body.removeChild(host);
    document.body.removeChild(overlay);
  }
}
