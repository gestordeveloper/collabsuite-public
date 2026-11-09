/**
 * Importa brand books exportados do Claude Design / Claude Code (ZIP com .dc.html).
 *
 * O importador guarda o desenho REAL de cada modelo de slide (ver templateEngine) e não só o nome dele, para que
 * os carrosséis usem exatamente os modelos da marca em vez de layouts genéricos.
 */
import JSZip from "jszip";
import * as cheerio from "cheerio";
import { prisma } from "../../lib/prisma";
import * as te from "./templateEngine";
import { normalizeBrandbook, saveBrandbook } from "./brandbook.service";
import {
  DEFAULT_COLORS, DEFAULT_TYPOGRAPHY, type Brandbook, type BrandColors, type SlideTemplateDef,
} from "./types";

const IMAGE_EXTS = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
const MIME: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
// Pastas do pacote que não fazem parte da identidade da marca
const IGNORED_DIRS = new Set(["scraps", "uploads", "node_modules", "__macosx", ".git"]);
// HTMLs que costumam vir no mesmo ZIP mas não são o brand book de carrosséis
const NOT_BRANDBOOK_HINTS = ["proposta", "proposal", "print", "deck", "landing"];
const MAX_ZIP_BYTES = 40 * 1024 * 1024;

const GENERIC_NAME_WORDS = new Set([
  "carrosseis", "carrossel", "carousel", "brandbook", "brand", "book", "design", "system", "identidade",
  "visual", "guia", "manual", "marca", "instagram", "linkedin", "slides",
]);

const ascii = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const slugHandle = (h: string) => ascii(h.replace(/^@/, "")).toLowerCase().replace(/[^a-z0-9]/g, "");
const slugName = (n: string) => ascii(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function isGenericName(raw: string): boolean {
  const words = ascii((raw || "").toLowerCase()).split(/[^a-z]+/).filter(Boolean);
  return !words.length || words.every((w) => GENERIC_NAME_WORDS.has(w) || ["de", "do", "da", "e"].includes(w));
}

function prettyName(raw: string): string {
  const r = (raw || "").replace(/\s+/g, " ").trim();
  return r && r === r.toLowerCase() && !r.includes(" ") ? r.charAt(0).toUpperCase() + r.slice(1).toLowerCase() : r;
}

interface PackageFile { path: string; name: string; bytes: Buffer }

interface Extracted {
  name: string;
  handle: string;
  description: string;
  fonts: string[];
  fontWeights: Record<string, string>;
  colors: Partial<BrandColors>;
  isDark: boolean;
  rules: string[];
  templates: SlideTemplateDef[];
  report: Record<string, any>;
}

function fontOrder(fonts: string[]): string[] {
  const base = fonts.filter((f) => f.toLowerCase() !== "caveat");
  const mono = base.filter((f) => /mono|code/i.test(f));
  const rest = base.filter((f) => !mono.includes(f));
  let ordered = [...rest.slice(0, 2), ...mono.slice(0, 1)];
  if (rest.length === 1) ordered = [rest[0], rest[0], ...mono.slice(0, 1)]; // marca de uma fonte só: título e corpo iguais
  return ordered;
}

function fontAt(fonts: string[], role: "title" | "body" | "mono"): string {
  if (role === "mono") return fonts.filter((f) => /mono|code/i.test(f))[0] || "";
  const idx = role === "title" ? 0 : 1;
  return fonts[idx] ?? fonts[0] ?? "";
}

function countFramesOf(file: PackageFile): number {
  return te.countFrames(file.bytes.toString("utf8"));
}

function pickBrandbookHtml(files: PackageFile[]): { main: PackageFile; candidates: PackageFile[] } {
  const scored = files.map((f) => {
    const name = f.name.toLowerCase();
    let score = countFramesOf(f) * 10;
    if (["brandbook", "brand book", "carross"].some((k) => name.includes(k))) score += 25;
    if (name.includes(".dc.")) score += 3;
    if (NOT_BRANDBOOK_HINTS.some((k) => name.includes(k))) score -= 40;
    return { score, f };
  });
  scored.sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name));
  return { main: scored[0].f, candidates: scored.map((s) => s.f) };
}

function selectAssets(mainHtml: string, images: PackageFile[]): { assets: PackageFile[]; warnings: string[] } {
  const referenced = new Set([...mainHtml.matchAll(/src=["']([^"']+)["']/g)].map((m) => (m[1].split(/[\\/]/).pop() || "").toLowerCase()));
  const chosen = new Map<string, PackageFile>();
  const sorted = [...images].sort((a, b) => {
    const aa = a.path.toLowerCase().split("/").includes("assets") ? 0 : 1;
    const bb = b.path.toLowerCase().split("/").includes("assets") ? 0 : 1;
    return aa - bb || a.path.split("/").length - b.path.split("/").length;
  });
  for (const img of sorted) {
    const inAssets = img.path.toLowerCase().split("/").includes("assets");
    if (referenced.has(img.name.toLowerCase()) || inAssets || !img.path.includes("/")) if (!chosen.has(img.name)) chosen.set(img.name, img);
  }
  const warnings: string[] = [];
  if (!chosen.size) {
    warnings.push(
      "Nenhum logo ou ícone foi encontrado no ZIP. Os slides usarão o nome/iniciais da marca. " +
      "Inclua uma pasta assets/ com logo e icon para usar o logotipo real.",
    );
  }
  return { assets: [...chosen.values()], warnings };
}

/** Extrai nome, handle, fontes, cores e regras do HTML do brand book (heurística, sem IA). */
function heuristicAnalysis(htmlRaw: string, cssTexts: string[], fallbackName: string): Extracted {
  const $ = cheerio.load(htmlRaw);
  const textOf = (el: any, sep = " ") =>
    $(el).find("*").addBack().contents().toArray().filter((n: any) => n.type === "text").map((n: any) => n.data.trim()).filter(Boolean).join(sep);

  let brandName = "";
  let handle = "";
  let description = "";
  const rules: string[] = [];
  const fonts: string[] = [];
  const fontWeights: Record<string, string> = {};
  const colors: Partial<BrandColors> = {};
  let isDark = false;

  // 1. Nome da marca
  const h1 = $("h1").first();
  if (h1.length) {
    const h1Txt = textOf(h1.get(0));
    const span = h1.find("span").first();
    if (span.length && span.text().trim()) {
      brandName = prettyName(span.text().trim());
      if (isGenericName(brandName)) brandName = "";
    }
    if (!brandName) {
      const m = /(?:Carross[ée]is|Brandbook)\s+(?:de\s+|do\s+|da\s+)?([^\n\r—–\-·|]+)/i.exec(h1Txt);
      if (m) brandName = prettyName(m[1].trim());
      else if (h1Txt) brandName = h1Txt;
      if (isGenericName(brandName)) brandName = "";
    }
  }
  if (!brandName) {
    const alt = $("header img").first().attr("alt");
    if (alt) brandName = alt.trim();
  }
  if (!brandName) {
    for (const img of $("img").toArray()) {
      const alt = ($(img).attr("alt") || "").trim();
      if (alt && !["logo", "icon", "imagem"].includes(alt.toLowerCase())) { brandName = alt; break; }
    }
  }
  if (!brandName) {
    const clean = fallbackName.replace(/brand\s*book|carrossel|design|system|export|completo|\.zip/gi, "").trim();
    brandName = clean ? prettyName(clean) : "Nova Marca";
  }

  // 2. Descrição
  const hp = $("header p").first();
  if (hp.length && hp.text().trim().length > 25) description = hp.text().trim();
  if (!description) {
    for (const sec of $("section").toArray()) {
      const p = $(sec).find("p").first();
      if (p.length && p.text().trim().length > 25) { description = p.text().trim(); break; }
    }
  }
  if (!description) description = $('meta[name="description"]').attr("content")?.trim() || "";
  if (!description) description = `Brandbook oficial importado para ${brandName}`;

  // 3. @handle
  const BAD_SPAN = ["handle", "usuario", "perfil", "import", "media"];
  for (const m of htmlRaw.matchAll(/<span[^>]*>@([a-zA-Z][a-zA-Z0-9_.]{2,29})<\/span>/g)) {
    if (!BAD_SPAN.includes(m[1].toLowerCase())) { handle = `@${m[1]}`; break; }
  }
  if (!handle) {
    const BAD = [...BAD_SPAN, "user", "font-face", "keyframes", "supports", "charset", "page", "layer", "container", "namespace"];
    for (const m of htmlRaw.matchAll(/@([a-zA-Z][a-zA-Z0-9_.-]{2,29})/g)) {
      if (!BAD.includes(m[1].toLowerCase()) && !/^\d+$/.test(m[1])) { handle = `@${m[1]}`; break; }
    }
  }
  if (!handle) handle = `@${brandName.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9_]/g, "")}`;

  // 4. Fontes do Google Fonts
  for (const link of $("link").toArray()) {
    if (!/stylesheet/i.test($(link).attr("rel") || "")) continue;
    const href = $(link).attr("href") || "";
    if (!href.includes("fonts.googleapis.com")) continue;
    for (const m of href.matchAll(/family=([^:&]+)(?::wght@([^&]+))?/g)) {
      const fam = m[1].replace(/\+/g, " ");
      if (!fonts.includes(fam)) fonts.push(fam);
      if (m[2]) fontWeights[fam] = m[2];
    }
  }

  // 5a. renderVals() dos componentes Claude Design Canvas (.dc.html)
  const rv = /renderVals\s*\(\s*\)\s*\{\s*return\s*(\{[\s\S]*?\});\s*\}/.exec(htmlRaw);
  if (rv) {
    const js = rv[1];
    const sw = /swatches\s*:\s*\[([\s\S]*?)\]/.exec(js);
    if (sw) {
      const re = /\{\s*name\s*:\s*['"]([^'"]+)['"]\s*,\s*hex\s*:\s*['"]([^'"]+)['"](?:\s*,\s*role\s*:\s*['"]([^'"]+)['"])?/g;
      for (const m of sw[1].matchAll(re)) {
        const comb = `${m[1]} ${m[3] || ""}`.toLowerCase();
        const hex = m[2];
        const has = (...ks: string[]) => ks.some((k) => comb.includes(k));
        if (has("primária 600", "primaria 600", "ação", "destaque e palavra")) colors.primary_600 = hex;
        else if (has("primária 800", "primaria 800", "contraste escuro")) colors.primary_800 = hex;
        else if (has("primária 100", "primaria 100", "fundo suave")) colors.primary_100 = hex;
        else if (has("primária 200", "primaria 200", "divisores e anotações")) colors.primary_200 = hex;
        else if (has("fundo papel", "slides claros")) colors.neutral_50 = hex;
        else if (has("100", "cinza muito claro", "cinza claro")) colors.neutral_100 = hex;
        else if (has("bordas e separadores", "200")) colors.neutral_200 = hex;
        else if (has("600", "apoio secundário")) colors.neutral_600 = hex;
        else if (has("texto de apoio", "metadados", "700")) colors.neutral_700 = hex;
        else if (has("superfície", "superficie", "cartões e blocos", "900")) colors.neutral_900 = hex;
        else if (has("fundo escuro", "fundo predominante", "950")) colors.neutral_950 = hex;
        else if (has("indicador positivo", "acertos")) colors.green_check = hex;
      }
    }
    const doM = /doList\s*:\s*\[([\s\S]*?)\]/.exec(js);
    if (doM) {
      for (const d of doM[1].matchAll(/['"]([^'"]+)['"]/g)) {
        const t = d[1].trim();
        if (t && !rules.includes(t)) rules.push(t);
      }
    }
    const avM = /avoidList\s*:\s*\[([\s\S]*?)\]/.exec(js);
    if (avM) {
      for (const a of avM[1].matchAll(/['"]([^'"]+)['"]/g)) {
        const t = a[1].trim();
        if (!t) continue;
        const rule = `${t.toLowerCase().startsWith("evite") ? "" : "Evite: "}${t}`;
        if (!rules.includes(rule)) rules.push(rule);
      }
    }
  }

  // 5b. Barra de proporção 60-30-10 (DOM)
  let bar60: string | null = null, bar30: string | null = null, bar10: string | null = null;
  const bgRe = /background\s*:\s*(#[0-9a-fA-F]{3,8}|oklch\([^)]+\))/;
  const divs = $("div").toArray();
  for (const div of divs) {
    const style = $(div).attr("style") || "";
    const grab = () => bgRe.exec(style)?.[1].trim() ?? null;
    if (/flex:\s?60/.test(style)) bar60 = grab() ?? bar60;
    else if (/flex:\s?30/.test(style)) bar30 = grab() ?? bar30;
    else if (/flex:\s?10/.test(style)) bar10 = grab() ?? bar10;
  }

  // 5c. Cartões de swatches no DOM
  const swatches: [string, string, string[]][] = [];
  for (const div of divs) {
    const lines = $(div).find("*").addBack().contents().toArray().filter((n: any) => n.type === "text").map((n: any) => n.data.trim()).filter(Boolean);
    if (lines.length >= 2 && lines.length <= 6) {
      let code: string | null = null;
      for (const l of lines) {
        const m = /(#[0-9a-fA-F]{3,8}|oklch\([^)]+\))/.exec(l);
        if (m) { code = m[1]; break; }
      }
      if (code) swatches.push([lines[0], code, lines.slice(1)]);
    }
  }
  for (const [title, code, details] of swatches) {
    const comb = `${title} ${details.join(" ")}`.toLowerCase();
    const has = (...ks: string[]) => ks.some((k) => comb.includes(k));
    if (has("rosa", "laranja", "primária", "primaria", "accent", "palavra-chave", "cta") && !colors.primary_600) colors.primary_600 = code;
    else if (has("fundo escuro", "base da maioria", "dark") && !colors.neutral_950) colors.neutral_950 = code;
    else if (has("claro", "respiro", "listas", "papel") && !colors.neutral_50) colors.neutral_50 = code;
    else if (has("superfície", "superficie", "cartões", "cartoes") && !colors.neutral_900) colors.neutral_900 = code;
    else if (has("secundário", "secundario", "corpo em fundo escuro", "metadados") && !colors.neutral_700) colors.neutral_700 = code;
    else if (has("borda", "border", "separadores") && !colors.neutral_200) colors.neutral_200 = code;
  }
  const contrast = /(?:pink-600|contraste)[^\w#]{0,20}(#[0-9a-fA-F]{3,8}|oklch\([^)]+\))/i.exec(htmlRaw);
  if (contrast && !colors.primary_800) colors.primary_800 = contrast[1];

  if (bar10 && !colors.primary_600) colors.primary_600 = bar10;
  if (bar60 && !colors.neutral_950) colors.neutral_950 = bar60;
  if (bar30 && !colors.neutral_50) colors.neutral_50 = bar30;

  const lower = htmlRaw.toLowerCase();
  if (bar60 && ["#0", "#1", "#2", "oklch(1", "oklch(2"].some((p) => (bar60 as string).startsWith(p))) isDark = true;
  else if (lower.includes("fundo escuro por padrão") || description.toLowerCase().includes("fundo escuro") || lower.includes("fundo escuro como padrão")) isDark = true;

  // 6a. Seções Faça/Evite no DOM
  for (const sec of $("section").toArray()) {
    const lbl = ($(sec).attr("data-screen-label") || "").toLowerCase();
    const h2 = $(sec).find("h2").first().text().trim().toLowerCase();
    if (lbl.includes("regra") || h2.includes("faça") || h2.includes("evite")) {
      for (const card of $(sec).find("div").toArray()) {
        const spans = $(card).find("span").toArray().map((s) => $(s).text().trim()).filter((s) => s.length > 8);
        const isEvite = spans.some((s) => s.toLowerCase().includes("evite"));
        for (const s of spans) {
          if (["faça", "evite"].includes(s.toLowerCase())) continue;
          const rule = `${isEvite && !s.toLowerCase().startsWith("evite") ? "Evite: " : ""}${s}`;
          if (!rules.includes(rule)) rules.push(rule);
        }
      }
    }
  }
  // 6b. Grid, margens e ritmo de fundo
  for (const div of divs) {
    const t = $(div).text().replace(/\s+/g, " ").trim();
    if (t.includes("Margem segura") && t.includes("88px")) {
      const r = "Mantenha margem segura de 88px em todos os lados em 1080x1350px.";
      if (!rules.includes(r)) rules.push(r);
    }
    if (t.includes("Ritmo de fundo")) {
      const r = "Alterne fundo escuro e claro a cada 2 ou 3 slides; cor primária só na capa ou no CTA.";
      if (!rules.includes(r)) rules.push(r);
    }
  }

  // 7. Modelos de slide REAIS
  const ordered = fontOrder(fonts);
  const templates = te.extractTemplates(
    htmlRaw, { title: fontAt(ordered, "title"), body: fontAt(ordered, "body"), mono: fontAt(ordered, "mono") }, colors.primary_600 ?? null,
  );

  // CSS adicional: tokens globais
  for (const css of cssTexts) {
    for (const m of css.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) {
      const name = m[1].toLowerCase();
      const val = m[2].trim();
      if (name.includes("primary") && !colors.primary_600) colors.primary_600 = val;
      else if (name.includes("background") && !colors.neutral_50) colors.neutral_50 = val;
    }
  }

  return { name: brandName || "Marca Importada", handle: handle || "@marca", description, fonts: ordered, fontWeights, colors, isDark, rules, templates, report: {} };
}

async function resolveBrandId(name: string, handle: string): Promise<string> {
  let canonical = slugHandle(handle) || slugName(name) || "marca-importada";
  if (["marca", "novamarca"].includes(canonical)) canonical = slugName(name) || "marca-importada";
  const sameHandle: string[] = [];
  if (slugHandle(handle)) {
    for (const row of await prisma.carouselBrandbook.findMany({ select: { id: true, data: true } })) {
      try {
        if (slugHandle(JSON.parse(row.data).handle || "") === slugHandle(handle)) sameHandle.push(row.id);
      } catch { /* ignora registro ilegível */ }
    }
  }
  if (sameHandle.includes(canonical) || !sameHandle.length) return canonical;
  return sameHandle[0];
}

function pickAssetNames(templates: SlideTemplateDef[], assets: PackageFile[]): { logo: string | null; icon: string | null } {
  const used: string[] = [];
  for (const t of templates) if (t.html) used.push(...[...t.html.matchAll(/data-asset="([^"]+)"/g)].map((m) => m[1]));
  const names = new Set(assets.map((a) => a.name));
  let logo = used.find((n) => /logo/i.test(n) && names.has(n)) || null;
  let icon = used.find((n) => /icon|symbol|simbolo|icone|mark/i.test(n) && names.has(n)) || null;
  if (!logo) logo = assets.find((a) => /logo/i.test(a.name.replace(/\.[^.]+$/, "")))?.name ?? null;
  if (!icon) icon = assets.find((a) => /icon|symbol|simbolo|icone|mark/i.test(a.name.replace(/\.[^.]+$/, "")))?.name ?? null;
  return { logo, icon: icon || logo };
}

async function persist(
  data: Extracted, assets: PackageFile[], sourceName: string, sourceHtml: string, forceId?: string, userId?: number | null,
): Promise<Brandbook> {
  const handle = data.handle || "@marca";
  let name = data.name || "Nova Marca";
  const id = forceId || (await resolveBrandId(name, handle));

  // Reimportação: preserva o nome que o usuário já curou e o status de marca oficial
  let isDefault = false;
  const existing = await prisma.carouselBrandbook.findUnique({ where: { id } });
  if (existing) {
    try { name = JSON.parse(existing.data).name || name; } catch { /* mantém */ }
    isDefault = existing.is_default;
  }

  const valid = assets.filter((a) => IMAGE_EXTS.includes(a.name.slice(a.name.lastIndexOf(".")).toLowerCase()) && !a.name.startsWith("."));
  const assetMap: Record<string, string> = {};
  for (const a of valid) {
    const ext = a.name.slice(a.name.lastIndexOf(".")).toLowerCase();
    assetMap[a.name] = `data:${MIME[ext]};base64,${a.bytes.toString("base64")}`;
  }
  const templates = data.templates;
  const { logo, icon } = pickAssetNames(templates, valid);

  const c = data.colors;
  const dark = data.isDark;
  const p600 = c.primary_600 || (dark ? "#EC1889" : DEFAULT_COLORS.primary_600);
  const up = p600.toUpperCase();
  const pick = (v: string | undefined, d: string, l: string) => v || (dark ? d : l);
  let neutral950 = pick(c.neutral_950, "#0B0B0D", DEFAULT_COLORS.neutral_950);
  let neutral50 = pick(c.neutral_50, "#F5F5F7", DEFAULT_COLORS.neutral_50);
  let neutralDark = pick(c.neutral_dark, "#0B0B0D", DEFAULT_COLORS.neutral_dark);

  let tokens: any = {};
  if (templates.length) {
    tokens = te.computeThemeTokens(templates, { neutral_950: neutral950, neutral_50: neutral50, neutral_dark: neutralDark });
    if (!tokens.defaults_used.includes("dark.bg")) neutral950 = tokens.dark.bg;
    if (!tokens.defaults_used.includes("light.bg")) { neutral50 = tokens.light.bg; neutralDark = tokens.light.text; }
  }

  const colors: BrandColors = {
    primary_600: p600,
    primary_800: c.primary_800 || (up.includes("#EC1889") ? "#C80E71" : up.includes("#FF6500") ? "#B84700" : DEFAULT_COLORS.primary_800),
    primary_100: c.primary_100 || (up.includes("#EC1889") ? "#FDE8F3" : up.includes("#FF6500") ? "#FFE8D9" : DEFAULT_COLORS.primary_100),
    primary_200: c.primary_200 || (up.includes("#EC1889") ? "#FF5CAE" : up.includes("#FF6500") ? "#FFC9A3" : DEFAULT_COLORS.primary_200),
    neutral_50: neutral50,
    neutral_100: pick(c.neutral_100, "#ECECF0", DEFAULT_COLORS.neutral_100),
    neutral_200: pick(c.neutral_200, "#26262C", DEFAULT_COLORS.neutral_200),
    neutral_600: pick(c.neutral_600, "#6E6E78", DEFAULT_COLORS.neutral_600),
    neutral_700: pick(c.neutral_700, "#A6A6B0", DEFAULT_COLORS.neutral_700),
    neutral_900: pick(c.neutral_900, "#141417", DEFAULT_COLORS.neutral_900),
    neutral_950: neutral950,
    neutral_dark: neutralDark,
    green_check: pick(c.green_check, "#2BD47D", DEFAULT_COLORS.green_check),
  };

  const [f0, f1, f2] = data.fonts;
  const titleFont = f0 || DEFAULT_TYPOGRAPHY.title_font;
  const bodyFont = f1 || DEFAULT_TYPOGRAPHY.body_font;
  const monoFont = f2 || DEFAULT_TYPOGRAPHY.mono_font;
  const typography = {
    title_font: titleFont, title_weights: data.fontWeights[titleFont] || "600;700;800",
    body_font: bodyFont, body_weights: data.fontWeights[bodyFont] || "400;500",
    mono_font: monoFont, mono_weights: data.fontWeights[monoFont] || "500",
  };

  const rules = data.rules.length ? data.rules : [
    "NUNCA use travessão (—, -, –).", "Nível de leitura simples (como para criança de 10 anos).", "Frases curtas de até 12 palavras.",
    "Sem jargões técnicos sem explicação imediata.", "Voz ativa e positiva.", "Máximo de 40 palavras no corpo por slide.",
  ];

  // Tema padrão: o do primeiro modelo de capa claro/escuro; senão o que predomina nos modelos
  let defaultTheme: "dark" | "light" = dark ? "dark" : "light";
  const themed = templates.filter((t) => t.default_bg === "dark" || t.default_bg === "light");
  if (themed.length) {
    const cover = themed.find((t) => t.archetype.startsWith("capa"));
    defaultTheme = cover ? (cover.default_bg as "dark" | "light") : themed.filter((t) => t.default_bg === "dark").length * 2 > themed.length ? "dark" : "light";
  }

  const warnings: string[] = [...(data.report.warnings || [])];
  if (!templates.length) {
    warnings.push("Nenhum modelo de slide 1080×1350 foi encontrado no HTML. Confira se o brand book tem a seção 'Modelos de slide' com blocos de 1080 × 1350 px.");
  }
  for (const t of templates) {
    if (t.html && !t.slots.some((s) => s.kind === "content" && ["title", "body", "text"].includes(s.role)) && !t.groups.length) {
      warnings.push(`Modelo ${t.code} (${t.name}): não encontrei nenhum campo de texto editável; ele só poderá ser usado com o texto original.`);
    }
  }
  if (tokens.defaults_used?.length) {
    const missingDark = tokens.defaults_used.some((d: string) => d.startsWith("dark."));
    warnings.push(`A marca não tem modelos ${missingDark ? "escuros" : "claros"}. A variante do tema ${missingDark ? "escuro" : "claro"} será gerada a partir das cores neutras da paleta.`);
  }

  const bb: Brandbook = normalizeBrandbook({
    id, name, handle, description: data.description || `Brandbook oficial importado para ${name}`, colors, typography,
    logo_filename: logo, icon_filename: icon, writing_rules: rules, slide_templates: templates, default_theme: defaultTheme,
    theme_tokens: tokens.dark ? Object.fromEntries(Object.entries(tokens).filter(([k]) => k !== "defaults_used")) : {},
    source_file: sourceName,
    import_report: {
      ...data.report, native_templates: templates.filter((t) => t.html).length, warnings, fonts: [titleFont, bodyFont, monoFont], handle,
      templates: templates.map((t) => ({
        code: t.code, name: t.name, archetype: t.archetype, theme: t.default_bg,
        fields: [...t.slots.filter((s) => s.kind === "content").map((s) => s.id), ...t.groups.map((g) => g.id)], needs_image: t.needs_image,
      })),
    },
    is_default: isDefault, assets: assetMap, source_html: sourceHtml,
  });
  return saveBrandbook(bb, userId);
}

export class BrandImportError extends Error {}

export async function importZip(zipBytes: Buffer, originalFilename: string, userId?: number | null): Promise<Brandbook> {
  if (zipBytes.length > MAX_ZIP_BYTES) throw new BrandImportError("O ZIP é grande demais (máx. 40 MB).");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch (e) {
    throw new BrandImportError(`Arquivo ZIP inválido ou corrompido: ${(e as Error).message}`);
  }

  const files: PackageFile[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const parts = path.split("/");
    if (parts.some((p) => IGNORED_DIRS.has(p.toLowerCase()))) continue;
    const name = parts[parts.length - 1];
    if (name.startsWith(".")) continue;
    files.push({ path, name, bytes: await entry.async("nodebuffer") });
  }
  const ext = (f: PackageFile) => f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  const htmlFiles = files.filter((f) => ext(f) === ".html");
  const cssFiles = files.filter((f) => ext(f) === ".css");
  const images = files.filter((f) => IMAGE_EXTS.includes(ext(f)));
  if (!htmlFiles.length) throw new BrandImportError("O ZIP não contém nenhum arquivo .html de brand book.");

  const { main, candidates } = pickBrandbookHtml(htmlFiles);
  const mainHtml = main.bytes.toString("utf8");
  const { assets, warnings } = selectAssets(mainHtml, images);
  const extracted = heuristicAnalysis(mainHtml, cssFiles.map((c) => c.bytes.toString("utf8")), originalFilename.replace(/\.[^.]+$/, ""));
  extracted.report = { source_html: main.name, html_candidates: candidates.map((c) => c.name), warnings };
  return persist(extracted, assets, main.name, mainHtml, undefined, userId);
}

/** Refaz a análise a partir do HTML guardado na importação (não exige novo upload do ZIP). */
export async function reanalyze(brandbookId: string, bb: Brandbook): Promise<Brandbook> {
  if (!bb.source_html) throw new BrandImportError("Este brandbook não tem o HTML original guardado. Importe o ZIP novamente.");
  const assets: PackageFile[] = Object.entries(bb.assets).map(([name, uri]) => ({
    path: name, name, bytes: Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64"),
  }));
  const extracted = heuristicAnalysis(bb.source_html, [], brandbookId);
  extracted.report = { source_html: bb.source_file, html_candidates: [bb.source_file], warnings: [] };
  return persist(extracted, assets, bb.source_file || "brandbook.html", bb.source_html, brandbookId);
}
