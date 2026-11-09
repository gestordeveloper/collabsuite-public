import googleFontsList from "./google-fonts.json";

export interface GoogleFontEntry {
  family: string;
  category: string;
}

export interface CustomFontFace {
  family: string;
  url: string;
  weight: number;
  style: string;
}

export const GOOGLE_FONTS: GoogleFontEntry[] = googleFontsList;

export const FONT_WEIGHTS: { value: number; label: string }[] = [
  { value: 100, label: "Fino" },
  { value: 200, label: "Extra leve" },
  { value: 300, label: "Leve" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Médio" },
  { value: 600, label: "Semi-negrito" },
  { value: 700, label: "Negrito" },
  { value: 800, label: "Extra-negrito" },
  { value: 900, label: "Preto" },
];

/** Registered by the editor once its custom fonts are fetched — see design-editor.store.ts. */
let customFontRegistry: CustomFontFace[] = [];
const loadedGoogleFamilies = new Set<string>();
const injectedCustomFaceKeys = new Set<string>();

export function registerCustomFonts(fonts: CustomFontFace[]) {
  customFontRegistry = fonts;
}

export function isCustomFontFamily(family: string): boolean {
  return customFontRegistry.some((f) => f.family === family);
}

/** Old text elements stored `fontFamily` as a full CSS stack, e.g. "Inter, sans-serif" — take
 *  just the actual family name for lookups/API calls/@font-face declarations. */
export function cleanFamilyName(raw: string): string {
  return raw.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
}

/** CSS `font-family` value to apply to an element, with a safe generic fallback appended. */
export function fontFamilyCss(raw: string): string {
  const name = cleanFamilyName(raw);
  return `"${name}", sans-serif`;
}

function injectCustomFace(font: CustomFontFace) {
  const key = `${font.family}|${font.url}|${font.weight}|${font.style}`;
  if (injectedCustomFaceKeys.has(key)) return;
  injectedCustomFaceKeys.add(key);
  const style = document.createElement("style");
  style.textContent = `@font-face { font-family: "${font.family}"; src: url("${font.url}"); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`;
  document.head.appendChild(style);
}

/** Ensures a family used on an element is actually renderable — injects the custom
 *  @font-face rule(s) if it's one of the user's uploaded fonts, otherwise loads it from
 *  Google Fonts (requesting the full weight range so any weight picked later just works). */
export function ensureFontLoaded(rawFamily: string | undefined) {
  if (!rawFamily) return;
  const family = cleanFamilyName(rawFamily);

  const customMatches = customFontRegistry.filter((f) => f.family === family);
  if (customMatches.length > 0) {
    customMatches.forEach(injectCustomFace);
    return;
  }

  if (loadedGoogleFamilies.has(family)) return;
  loadedGoogleFamilies.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
  document.head.appendChild(link);
}

/** Lightweight preview loader (regular weight only) for a batch of Google Font names —
 *  used by the font picker so browsing/searching doesn't request every weight upfront. */
export function ensureFontsPreview(families: string[]) {
  const toLoad = families.filter((f) => !loadedGoogleFamilies.has(f) && !isCustomFontFamily(f));
  if (toLoad.length === 0) return;
  toLoad.forEach((f) => loadedGoogleFamilies.add(f));
  const query = toLoad.map((f) => `family=${encodeURIComponent(f)}`).join("&");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  document.head.appendChild(link);
}
