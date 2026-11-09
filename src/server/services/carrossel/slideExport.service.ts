/**
 * Exportação em PNG (feed/Stories) e MP4 (slides animados e Stories).
 *
 * Como funciona o MP4: para cada quadro o Chromium posiciona a animação do slide no instante certo (Web Animations),
 * tira um screenshot e no fim o ffmpeg junta os quadros com H.264/AAC compatível com o Instagram.
 *
 * Stories (1080x1920): o slide de 1080x1350 fica centralizado na tela vertical, sobre a cor de fundo do próprio slide.
 */
import JSZip from "jszip";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { getBrowser } from "../../lib/headlessBrowser";
import { runFfmpeg } from "../../lib/ffmpeg";
import { AIGenerationError, type ProgressFn, report } from "./aiClient";
import { ANIMATION_PRESETS, apply } from "./animationRuntime";
import { serialize } from "./render.service";
import { collectImageUrls, findNativeTemplate, inlineImages, renderSlideHtml } from "./template.service";
import type { Brandbook, CarouselProjectData, SlideAnimation, SlideData } from "./types";

const SLIDE_W = 1080;
const SLIDE_H = 1350;
const FORMATS = { feed: { w: 1080, h: 1350, prefix: "slide" }, story: { w: 1080, h: 1920, prefix: "story" } } as const;

export interface VideoExportRequest {
  slide_indices?: number[] | null;
  format?: "feed" | "story";
  outputs?: ("png" | "mp4")[];
  /** "slide" usa a animação de cada slide; "none" ou um preset aplica a todos. */
  animation?: string;
  ken_burns?: boolean | null;
  seconds?: number;
  fps?: number;
  merge?: boolean;
}

const STORY_JS = `(top) => {
  const root = document.querySelector('[data-tpl-root]') || document.body.firstElementChild;
  let bg = getComputedStyle(root).backgroundColor;
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = '#000';
  document.documentElement.style.cssText += ';background:' + bg;
  document.body.style.cssText += ';width:1080px;height:1920px;background:' + bg + ';overflow:hidden;position:relative';
  root.style.position = 'absolute'; root.style.left = '0px'; root.style.top = top + 'px';
}`;

async function ffmpeg(args: string[], what: string): Promise<void> {
  try {
    await runFfmpeg(["-y", ...args]);
  } catch (e) {
    const msg = ((e as Error).message || "").split("\n").slice(-4).join(" | ").slice(0, 400);
    throw new AIGenerationError(`Falha ao ${what} com o ffmpeg: ${msg}`, 500);
  }
}

function effectiveAnimation(slide: SlideData, req: VideoExportRequest): SlideAnimation {
  const anim = slide.animation || { preset: "none", ken_burns: false };
  let preset = (req.animation || "slide") === "slide" ? anim.preset : req.animation!;
  if (!(preset in ANIMATION_PRESETS)) preset = "none";
  const ken = req.ken_burns === undefined || req.ken_burns === null ? anim.ken_burns : !!req.ken_burns;
  return { preset, ken_burns: ken };
}

export async function exportExtras(
  project: CarouselProjectData, bb: Brandbook, req: VideoExportRequest, progress?: ProgressFn,
): Promise<{ zip: Buffer; counts: { png: number; mp4: number } }> {
  const fmt = req.format === "story" ? "story" : "feed";
  const { w, h, prefix } = FORMATS[fmt];
  const outputs = new Set(req.outputs?.length ? req.outputs : ["mp4"]);
  const fps = Math.max(10, Math.min(Math.floor(req.fps || 30), 60));
  const slides = project.slides.filter((s) => !req.slide_indices?.length || req.slide_indices.includes(s.index));
  if (!slides.length) throw new AIGenerationError("Nenhum slide selecionado para exportar.", 400);
  if (outputs.has("mp4")) {
    try { await runFfmpeg(["-version"]); } catch (e) { throw new AIGenerationError((e as Error).message, 400); }
  }

  return serialize(async () => {
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), "carousel-export-"));
    const zip = new JSZip();
    const counts = { png: 0, mp4: 0 };
    const mp4s: string[] = [];
    const steps = slides.length * outputs.size;
    let done = 0;
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const open = async (html: string) => {
        await page.setContent(html, { waitUntil: "networkidle", timeout: 45000 });
        await page.evaluate(() => (document as any).fonts.ready);
        await page.waitForFunction("() => !document.querySelector('[data-tpl-root]') || document.documentElement.dataset.fitDone === '1'", undefined, { timeout: 5000 }).catch(() => undefined);
        if (fmt === "story") await page.evaluate(STORY_JS, Math.floor((h - SLIDE_H) / 2));
        await page.waitForTimeout(400);
      };
      const htmlFor = async (slide: SlideData, anim?: SlideAnimation) => {
        const tpl = findNativeTemplate(slide, bb);
        const inlined = tpl ? await inlineImages(collectImageUrls(slide, tpl)) : undefined;
        const base = renderSlideHtml({ ...slide, animation: anim || slide.animation }, bb, { total: project.slides.length, isSingle: project.is_single_slide, inlined });
        return anim ? apply(base, anim, "export") : base;
      };

      for (const slide of slides) {
        const label = `Slide ${slide.index} de ${project.slides.length}`;
        const idx = String(slide.index).padStart(2, "0");

        if (outputs.has("png")) {
          report(progress, `${label}: PNG`, 4 + (90 * done) / steps);
          await open(await htmlFor(slide));
          zip.file(`png/${prefix}_${idx}.png`, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } }));
          counts.png++;
          done++;
        }

        if (outputs.has("mp4")) {
          const anim = effectiveAnimation(slide, req);
          await open(await htmlFor(slide, anim));
          const active = anim.preset !== "none" || anim.ken_burns;
          let totalS = Math.max(1, Number(req.seconds) || 5);
          const animEndS = ((await page.evaluate((t) => ((window as any).__anim ? (window as any).__anim.build(t) : 0), Math.floor(totalS * 1000))) || 0) / 1000;
          totalS = Math.max(totalS, animEndS + 0.5);
          if (anim.ken_burns) await page.evaluate((t) => (window as any).__anim && (window as any).__anim.build(t), Math.floor(totalS * 1000)); // recalcula o zoom com a duração final
          const captureS = anim.ken_burns ? totalS : animEndS;
          const nFrames = Math.max(1, Math.ceil(captureS * fps));
          const framesDir = path.join(work, `f_${idx}`);
          await fsp.mkdir(framesDir, { recursive: true });
          const base = 4 + (90 * done) / steps;
          const span = 90 / steps;
          for (let k = 0; k < nFrames; k++) {
            if (k % 6 === 0) report(progress, `${label}: capturando quadros ${k + 1}/${nFrames}`, base + (span * 0.85 * k) / nFrames);
            if (active) await page.evaluate((t) => (window as any).__anim && (window as any).__anim.seek(t), (k * 1000) / fps);
            await fsp.writeFile(path.join(framesDir, `f_${String(k + 1).padStart(5, "0")}.jpg`), await page.screenshot({ type: "jpeg", quality: 95, clip: { x: 0, y: 0, width: w, height: h } }));
          }
          report(progress, `${label}: gerando o MP4`, base + span * 0.9);
          const hold = Math.max(0, totalS - nFrames / fps) + 0.1;
          const out = path.join(work, `${prefix}_${idx}.mp4`);
          await ffmpeg([
            "-framerate", String(fps), "-i", path.join(framesDir, "f_%05d.jpg"), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-filter_complex", `[0:v]tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},format=yuv420p[v];[1:a]aresample=44100,aformat=channel_layouts=stereo,apad[a]`,
            "-map", "[v]", "-map", "[a]", "-t", totalS.toFixed(3), "-r", String(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
          ], "montar o MP4");
          await fsp.rm(framesDir, { recursive: true, force: true });
          zip.file(`mp4/${prefix}_${idx}.mp4`, await fsp.readFile(out));
          mp4s.push(out);
          counts.mp4++;
          done++;
        }
      }

      if (req.merge && mp4s.length > 1) {
        report(progress, "Unindo os slides em um único vídeo", 95);
        const list = path.join(work, "concat.txt");
        await fsp.writeFile(list, mp4s.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
        const merged = path.join(work, "merged.mp4");
        await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", merged], "unir os vídeos");
        zip.file(fmt === "story" ? "stories_completo.mp4" : "carrossel_completo.mp4", await fsp.readFile(merged));
      }
    } finally {
      await context.close().catch(() => undefined);
      await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
    report(progress, "Compactando o pacote", 98);
    return { zip: await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }), counts };
  });
}
