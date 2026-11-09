/** Renderização em alta resolução (Chromium) dos slides em PNG e empacotamento em ZIP. */
import JSZip from "jszip";
import { getBrowser } from "../../lib/headlessBrowser";
import { collectImageUrls, findNativeTemplate, inlineImages, renderSlideHtml } from "./template.service";
import type { Brandbook, CarouselProjectData, SlideData } from "./types";

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;

export interface RenderedSlide {
  index: number;
  slide_id: string;
  filename: string;
  png: Buffer;
}

/** Fila de uma renderização por vez: o Chromium é pesado e os slides esperam as fontes da web. */
let chain: Promise<unknown> = Promise.resolve();
export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** HTML -> PNG (clip do tamanho do slide). Reutilizado por outros estúdios (HQ). */
export async function htmlToPng(
  html: string, size: { width: number; height: number } = { width: SLIDE_W, height: SLIDE_H }, opts: { transparent?: boolean } = {},
): Promise<Buffer> {
  return serialize(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "networkidle", timeout: 45000 });
      await page.evaluate(() => (document as any).fonts.ready);
      // modelos do brand book reduzem a fonte de títulos longos até caber: espera esse ajuste terminar
      await page
        .waitForFunction(
          "() => !document.querySelector('[data-tpl-root]') || document.documentElement.dataset.fitDone === '1'",
          undefined,
          { timeout: 5000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(500);
      return await page.screenshot({ clip: { x: 0, y: 0, width: size.width, height: size.height }, type: "png", omitBackground: !!opts.transparent });
    } finally {
      await context.close();
    }
  });
}

export async function renderSlidePng(slide: SlideData, project: CarouselProjectData, bb: Brandbook): Promise<Buffer> {
  const tpl = findNativeTemplate(slide, bb);
  const inlined = tpl ? await inlineImages(collectImageUrls(slide, tpl)) : undefined;
  const html = renderSlideHtml(slide, bb, { total: project.slides.length, isSingle: project.is_single_slide, inlined });
  return htmlToPng(html);
}

export async function renderProjectPngs(
  project: CarouselProjectData, bb: Brandbook, slideIndices?: number[] | null, onProgress?: (done: number, total: number) => void,
): Promise<RenderedSlide[]> {
  const slides = project.slides.filter((s) => !slideIndices?.length || slideIndices.includes(s.index));
  const out: RenderedSlide[] = [];
  for (const slide of slides) {
    const png = await renderSlidePng(slide, project, bb);
    out.push({ index: slide.index, slide_id: slide.id, filename: `slide_${String(slide.index).padStart(2, "0")}.png`, png });
    onProgress?.(out.length, slides.length);
  }
  return out;
}

export async function zipSlides(project: CarouselProjectData, bb: Brandbook, rendered: RenderedSlide[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const r of rendered) zip.file(`png/${r.filename}`, r.png);
  for (const r of rendered) {
    const slide = project.slides.find((s) => s.index === r.index);
    if (!slide) continue;
    const tpl = findNativeTemplate(slide, bb);
    const inlined = tpl ? await inlineImages(collectImageUrls(slide, tpl)) : undefined;
    zip.file(
      `html/slide_${String(r.index).padStart(2, "0")}.html`,
      renderSlideHtml(slide, bb, { total: project.slides.length, isSingle: project.is_single_slide, inlined }),
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
