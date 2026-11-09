import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, '..', 'public', 'assets', 'images', 'icon.png');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'images');

// Maskable: ícone rosa sobre o preto do design system (superfície mais escura da marca).
const THEME_COLOR = '#0B0B0D';
const BG_COLOR = '#0B0B0D';
const MASKABLE_PADDING_RATIO = 0.10;

const ICONS = [
  { name: 'pwa-64x64.png', size: 64, maskable: false, bg: null },
  { name: 'pwa-192x192.png', size: 192, maskable: false, bg: null },
  { name: 'pwa-512x512.png', size: 512, maskable: false, bg: null },
  { name: 'pwa-maskable-192x192.png', size: 192, maskable: true, bg: THEME_COLOR },
  { name: 'pwa-maskable-512x512.png', size: 512, maskable: true, bg: THEME_COLOR },
  { name: 'apple-touch-icon.png', size: 180, maskable: false, bg: null },
  { name: 'apple-touch-icon-180x180.png', size: 180, maskable: false, bg: null },
  { name: 'favicon-16x16.png', size: 16, maskable: false, bg: null },
  { name: 'favicon-32x32.png', size: 32, maskable: false, bg: null },
];

async function generate() {
  const sourceMeta = await sharp(SOURCE).metadata();
  console.log(`Source: ${sourceMeta.width}x${sourceMeta.height} (${sourceMeta.format})`);

  for (const icon of ICONS) {
    let pipeline;
    const targetSize = icon.size;
    const innerSize = icon.maskable
      ? Math.round(targetSize * (1 - 2 * MASKABLE_PADDING_RATIO))
      : targetSize;

    if (icon.maskable) {
      pipeline = sharp(SOURCE)
        .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({
          top: Math.round((targetSize - innerSize) / 2),
          bottom: Math.round((targetSize - innerSize) / 2),
          left: Math.round((targetSize - innerSize) / 2),
          right: Math.round((targetSize - innerSize) / 2),
          background: icon.bg,
        })
        .flatten({ background: icon.bg })
        .png();
    } else {
      pipeline = sharp(SOURCE)
        .resize(targetSize, targetSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png();
    }

    const outPath = path.join(OUT_DIR, icon.name);
    await pipeline.toFile(outPath);
    const meta = await sharp(outPath).metadata();
    console.log(`  ${icon.name}  ${meta.width}x${meta.height}` + (icon.maskable ? ' (maskable, 10% padding)' : ''));
  }

  console.log('\nAll icons generated successfully.');
}

generate().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});