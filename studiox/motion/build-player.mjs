#!/usr/bin/env node
// One-shot bundle of src/player-entry.tsx into frontend/vendor/motion-player.js (a plain <script>
// the editor loads — see frontend/js/motionplayer.js). Re-run after changing a template's .tsx or
// the player entry; nothing watches automatically.
import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, '..', 'frontend', 'vendor', 'motion-player.js');

await build({
  entryPoints: [path.join(__dirname, 'src', 'player-entry.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile,
  loader: {'.tsx': 'tsx'},
  jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'},
  target: ['chrome110'],
  logLevel: 'info',
});

console.log('Bundled', outfile);
