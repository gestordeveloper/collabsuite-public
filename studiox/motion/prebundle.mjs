// Bundles the Remotion templates ahead of time (build.ps1 runs it once, so the first motion graphic of an
// installed app does not pay the bundling cost). Same entry/outDir as ensureBundle() in render.mjs.
import {bundle} from '@remotion/bundler';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await bundle({
  entryPoint: path.join(__dirname, 'src', 'index.ts'),
  outDir: path.join(__dirname, '.bundle'),
  onProgress: () => {},
});
console.log('bundle ok');
