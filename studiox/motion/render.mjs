#!/usr/bin/env node
// Invoked by backend/motion_render.py via subprocess, one process per render job (never a long-lived
// server). Usage: node render.mjs <spec.json>. Prints one JSON line to stdout: {ok, outputPath, ...}
// on success, or {ok: false, error} on failure (exit code 1).
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = path.join(__dirname, '.bundle');
// Docker (Alpine): o Chrome Headless Shell que o Remotion baixa é glibc e não roda; usa o Chromium do sistema.
const BROWSER = process.env.CHROMIUM_PATH || null;

function fail(message) {
  console.log(JSON.stringify({ok: false, error: String(message)}));
  process.exit(1);
}

// Bundled once and reused across renders (bundling takes several seconds; a render job should not
// pay that cost every time). Delete motion/.bundle after changing a template's source to rebuild it.
async function ensureBundle() {
  const indexHtml = path.join(BUNDLE_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    return BUNDLE_DIR;
  }
  return bundle({
    entryPoint: path.join(__dirname, 'src', 'index.ts'),
    outDir: BUNDLE_DIR,
    onProgress: () => {},
  });
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) fail('uso: node render.mjs <spec.json>');

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const {templateId, inputProps, width, height, fps, durationInSeconds, outputPath} = spec;
  if (!templateId || !outputPath) fail('spec incompleto: templateId e outputPath são obrigatórios');

  const serveUrl = await ensureBundle();
  const mergedProps = {...(inputProps || {}), width, height, fps, durationInSeconds};

  const composition = await selectComposition({
    serveUrl,
    id: templateId,
    inputProps: mergedProps,
    browserExecutable: BROWSER,
  });

  fs.mkdirSync(path.dirname(outputPath), {recursive: true});

  // vp8/yuva420p is the combination Remotion documents for an alpha channel the ffmpeg side can
  // later read back with a plain `overlay` filter (see backend/motion_graphics.py build_graph).
  await renderMedia({
    composition,
    serveUrl,
    codec: 'vp8',
    pixelFormat: 'yuva420p',
    imageFormat: 'png', // required by Remotion for a transparent (yuva420p) render
    outputLocation: outputPath,
    inputProps: mergedProps,
    browserExecutable: BROWSER,
    onProgress: () => {},
  });

  console.log(JSON.stringify({
    ok: true,
    outputPath,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  }));
}

main().catch((err) => fail(err && err.stack ? err.stack : err));
