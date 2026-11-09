/**
 * Motor de modelos nativos do brand book.
 *
 * O desenho REAL de cada modelo (o bloco 1080x1350 do brand book) é:
 *   1. extraído na importação (`extractTemplates`), com os campos editáveis descobertos (título, corpo, chip,
 *      anotação, listas repetíveis, imagem...);
 *   2. preenchido em cada slide gerado (`fillTemplate`), preservando 100% do layout, fontes e cores da marca;
 *   3. convertido para a variante clara/escura quando o usuário escolhe um tema (`applyTheme`), usando as
 *      cores da própria marca em vez de estilos inventados.
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import * as cu from "./colorUtils";
import type {
  Brandbook, SlideData, SlideTemplateDef, TemplateGroup, TemplateSlot, ThemeTokens,
} from "./types";

export const FRAME_W = 1080;
export const FRAME_H = 1350;
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v"];

export function isVideoUrl(url: string): boolean {
  const clean = url.split("?")[0].split("#")[0].toLowerCase();
  return VIDEO_EXTS.some((e) => clean.endsWith(e));
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const ICON_TAGS = new Set(["i", "svg", "img"]);
export const HANDLE_TOKEN = "{handle}";
const HANDLE_RE = /^@[\w.-]{2,40}$/;
const PAG_RE = /^(\d{1,3})(\s*\/\s*)(\d{1,3})$/;
const BINDING_RE = /\{\{\s*([^}]+?)\s*\}\}/;
const BINDING_RE_G = /\{\{\s*([^}]+?)\s*\}\}/g;
const ALNUM_RE = /[0-9A-Za-zÀ-ÿ]/;

const ROLE_LABELS: Record<string, string> = {
  title: "Título",
  subtitle: "Subtítulo",
  body: "Texto de apoio",
  chip: "Chip / categoria",
  annotation: "Anotação manuscrita",
  stat: "Número de destaque",
  step_number: "Número do passo",
  number: "Número grande",
  source: "Fonte do dado",
  initials: "Iniciais (avatar)",
  author: "Nome do autor",
  author_role: "Cargo / descrição do autor",
  cta: "Botão de ação",
  label: "Rótulo fixo",
  text: "Texto",
};

// ---------------------------------------------------------------------------------------------------------------
// DOM helpers (bs4 -> cheerio)
// ---------------------------------------------------------------------------------------------------------------

type Doc = cheerio.CheerioAPI;
const isTag = (n: AnyNode | null | undefined): n is Element => !!n && n.type === "tag";
const isText = (n: AnyNode | null | undefined): n is AnyNode & { data: string } => !!n && n.type === "text";

function load(html: string): Doc {
  return cheerio.load(html, null, false);
}

function attrOf(el: Element, name: string): string | undefined {
  return el.attribs?.[name];
}
function hasAttr(el: Element, name: string): boolean {
  return !!el.attribs && Object.prototype.hasOwnProperty.call(el.attribs, name);
}
function setAttr(el: Element, name: string, value: string): void {
  el.attribs[name] = value;
}

function tagChildren(el: Element): Element[] {
  return (el.children as AnyNode[]).filter(isTag);
}

/** Todos os elementos descendentes, em ordem do documento (find_all(True)). */
function descendants(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (n: Element) => {
    for (const c of n.children as AnyNode[]) {
      if (isTag(c)) {
        out.push(c);
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}

function findByAttr(root: Element, name: string, value?: string): Element[] {
  return descendants(root).filter((e) => hasAttr(e, name) && (value === undefined || attrOf(e, name) === value));
}

function textNodes(root: Element): (AnyNode & { data: string })[] {
  const out: (AnyNode & { data: string })[] = [];
  const walk = (n: Element) => {
    for (const c of n.children as AnyNode[]) {
      if (isText(c)) out.push(c);
      else if (isTag(c)) walk(c);
    }
  };
  walk(root);
  return out;
}

export function normWs(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function getText(el: Element, sep = ""): string {
  return textNodes(el).map((t) => t.data).join(sep);
}

function removeNode(n: AnyNode): void {
  const parent = n.parent as Element | null;
  if (!parent) return;
  const i = parent.children.indexOf(n as any);
  if (i >= 0) parent.children.splice(i, 1);
  (n as any).parent = null;
  if ((n as any).prev) (n as any).prev.next = (n as any).next;
  if ((n as any).next) (n as any).next.prev = (n as any).prev;
  (n as any).prev = (n as any).next = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Estilos inline
// ---------------------------------------------------------------------------------------------------------------

export function splitDecls(style: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of style || "") {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((d) => d.trim()).filter(Boolean);
}

export function parseStyle(style: string | null | undefined): Record<string, string> {
  const d: Record<string, string> = {};
  for (const decl of splitDecls(style || "")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    d[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return d;
}

export function dumpStyle(d: Record<string, string>): string {
  return Object.entries(d).map(([k, v]) => `${k}:${v}`).join(";");
}

function styleOf(el: Element | null | undefined): Record<string, string> {
  return isTag(el) ? parseStyle(attrOf(el, "style")) : {};
}

/** props em camelCase/snake_case; null remove a propriedade. */
export function setStyle(el: Element, props: Record<string, string | null | undefined>): void {
  const d = styleOf(el);
  for (const [k, v] of Object.entries(props)) {
    const key = k.replace(/_/g, "-");
    if (v === null || v === undefined) delete d[key];
    else d[key] = v;
  }
  setAttr(el, "style", dumpStyle(d));
}

function px(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^\s*(-?[\d.]+)px\s*$/.exec(value);
  return m ? parseFloat(m[1]) : null;
}

function inherited(el: Element, prop: string): string | null {
  let node: AnyNode | null = el;
  while (isTag(node)) {
    const v = styleOf(node)[prop];
    if (v) return v;
    node = node.parent as AnyNode | null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Localização dos modelos no HTML do brand book
// ---------------------------------------------------------------------------------------------------------------

function isFrame(el: Element): boolean {
  const s = (attrOf(el, "style") || "").replace(/ /g, "").toLowerCase();
  return s.includes("width:1080px") && s.includes("height:1350px");
}

function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  let p = el.parent as AnyNode | null;
  while (isTag(p)) {
    out.push(p);
    p = p.parent as AnyNode | null;
  }
  return out;
}

function allElements($: Doc): Element[] {
  const out: Element[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (isTag(n)) {
        out.push(n);
        walk(n.children as AnyNode[]);
      }
    }
  };
  walk($.root().toArray()[0].children as AnyNode[]);
  return out;
}

/** Acha os slides de 1080x1350. Prefere marcações explícitas (data-slide / data-screen-label). */
function findFrames($: Doc): Element[] {
  let frames = allElements($).filter(isFrame);
  frames = frames.filter((f) => !ancestors(f).some(isFrame));
  const explicit = frames.filter((f) => hasAttr(f, "data-slide"));
  if (explicit.length) return explicit;
  const labeled = frames.filter((f) => hasAttr(f, "data-screen-label"));
  if (labeled.length) return labeled;
  return frames.filter((f) => normWs(getText(f, " ")) && descendants(f).length >= 3);
}

export function countFrames(htmlRaw: string): number {
  try {
    return findFrames(load(htmlRaw)).length;
  } catch {
    return 0;
  }
}

const LABEL_RE = /^\s*(?:T\s*)?(\d{1,2})\s*[·.\-:|]\s*(.+?)\s*$/i;

function textParts(el: Element): string[] {
  return textNodes(el).map((t) => t.data.trim()).filter(Boolean).join(" | ").split(/\s*\|\s*/).filter(Boolean);
}

function frameLabel(frame: Element, index: number): [string, string, string] {
  let code = "";
  if (hasAttr(frame, "data-slide")) code = attrOf(frame, "data-slide")!.trim().toUpperCase();
  let name = "";
  let desc = "";

  if (hasAttr(frame, "data-screen-label")) {
    const m = /^\s*(\d{1,2})\s+(.+)$/.exec(attrOf(frame, "data-screen-label")!);
    if (m) {
      code = code || `T${String(parseInt(m[1], 10)).padStart(2, "0")}`;
      name = m[2].trim();
    }
  }

  // rótulo textual ao lado do frame (irmãos dos ancestrais próximos)
  let node: Element | null = frame;
  for (let depth = 0; depth < 4; depth++) {
    if (!node || !node.parent) break;
    const sibs: Element[] = [];
    let p = node.prev as AnyNode | null;
    for (let i = 0; i < 2 && p; i++, p = p.prev as AnyNode | null) if (isTag(p)) sibs.push(p);
    let n = node.next as AnyNode | null;
    for (let i = 0; i < 2 && n; i++, n = n.next as AnyNode | null) if (isTag(n)) sibs.push(n);
    for (const sib of sibs) {
      if (isFrame(sib) || descendants(sib).some(isFrame)) continue;
      let parts = textParts(sib);
      if (!parts.length) continue;
      let m = LABEL_RE.exec(parts[0]);
      const bare = /^T?\s*(\d{1,2})$/i.exec(parts[0]);
      if (bare && parts.length >= 2) {
        // "T01 | Capa escura | descrição": código e nome em elementos separados
        m = LABEL_RE.exec(`${parts[0]} · ${parts[1]}`);
        parts = [`${parts[0]} · ${parts[1]}`, ...parts.slice(2)];
      }
      if (m) {
        const labCode = `T${String(parseInt(m[1], 10)).padStart(2, "0")}`;
        if (!code || code === labCode) {
          code = labCode;
          name = m[2].trim();
          const rest = parts.slice(1).join(" ").trim();
          desc = rest.replace(/^[—–\-:\s]+/, "");
          const m2 = /^(.*?)\s+[—–]\s+(.+)$/.exec(name);
          if (m2 && !desc) {
            name = m2[1].trim();
            desc = m2[2].trim();
          }
          break;
        }
      }
    }
    if (name) break;
    node = isTag(node.parent as AnyNode) ? (node.parent as Element) : null;
  }

  code = code || `T${String(index).padStart(2, "0")}`;
  if (code && !/^T\d+$/.test(code)) code = code.toUpperCase();
  return [code, name || `Modelo ${code}`, desc];
}

// ---------------------------------------------------------------------------------------------------------------
// Limpeza do frame
// ---------------------------------------------------------------------------------------------------------------

function hintBool(el: Element): boolean | null {
  const hint = (attrOf(el, "hint-placeholder-val") || "").toLowerCase();
  if (hint.includes("false")) return false;
  if (hint.includes("true")) return true;
  return null;
}

function unwrap($: Doc, el: Element): void {
  $(el).replaceWith($(el).contents());
}

/** Copia o frame e remove tudo que é do editor do brand book (guias, zoom, sc-if...). Devolve [doc, raiz]. */
function cleanFrame(frame: Element, $src: Doc): [Doc, Element] {
  const $ = load($src.html(frame));
  const f = $.root().children().first().get(0) as Element;

  for (const t of descendants(f).filter((e) => e.name === "script" || e.name === "style")) $(t).remove();
  $.root().find("*").contents().each((_i, n) => {
    if (n.type === "comment") $(n).remove();
  });

  // sc-if: guias/margem segura somem; blocos "true" (paginação) permanecem
  for (const sc of descendants(f).filter((e) => e.name === "sc-if")) {
    if (hintBool(sc) === false) $(sc).remove();
    else unwrap($, sc);
  }

  // image-slot vira um contêiner de imagem preenchível
  let nImg = 0;
  for (const slot of descendants(f).filter((e) => e.name === "image-slot")) {
    nImg++;
    const shape = attrOf(slot, "shape") || "rect";
    const st: Record<string, string> = { width: "100%", height: "100%", position: "relative", overflow: "hidden" };
    if (shape === "circle") st["border-radius"] = "50%";
    const holder = $("<div></div>");
    holder.attr("data-image-slot", nImg === 1 ? "image" : `image_${nImg}`);
    holder.attr("data-shape", shape);
    if (attrOf(slot, "placeholder")) holder.attr("data-placeholder", attrOf(slot, "placeholder")!);
    holder.attr("style", dumpStyle(st));
    $(slot).replaceWith(holder);
  }

  // atributos do editor
  for (const el of [f, ...descendants(f)]) {
    for (const attr of Object.keys(el.attribs)) {
      if (
        attr.startsWith("hint-") || attr === "contenteditable" || attr === "id" || attr === "data-dc-id" ||
        attr.startsWith("data-dc") || attr.toLowerCase().startsWith("on")
      ) delete el.attribs[attr]; // sem handlers inline vindos do HTML importado
    }
  }

  // frame: sem zoom/transform, dimensões travadas
  const d = styleOf(f);
  for (const k of ["zoom", "transform", "transform-origin", "margin"]) delete d[k];
  Object.assign(d, { position: "relative", width: `${FRAME_W}px`, height: `${FRAME_H}px`, overflow: "hidden", "box-sizing": "border-box" });
  setAttr(f, "style", dumpStyle(d));
  delete f.attribs["data-slide"];
  delete f.attribs["data-screen-label"];
  setAttr(f, "data-tpl-root", "1");

  // imagens de asset: resolvidas na hora do render
  for (const img of descendants(f).filter((e) => e.name === "img")) {
    const src = attrOf(img, "src") || "";
    if (src && !src.startsWith("data:") && !src.startsWith("http")) {
      setAttr(img, "data-asset", src.split(/[\\/]/).pop() || src);
      setAttr(img, "src", "");
    }
  }
  return [$, f];
}

// ---------------------------------------------------------------------------------------------------------------
// Dados de exemplo (renderVals) do brand book
// ---------------------------------------------------------------------------------------------------------------

function matchBracket(text: string, start: number): number {
  let depth = 0;
  let i = start;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Extrai arrays literais do renderVals(): listItems, compareBad, etc. */
function parseJsLists(htmlRaw: string): Record<string, (string | Record<string, string>)[]> {
  const out: Record<string, (string | Record<string, string>)[]> = {};
  const m0 = /renderVals\s*\(\s*\)\s*\{/.exec(htmlRaw);
  if (!m0) return out;
  const body = htmlRaw.slice(m0.index + m0[0].length);
  const strq = `(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`;
  const listRe = /(\w+)\s*:\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = listRe.exec(body))) {
    const end = matchBracket(body, m.index + m[0].length - 1);
    if (end === -1) continue;
    const inner = body.slice(m.index + m[0].length, end);
    if (inner.includes("{")) {
      const items: Record<string, string>[] = [];
      for (const obj of inner.matchAll(/\{([^{}]*)\}/g)) {
        const rec: Record<string, string> = {};
        for (const kv of obj[1].matchAll(new RegExp(`(\\w+)\\s*:\\s*${strq}`, "g"))) {
          rec[kv[1]] = (kv[2] ?? kv[3] ?? "").replace(/\\'/g, "'");
        }
        if (Object.keys(rec).length) items.push(rec);
      }
      if (items.length) out[m[1]] = items;
    } else {
      const items = [...inner.matchAll(new RegExp(strq, "g"))].map((x) => (x[1] ?? x[2] ?? "").replace(/\\'/g, "'"));
      if (items.length) out[m[1]] = items;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Análise de campos
// ---------------------------------------------------------------------------------------------------------------

interface Leaf {
  el: Element;
  plain: string;
  markdown: string;
  tag: string;
  fs: number;
  kind: string;
  color: string | null;
  pill: boolean;
  boxed: boolean;
  avatar: boolean;
  order: number;
  binding: string | null;
  hlColor: string | null;
  hasIcon: boolean;
  hasRich: boolean;
}

function directText(el: Element): string {
  return (el.children as AnyNode[]).filter(isText).map((c) => c.data).join("").trim();
}
const isLeafEl = (el: Element) => !!directText(el);

/** Folhas de texto em ordem do documento, sem descer dentro de uma folha. */
function* walkLeaves(root: Element): Generator<Element> {
  for (const child of root.children as AnyNode[]) {
    if (!isTag(child)) continue;
    if (child.name === "svg" || child.name === "script" || child.name === "style") continue;
    if (isLeafEl(child)) yield child;
    else yield* walkLeaves(child);
  }
}
const walkLeavesList = (el: Element): Element[] => (isLeafEl(el) ? [el] : [...walkLeaves(el)]);

/** Assinatura estrutural: tag, tipografia e filhos. Ignora bordas/margens. */
function sig(el: Element): string {
  const st = styleOf(el);
  return JSON.stringify([el.name, st["font-size"], st["font-family"], st["display"], st["flex-direction"], tagChildren(el).map(sig)]);
}

class FrameAnalyzer {
  slots: TemplateSlot[] = [];
  groups: TemplateGroup[] = [];
  roleCount: Record<string, number> = {};
  orderOf = new Map<Element, number>();
  avatarOrder: number | null = null;
  afterAvatar: string[] = [];
  headingSeen = false;
  bodySeen = false;
  meta = { has_image: false, has_progress: false, n_labels: 0 };
  private fonts: Record<string, string>;

  constructor(
    private $: Doc,
    private frame: Element,
    fonts: Record<string, string>,
    private primary: string | null,
    private jsLists: Record<string, (string | Record<string, string>)[]>,
  ) {
    this.fonts = Object.fromEntries(Object.entries(fonts).map(([k, v]) => [k, (v || "").toLowerCase()]));
  }

  private kindOf(el: Element): string {
    const fam = (inherited(el, "font-family") || "").toLowerCase();
    if (fam.includes("handwritten") || fam.includes("caveat") || fam.includes("cursive")) return "hand";
    if (fam.includes("mono")) return "mono";
    const title = this.fonts.title || "";
    if (fam.includes("var(--font-title)") || (title && fam.includes(title))) return "title";
    return "body";
  }

  private fsOf(el: Element): number {
    return px(inherited(el, "font-size")) || 16;
  }

  private markdownOf(el: Element): { md: string; hl: string | null; hasRich: boolean; hasIcon: boolean } {
    const parts: string[] = [];
    let hl: string | null = null;
    let hasRich = false;
    let hasIcon = false;
    const baseColor = (styleOf(el).color || inherited(el, "color") || "").toLowerCase();

    const walk = (node: Element, inHl: boolean) => {
      for (const c of node.children as AnyNode[]) {
        if (c.type === "comment") continue;
        if (isText(c)) {
          const t = c.data;
          if (!normWs(t)) { parts.push(t ? " " : ""); continue; }
          parts.push(inHl ? `**${t}**` : t);
        } else if (isTag(c)) {
          if (c.name === "br") parts.push("\n");
          else if (ICON_TAGS.has(c.name)) hasIcon = true;
          else if (["span", "strong", "b", "em", "mark", "u"].includes(c.name)) {
            const col = (styleOf(c).color || "").toLowerCase();
            const highlighted = !!col && col !== baseColor && !inHl && c.name !== "u";
            if (highlighted) {
              hasRich = true;
              hl = hl || styleOf(c).color;
            }
            walk(c, inHl || highlighted);
          } else walk(c, inHl);
        }
      }
    };
    walk(el, false);
    let md = parts.join("");
    md = md.replace(/\*\*\s*\*\*/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
    return { md, hl, hasRich, hasIcon };
  }

  private leaf(el: Element): Leaf {
    const { md, hl, hasRich, hasIcon } = this.markdownOf(el);
    const plain = normWs(md.replace(/\*\*/g, ""));
    const st = styleOf(el);
    const radius = st["border-radius"] || "";
    const radiusPx = px(radius) || (radius.includes("999") || radius.includes("50%") ? 999 : 0);
    const w = px(st.width);
    const h = px(st.height);
    const avatar = !!radius && radiusPx >= 40 && w !== null && h !== null && Math.abs(w - h) < 2 &&
      plain.length <= 3 && plain.toUpperCase() === plain;
    const bg = st.background || st["background-color"];
    let boxed = !!(bg && cu.parseColor(bg)) || /(^|\s)\d+px\s+solid/.test(st.border || "");
    const parent = el.parent as AnyNode | null;
    if (!boxed && isTag(parent)) {
      const pst = styleOf(parent);
      boxed = ["1", "1 1 0", "1 1 0%"].includes(st.flex) && pst.display === "flex";
    }
    const pill = !!radius && radiusPx >= 100 && (boxed || "border" in st);
    return {
      el, plain, markdown: md, tag: el.name, fs: this.fsOf(el), kind: this.kindOf(el),
      color: inherited(el, "color"), pill, boxed, avatar, order: this.orderOf.get(el) ?? 0,
      binding: null, hlColor: hl, hasIcon, hasRich,
    };
  }

  private count(role: string) { return this.roleCount[role] || 0; }
  private nextId(role: string) {
    const n = this.count(role) + 1;
    this.roleCount[role] = n;
    return n === 1 ? role : `${role}_${n}`;
  }

  /** (papel, tipo) do texto. null = decoração (setas, aspas...). */
  private role(lf: Leaf, inGroup: boolean): [string, "auto" | "content" | "label"] | null {
    const t = lf.plain;
    const core = t.replace(BINDING_RE_G, "").trim();
    if (!core && !BINDING_RE.test(t)) return null;
    if (!ALNUM_RE.test(core) && !BINDING_RE.test(t)) return null;
    const words = t.split(/\s+/).filter(Boolean).length;

    if (!inGroup) {
      if (HANDLE_RE.test(t) || t === HANDLE_TOKEN || t === "{{ handle }}") return ["handle", "auto"];
      if (PAG_RE.test(t)) return ["pagination", "auto"];
    }
    if (lf.avatar) return ["initials", "auto"];
    const digits = /^\d{1,3}$/.test(t);
    if (digits && lf.fs >= 150) return [lf.kind === "mono" ? "step_number" : "number", "content"];
    if (lf.fs >= 200 && t.length <= 10) return ["stat", "content"];
    if (HEADING_TAGS.has(lf.tag)) return [this.count("title") === 0 ? "title" : "subtitle", "content"];
    if (lf.kind === "hand") return ["annotation", "content"];
    if (this.avatarOrder !== null && lf.order > this.avatarOrder && this.afterAvatar.length < 2 && lf.kind !== "mono") {
      const role = !this.afterAvatar.length ? "author" : "author_role";
      this.afterAvatar.push(role);
      return [role, "content"];
    }
    if (/^\s*(fonte|source)\b/i.test(t)) return ["source", "content"];
    if (lf.tag === "p") return ["body", "content"];
    if (lf.kind === "mono" && lf.fs <= 36 && (lf.pill || lf.boxed)) return ["chip", "content"];
    if (lf.kind === "mono" && lf.fs <= 36 && !lf.boxed) {
      if (!this.headingSeen && this.count("chip") === 0 && (t === t.toUpperCase() || words <= 3) && words <= 5) return ["chip", "content"];
      return ["label", "label"];
    }
    if (lf.boxed && lf.fs >= 28 && words <= 6 && lf.kind !== "mono") return ["cta", "content"];
    if (lf.fs >= 56) return [this.count("title") === 0 ? "title" : "body", "content"];
    if (lf.tag !== "p" && lf.fs <= 34 && (words <= 2 || (lf.hasIcon && words <= 4)) && lf.kind !== "title") return ["label", "label"];
    return ["text", "content"];
  }

  private budget(role: string, sample: string): number | null {
    const n = sample.length;
    if (role === "handle") return null;
    if (["chip", "annotation", "label", "cta", "author", "author_role", "step_number", "number", "stat", "initials"].includes(role)) {
      return Math.max(Math.floor(n * 1.6), role !== "stat" ? 14 : 6);
    }
    if (role === "title") return Math.max(Math.floor(n * 1.5), 36);
    if (role === "source") return Math.max(Math.floor(n * 1.6), 40);
    return Math.max(Math.floor(n * 2.0), 80);
  }

  private register(lf: Leaf, role: string, kind: "auto" | "content" | "label"): TemplateSlot {
    let sid = this.nextId(role);
    if (["label", "text", "cta"].includes(role)) sid = `${role}_${this.count(role)}`; // ids sempre numerados
    let label = ROLE_LABELS[role] || "Texto";
    if (role === "cta") label = `Botão de ação ${this.count(role)}`;
    else if ((role === "label" || role === "text") && this.count(role) > 1) label = `${label} ${this.count(role)}`;
    const rich = ["title", "body", "text", "subtitle"].includes(role) || lf.hasRich;
    const sample = lf.markdown;
    const slot: TemplateSlot = {
      id: sid, role, label, kind, rich,
      multiline: role === "body" || role === "text" || sample.length > 60,
      sample: sample.replace(/\{\{ handle \}\}/g, HANDLE_TOKEN), max_chars: this.budget(role, sample),
    };
    setAttr(lf.el, "data-slot", sid);
    if (lf.hlColor) setAttr(lf.el, "data-hl", lf.hlColor);
    if (role === "title" || role === "stat") setAttr(lf.el, "data-fit", "1");
    else if (["body", "subtitle", "text"].includes(role)) setAttr(lf.el, "data-fit", "2");
    return slot;
  }

  // -- grupos ---------------------------------------------------------------------------------------------
  private markScForGroups(): void {
    const $ = this.$;
    let n = 0;
    for (const sc of descendants(this.frame).filter((e) => e.name === "sc-for")) {
      n++;
      const kids = tagChildren(sc);
      if (!kids.length) { $(sc).remove(); continue; }
      const listName = (attrOf(sc, "list") || "").replace(BINDING_RE_G, (_m, g1) => g1).trim();
      const count = parseInt(attrOf(sc, "hint-placeholder-count") || "3", 10) || 3;
      const item = kids[0];
      setAttr(item, "data-group-pending", `g${n}`);
      setAttr(item, "data-count", String(count));
      setAttr(item, "data-listname", listName);
      setAttr(item, "data-alias", attrOf(sc, "as") || "it");
      unwrap($, sc);
    }
  }

  private markStaticGroups(): void {
    const containers = [this.frame, ...descendants(this.frame).filter((t) => t.name !== "svg" && t.name !== "path")];
    let n = 100;
    for (const cont of containers) {
      const kids = tagChildren(cont).filter((c) => !["svg", "path", "img", "i"].includes(c.name));
      if (kids.length < 3) continue;
      const sigs = kids.map(sig);
      let i = 0;
      while (i < kids.length) {
        let j = i;
        while (j + 1 < kids.length && sigs[j + 1] === sigs[i]) j++;
        const run = kids.slice(i, j + 1);
        if (run.length >= 3 && run.every((k) => walkLeavesList(k).length) && !run.some((k) => hasAttr(k, "data-group-pending"))) {
          n++;
          run.forEach((k, idx) => {
            setAttr(k, "data-group-pending", `g${n}`);
            setAttr(k, "data-idx", String(idx));
          });
          setAttr(run[0], "data-count", String(run.length));
        }
        i = j + 1;
      }
    }
  }

  private itemLeaves(item: Element): Leaf[] {
    const els = isLeafEl(item) ? [item] : [...walkLeaves(item)];
    return els.map((el) => {
      const lf = this.leaf(el);
      const m = BINDING_RE.exec(lf.plain);
      if (m) lf.binding = m[1].split(".").pop()!.trim();
      return lf;
    });
  }

  private buildGroups(): void {
    const pending = new Map<string, Element[]>();
    for (const el of findByAttr(this.frame, "data-group-pending")) {
      const k = attrOf(el, "data-group-pending")!;
      pending.set(k, [...(pending.get(k) || []), el]);
    }

    let gnum = 0;
    for (const [gidRaw, items] of pending) {
      gnum++;
      const first = items[0];
      const leaves = this.itemLeaves(first).filter((lf) => lf.binding || ALNUM_RE.test(lf.plain.replace(BINDING_RE_G, "")));
      const itemSlots: TemplateSlot[] = [];
      const used: Record<string, number> = {};
      const uniq = (name: string) => {
        used[name] = (used[name] || 0) + 1;
        return used[name] === 1 ? name : `${name}_${used[name]}`;
      };

      for (const lf of leaves) {
        const t = lf.plain;
        const bnd = (lf.binding || "").toLowerCase();
        let role: string;
        if (["n", "num", "number", "i", "idx", "index"].includes(bnd)) role = "number";
        else if (["t", "title", "titulo", "name", "h"].includes(bnd)) role = "title";
        else if (["d", "desc", "description", "descricao", "text", "body"].includes(bnd)) role = "description";
        else if (/^\d{1,3}$/.test(t) || (lf.kind === "mono" && /^[\d.]+$/.test(t))) role = "number";
        else if (leaves.length === 1 || bnd === "c") role = "text";
        else if (lf.tag === "strong" || (lf.kind === "title" && lf.fs >= 34)) role = "title";
        else role = "description";
        if (leaves.length === 1 && role !== "number") role = "text";
        const sid = uniq(role);
        const sample = !BINDING_RE.test(lf.plain) ? lf.markdown : "";
        itemSlots.push({
          id: sid, role, kind: "content", rich: ["title", "text", "description"].includes(role),
          label: ({ number: "Número", title: "Título do item", description: "Descrição", text: "Item" } as Record<string, string>)[role],
          multiline: false,
          sample, max_chars: this.budget(role === "title" ? "title" : role === "description" ? "body" : "chip", sample || "x".repeat(30)),
        });
        setAttr(lf.el, "data-item-slot", sid);
        setAttr(lf.el, "data-fit", "3");
        setAttr(lf.el, "data-fit-group", gidRaw);
        if (lf.binding) setAttr(lf.el, "data-bind", lf.binding);
        if (lf.hlColor) setAttr(lf.el, "data-hl", lf.hlColor);
      }

      // exemplos: do JS (renderVals) ou do próprio DOM
      const sampleItems: Record<string, string>[] = [];
      const listName = attrOf(first, "data-listname");
      if (listName && this.jsLists[listName]) {
        for (const rec of this.jsLists[listName]) {
          const row: Record<string, string> = {};
          for (const sl of itemSlots) {
            let bnd = "";
            for (const lf of leaves) if (attrOf(lf.el, "data-item-slot") === sl.id) bnd = lf.binding || "";
            row[sl.id] = typeof rec === "object" ? rec[bnd] || "" : String(rec);
          }
          sampleItems.push(row);
        }
      } else {
        for (const it of items) {
          const row: Record<string, string> = {};
          const lfs = this.itemLeaves(it).filter((x) => ALNUM_RE.test(x.plain.replace(BINDING_RE_G, "")));
          itemSlots.forEach((sl, k) => { if (lfs[k]) row[sl.id] = lfs[k].markdown; });
          if (Object.keys(row).length) sampleItems.push(row);
        }
      }
      for (const sl of itemSlots) if (!sl.sample && sampleItems.length) sl.sample = sampleItems[0][sl.id] || "";

      const declared = parseInt(attrOf(first, "data-count") || String(items.length), 10) || items.length;
      const maxItems = Math.max(declared, sampleItems.length, 2);
      const gid = pending.size === 1 ? "items" : `items_${gnum}`;
      const label = this.groupLabel(first);
      for (const it of items) {
        setAttr(it, "data-group", gid);
        for (const a of ["data-group-pending", "data-count", "data-idx", "data-listname", "data-alias"]) delete it.attribs[a];
      }
      this.groups.push({
        id: gid, label, min_items: maxItems >= 3 ? 2 : 1, max_items: maxItems,
        item_slots: itemSlots, sample_items: sampleItems.slice(0, maxItems),
      });
    }
  }

  private groupLabel(first: Element): string {
    let node: Element | null = first;
    for (let i = 0; i < 3; i++) {
      if (!node) break;
      let prev = node.prev as AnyNode | null;
      while (prev && !isTag(prev)) prev = prev.prev as AnyNode | null;
      if (prev && isTag(prev)) {
        const txt = normWs(getText(prev, " "));
        if (txt && txt.length <= 30) return `Itens (${txt})`;
      }
      node = isTag(node.parent as AnyNode) ? (node.parent as Element) : null;
    }
    return "Itens da lista";
  }

  private markProgress(): void {
    for (const el of descendants(this.frame).filter((e) => e.name === "div")) {
      const st = styleOf(el);
      if (!(st.background || st["background-color"])) continue;
      const w = st.width || "";
      const h = px(st.height);
      const par = el.parent as AnyNode | null;
      if (h === null || h > 16 || !isTag(par) || tagChildren(par).length !== 1) continue;
      const pst = styleOf(par);
      const ph = px(pst.height);
      if (ph === null || Math.abs(ph - h) > 1) continue;
      if (w.endsWith("%") || px(w) !== null) {
        setAttr(el, "data-slot", "progress");
        if (px(pst.width)) setAttr(el, "data-progress-w", String(Math.trunc(px(pst.width)!)));
        this.meta.has_progress = true;
        return;
      }
    }
  }

  run(): void {
    descendants(this.frame).forEach((el, i) => this.orderOf.set(el, i));

    this.markScForGroups();
    this.markStaticGroups();
    this.buildGroups();
    this.markProgress();

    // imagens
    for (const h of findByAttr(this.frame, "data-image-slot")) {
      this.meta.has_image = true;
      if (attrOf(h, "data-shape") === "circle" && this.avatarOrder === null) this.avatarOrder = this.orderOf.get(h) ?? 0;
      this.slots.push({
        id: attrOf(h, "data-image-slot")!, role: "image", label: "Imagem", kind: "content", rich: false, multiline: false,
        sample: attrOf(h, "data-placeholder") || "", max_chars: null,
      });
    }

    // folhas fora de grupos
    const grouped = new Set<Element>();
    for (const g of findByAttr(this.frame, "data-group")) {
      grouped.add(g);
      descendants(g).forEach((x) => grouped.add(x));
    }
    const leaves = [...walkLeaves(this.frame)].filter((el) => !grouped.has(el) && !hasAttr(el, "data-slot")).map((el) => this.leaf(el));

    // avatar (iniciais) antes de classificar autor/cargo
    for (const lf of leaves) if (lf.avatar && this.avatarOrder === null) this.avatarOrder = lf.order;

    for (const lf of leaves) {
      const res = this.role(lf, false);
      if (!res) continue;
      const [role, kind] = res;
      if (role === "title" || role === "stat" || role === "step_number") this.headingSeen = true;
      if (role === "handle") { setAttr(lf.el, "data-slot", "handle"); continue; }
      if (role === "pagination") {
        const m = PAG_RE.exec(lf.plain)!;
        setAttr(lf.el, "data-slot", "pagination");
        setAttr(lf.el, "data-pag-sep", m[2]);
        setAttr(lf.el, "data-pag-w", String(m[1].length));
        continue;
      }
      if (role === "initials") {
        setAttr(lf.el, "data-slot", "initials");
        this.slots.push({
          id: "initials", role: "initials", label: ROLE_LABELS.initials, kind: "auto", rich: false, multiline: false,
          sample: lf.plain, max_chars: null,
        });
        continue;
      }
      if (role === "label") this.meta.n_labels++;
      this.slots.push(this.register(lf, role, kind));
      if (["body", "text", "subtitle"].includes(role)) this.bodySeen = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Classificação da função do modelo
// ---------------------------------------------------------------------------------------------------------------

const ARCH_RULES: [string, RegExp][] = [
  ["afirmacao", /afirma|anota isso|ideia forte/],
  ["passo", /passo|tutorial/],
  ["capa", /\bcapa\b|\bcover\b/],
  ["cta", /\bcta\b|fechamento|último slide|ultimo slide/],
  ["depoimento", /cita[çc][ãa]o|depoimento|prova social|quote/],
  ["comparativo", /comparativo|antes e depois|antes\/depois|versus|\bvs\b/],
  ["conversa", /conversa|\bchat\b|whatsapp/],
  ["print", /print|\btela\b|screenshot/],
  ["dado", /n[úu]mero de destaque|\bdado\b|estat[íi]stica|n[úu]mero de impacto/],
  ["lista", /\blista\b|checklist/],
  ["topico", /t[óo]pico|explicativo/],
];

function deriveArchetype(
  name: string, desc: string, slots: TemplateSlot[], groups: TemplateGroup[], needsImage: boolean, position: number, total: number,
): string {
  for (const text of [name.toLowerCase(), desc.toLowerCase()]) {
    for (const [arch, rx] of ARCH_RULES) {
      if (rx.test(text)) {
        if (arch === "capa") {
          if (/imagem|foto/.test(text)) return "capa_imagem";
          if (/color|rosa|vibrante|prim[áa]ria/.test(text)) return "capa_rosa";
        }
        return arch;
      }
    }
  }
  const roles = new Set(slots.map((s) => s.role));
  if (groups.length >= 2) return "comparativo";
  if (groups.length) return "lista";
  if (roles.has("stat")) return "dado";
  if (roles.has("author")) return "depoimento";
  if (roles.has("step_number")) return "passo";
  if (slots.some((s) => s.role === "cta")) return "cta";
  if (needsImage) return position === 1 ? "capa_imagem" : "print";
  if (roles.has("annotation")) return "afirmacao";
  if (position === 1) return "capa";
  if (position === total) return "cta";
  return "topico";
}

// ---------------------------------------------------------------------------------------------------------------
// Extração completa
// ---------------------------------------------------------------------------------------------------------------

function frameBackground(root: Element): string | null {
  const st = styleOf(root);
  return st.background || st["background-color"] || null;
}

export function extractTemplates(htmlRaw: string, fonts: Record<string, string>, primary: string | null = null): SlideTemplateDef[] {
  const $src = load(htmlRaw);
  const frames = findFrames($src);
  const jsLists = parseJsLists(htmlRaw);

  const result: SlideTemplateDef[] = [];
  const seen = new Set<string>();
  frames.forEach((fr, i) => {
    const idx = i + 1;
    let [code, name, desc] = frameLabel(fr, idx);
    if (seen.has(code)) code = `${code}_${idx}`;
    seen.add(code);

    const [$c, clean] = cleanFrame(fr, $src);
    const an = new FrameAnalyzer($c, clean, fonts, primary, jsLists);
    an.run();

    const bgKind = cu.classifyBackground(frameBackground(clean), primary) || "dark";
    const archetype = deriveArchetype(name, desc, an.slots, an.groups, an.meta.has_image, idx, frames.length);
    result.push({
      code, name, archetype, description: desc || null, default_bg: bgKind, html: $c.html(clean),
      slots: an.slots, groups: an.groups, needs_image: an.meta.has_image,
    });
  });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Temas: variante clara / escura da marca
// ---------------------------------------------------------------------------------------------------------------

function frameColors(tpl: SlideTemplateDef) {
  const $ = load(tpl.html || "");
  const root = $.root().children().first().get(0) as Element | undefined;
  if (!root || !hasAttr(root, "data-tpl-root")) return {} as Record<string, string | null>;
  let titleColor: string | null = null;
  let hl: string | null = null;
  let ann: string | null = null;
  for (const el of findByAttr(root, "data-slot")) {
    const role = tpl.slots.find((s) => s.id === attrOf(el, "data-slot"))?.role;
    if (role === "title") {
      titleColor = titleColor || inherited(el, "color");
      if (attrOf(el, "data-hl")) hl = hl || attrOf(el, "data-hl")!;
    } else if (role === "annotation") ann = ann || inherited(el, "color");
  }
  return { bg: frameBackground(root), text: titleColor || styleOf(root).color || null, hl, annotation: ann };
}

const NEUTRAL_MAX = 0.03; // croma abaixo disso: cinza puro (define os extremos do tema)
const TINT_MAX = 0.09; // croma abaixo disso: neutro ou tom suave da marca

function mostCommon(lst: string[]): string | null {
  if (!lst.length) return null;
  const counts = new Map<string, number>();
  for (const v of lst) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const rgbOf = (c: cu.RGBA): cu.RGB => [c[0], c[1], c[2]];

export function computeThemeTokens(templates: SlideTemplateDef[], palette: Record<string, string>): ThemeTokens & { defaults_used: string[] } {
  const tokens: any = { dark: {}, light: {}, asset_filter: { dark: {}, light: {} } };
  for (const theme of ["dark", "light"] as const) {
    const bgs: string[] = [], texts: string[] = [], hls: string[] = [], anns: string[] = [];
    for (const t of templates) {
      if (t.default_bg !== theme || !t.html) continue;
      const c = frameColors(t);
      ([[bgs, "bg"], [texts, "text"], [hls, "hl"], [anns, "annotation"]] as [string[], string][]).forEach(([lst, key]) => {
        const v = c[key];
        if (v) lst.push(v.trim().toLowerCase());
      });
      const $ = load(t.html);
      const root = $.root().children().first().get(0) as Element | undefined;
      if (root && hasAttr(root, "data-tpl-root")) {
        for (const img of descendants(root).filter((e) => e.name === "img" && hasAttr(e, "data-asset"))) {
          const flt = styleOf(img).filter || "";
          const key = attrOf(img, "data-asset")!;
          if (!(key in tokens.asset_filter[theme])) tokens.asset_filter[theme][key] = flt;
        }
      }
    }
    const pickNeutral = (values: string[]) => {
      const neutral = values.filter((v) => {
        const p = cu.parseColor(v);
        return p && cu.chroma(rgbOf(p)) < NEUTRAL_MAX;
      });
      return mostCommon(neutral) || mostCommon(values);
    };
    tokens[theme] = { bg: pickNeutral(bgs), text: pickNeutral(texts), hl: mostCommon(hls), annotation: mostCommon(anns) };
  }

  const defaults = {
    dark: { bg: palette.neutral_950 || "#0B0B0D", text: "#FFFFFF" },
    light: { bg: palette.neutral_50 || "#F5F5F7", text: palette.neutral_dark || palette.neutral_950 || "#0B0B0D" },
  };
  for (const theme of ["dark", "light"] as const) {
    for (const k of ["bg", "text"] as const) {
      let parsed = cu.parseColor(tokens[theme][k]);
      if (!parsed || cu.chroma(rgbOf(parsed)) >= TINT_MAX) {
        const fb = cu.parseColor(defaults[theme][k]);
        parsed = fb || (theme === "dark" && k === "bg" ? [11, 11, 13, 1] : parsed);
      }
      tokens[theme][k] = parsed ? cu.toHex(rgbOf(parsed)) : defaults[theme][k];
    }
  }
  tokens.defaults_used = (["dark", "light"] as const).flatMap((t) =>
    (["bg", "text"] as const).filter(() => !templates.some((tt) => tt.default_bg === t)).map((k) => `${t}.${k}`));
  return tokens;
}

const COLOR_PROPS_BG = ["background", "background-color"];

function mapTone(rgb: cu.RGB, cls: string, target: string, tokens: ThemeTokens): cu.RGB {
  const src = target === "dark" ? "light" : "dark";
  const sBg = rgbOf(cu.parseColor(tokens[src as "dark" | "light"].bg)!);
  const sTx = rgbOf(cu.parseColor(tokens[src as "dark" | "light"].text)!);
  const dBg = rgbOf(cu.parseColor(tokens[target as "dark" | "light"].bg)!);
  const dTx = rgbOf(cu.parseColor(tokens[target as "dark" | "light"].text)!);

  // exatamente o fundo/texto do tema de origem: troca pelo do destino (cor oficial, sem aproximação)
  if (cu.colorDistance(rgb, sBg) < 3) return dBg;
  if (cu.colorDistance(rgb, sTx) < 3) return dTx;

  const Lsbg = cu.oklabLightness(sBg), Lstx = cu.oklabLightness(sTx);
  const Ldbg = cu.oklabLightness(dBg), Ldtx = cu.oklabLightness(dTx);
  const L = cu.oklabLightness(rgb);
  let newL: number;
  if (cls === "background") {
    // cartões mantêm a distância que tinham do fundo
    newL = Ldbg + (L - Lsbg);
    newL = target === "light" ? Math.min(1, newL) : Math.max(0, newL);
  } else {
    const denom = Lstx - Lsbg || 1e-6;
    newL = Ldbg + ((L - Lsbg) * (Ldtx - Ldbg)) / denom;
  }
  return cu.withLightness(rgb, newL);
}

function formatColor(rgb: cu.RGB, alpha: number): string {
  if (alpha >= 0.999) return cu.toHex(rgb);
  const [r, g, b] = rgb.map((c) => Math.round(c));
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

function remapValue(value: string, cls: string, target: string, tokens: ThemeTokens, hlPairs: Record<string, string>): string {
  return value.replace(cu.COLOR_TOKEN_RE, (tok) => {
    const parsed = cu.parseColor(tok);
    if (!parsed) return tok;
    const rgb = rgbOf(parsed);
    const a = parsed[3];
    if (cu.chroma(rgb) >= TINT_MAX) {
      // cor de destaque da marca: permanece, salvo se a marca define um par
      if (cls === "color") {
        const pair = hlPairs[cu.toHex(rgb)];
        if (pair) return pair;
        const L = cu.oklabLightness(rgb);
        if (target === "light" && L > 0.74) return formatColor(cu.withLightness(rgb, 0.56), a);
        if (target === "dark" && L < 0.34) return formatColor(cu.withLightness(rgb, 0.74), a);
      }
      return tok;
    }
    return formatColor(mapTone(rgb, cls, target, tokens), a);
  });
}

function effectiveBgKind(el: Element, primary: string | null): string | null {
  let node: AnyNode | null = el;
  while (isTag(node)) {
    const st = styleOf(node);
    const bg = st.background || st["background-color"];
    if (bg) {
      const parsed = cu.parseColor(bg);
      if (parsed && parsed[3] >= 0.6) return cu.classifyBackground(bg, primary);
    }
    node = node.parent as AnyNode | null;
  }
  return null;
}

function buildHlPairs(tokens: ThemeTokens, target: string): Record<string, string> {
  const src = target === "dark" ? "light" : "dark";
  const pairs: Record<string, string> = {};
  for (const key of ["hl", "annotation"] as const) {
    const a = (tokens as any)[src]?.[key];
    const b = (tokens as any)[target]?.[key];
    const pa = cu.parseColor(a), pb = cu.parseColor(b);
    if (pa && pb && cu.colorDistance(rgbOf(pa), rgbOf(pb)) > 6) pairs[cu.toHex(rgbOf(pa))] = cu.toHex(rgbOf(pb));
  }
  return pairs;
}

/**
 * Converte o frame para o tema pedido. Só cinzas e tons suaves mudam de luminosidade; as cores de destaque da
 * marca ficam. Áreas sobre a cor de destaque (cards, botões) não são tocadas.
 */
export function applyTheme(root: Element, native: string, target: string, tokens: ThemeTokens, primary: string | null): void {
  if (!["dark", "light"].includes(native) || !["dark", "light"].includes(target) || native === target) return;
  const hlPairs = buildHlPairs(tokens, target);

  if (!("color" in styleOf(root))) setStyle(root, { color: (tokens as any)[native].text });

  const rootBg = cu.parseColor(styleOf(root).background || styleOf(root)["background-color"]);
  let rootBgDone = false;
  if (rootBg && rootBg[3] >= 0.99 && cu.chroma(rgbOf(rootBg)) < NEUTRAL_MAX) {
    setStyle(root, { background: (tokens as any)[target].bg });
    rootBgDone = true;
  }

  for (const el of [root, ...descendants(root)]) {
    if (el !== root && effectiveBgKind(el, primary) === "primary") continue;
    const st = styleOf(el);
    let changed = false;
    for (const [prop, value] of Object.entries(st)) {
      let cls: string;
      if (COLOR_PROPS_BG.includes(prop)) {
        if (el === root && rootBgDone) continue;
        cls = "background";
      } else if (["color", "fill", "stroke"].includes(prop)) cls = "color";
      else if (prop.startsWith("border") || prop === "outline") cls = "border";
      else continue;
      const nv = remapValue(value, cls, target, tokens, hlPairs);
      if (nv !== value) { st[prop] = nv; changed = true; }
    }
    if (changed) setAttr(el, "style", dumpStyle(st));
    for (const attr of ["stroke", "fill"]) {
      if (hasAttr(el, attr)) setAttr(el, attr, remapValue(attrOf(el, attr)!, "color", target, tokens, hlPairs));
    }
  }

  // logos/ícones escuros precisam do filtro de inversão que a marca usa nos modelos escuros (e vice-versa)
  const filters = tokens.asset_filter || { dark: {}, light: {} };
  const tgtMap = (filters as any)[target] || {};
  const srcMap = (filters as any)[native] || {};
  for (const img of descendants(root).filter((e) => e.name === "img" && hasAttr(e, "data-asset"))) {
    const asset = attrOf(img, "data-asset")!;
    let flt: string;
    if (asset in tgtMap) flt = tgtMap[asset];
    else if (srcMap[asset]) flt = "";
    else continue;
    setStyle(img, { filter: flt || null });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Preenchimento
// ---------------------------------------------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `hlColor` null + `onPrimary`: o destaque na cor da marca sumiria no fundo da própria marca, então vira sublinhado. */
function richHtml(text: string, hlColor: string | null, onPrimary = false): string {
  const esc = escapeHtml(text || "").replace(/\n/g, "<br>");
  const style = hlColor
    ? `color:${hlColor}`
    : onPrimary
      ? "color:inherit;text-decoration:underline;text-decoration-thickness:.07em;text-underline-offset:.14em"
      : "color:var(--primary-600)";
  return esc.replace(/\*\*([\s\S]+?)\*\*/g, (_m, g1) => `<span style="${style}">${g1}</span>`);
}

const plainOf = (text: string) => (text || "").replace(/\*\*/g, "");

function setLeaf(
  $: Doc, el: Element, text: string, slot: Pick<TemplateSlot, "rich">, fallbackHl: string | null, primary: string | null = null,
): void {
  const hasIconChild = tagChildren(el).some((c) => ICON_TAGS.has(c.name));
  if (slot.rich && !hasIconChild) {
    const own = attrOf(el, "data-hl");
    const onPrimary = !own && !!primary && effectiveBgKind(el, primary) === "primary";
    $(el).html(richHtml(text, own || (onPrimary ? null : fallbackHl), onPrimary));
    return;
  }
  const plain = plainOf(text);
  const nodes = (el.children as AnyNode[]).filter((c) => isText(c) && c.data.trim());
  if (!nodes.length) {
    $(el).append(escapeHtml(plain));
    return;
  }
  const lead = nodes[0] && (nodes[0] as any).data.startsWith(" ") && hasIconChild ? " " : "";
  (nodes[0] as any).data = lead + plain;
  for (const extra of nodes.slice(1)) removeNode(extra);
  // spans com texto (ex.: seta colorida) ficam de fora do slot simples: removidos para não duplicar conteúdo
  for (const c of tagChildren(el)) {
    if (!ICON_TAGS.has(c.name) && normWs(getText(c))) $(c).remove();
  }
}

function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Esconde o elemento e apaga o texto de exemplo do brand book (nunca vaza para o HTML exportado). */
function hide($: Doc, el: Element): void {
  if (el.name !== "img" && el.name !== "svg") $(el).empty();
  setStyle(el, { display: "none" });
}

/** Campos herdados do modelo de dados antigo (title/body/category...), usados quando `fields` não os traz. */
function legacyFields(slide: SlideData): Record<string, any> {
  const out: Record<string, any> = {};
  if (slide.title) out.title = slide.title;
  const body = slide.body || slide.subtitle;
  if (body) out.body = body;
  if (slide.category) out.chip = slide.category;
  if (slide.annotation) out.annotation = slide.annotation;
  if (slide.stat_number) out.stat = slide.stat_number;
  if (slide.stat_source) out.source = slide.stat_source;
  if (slide.step_number) out.step_number = slide.step_number;
  if (slide.step_label) out.label_1 = slide.step_label;
  if (slide.quote_author) out.author = slide.quote_author;
  if (slide.quote_role) out.author_role = slide.quote_role;
  if (slide.cta_primary) out.cta_1 = slide.cta_primary;
  if (slide.cta_secondary) out.cta_2 = slide.cta_secondary;
  return out;
}

export interface FillOptions {
  brandName: string;
  handle: string;
  assets: Record<string, string>;
  total: number;
  isSingle: boolean;
  fallbackHl?: string | null;
  /** Cor primária da marca: texto em destaque sobre ela vira sublinhado em vez de sumir. */
  primary?: string | null;
  imageResolver?: (url: string) => string;
}

/** Devolve o frame preenchido para o slide. `slide.fields` vazio => mostra os exemplos do modelo. */
export function fillTemplate(tpl: SlideTemplateDef, slide: SlideData, opts: FillOptions): { $: Doc; root: Element } {
  const $ = load(tpl.html || "");
  const root = $.root().children().first().get(0) as Element | undefined;
  if (!root || !hasAttr(root, "data-tpl-root")) throw new Error(`Modelo ${tpl.code} sem HTML.`);

  const fields: Record<string, any> = { ...(slide.fields || {}) };
  const useSamples = !Object.keys(fields).length;
  if (!useSamples) {
    for (const [k, v] of Object.entries(legacyFields(slide))) if (!(k in fields)) fields[k] = v;
  }
  const idx = slide.index || 1;
  const hideTotal = opts.isSingle || slide.show_pagination === false;

  // handle / paginação / progresso
  for (const el of findByAttr(root, "data-slot", "handle")) setLeaf($, el, opts.handle, { rich: false }, null);
  for (const el of findByAttr(root, "data-slot", "pagination")) {
    const w = parseInt(attrOf(el, "data-pag-w") || "2", 10);
    const sep = attrOf(el, "data-pag-sep") || "/";
    $(el).text(`${String(idx).padStart(w, "0")}${sep}${String(opts.total).padStart(w, "0")}`);
    if (hideTotal) setStyle(el, { visibility: "hidden" });
  }
  for (const el of findByAttr(root, "data-slot", "dots")) {
    const nDots = Math.max(1, Math.min(opts.total, 8));
    const active = opts.total <= 8 ? idx - 1 : Math.round(((idx - 1) / Math.max(opts.total - 1, 1)) * (nDots - 1));
    const off = attrOf(el, "data-dot-off") || "rgba(255,255,255,0.4)";
    const on = attrOf(el, "data-dot-on") || "#fff";
    $(el).empty();
    for (let d = 0; d < nDots; d++) {
      $(el).append(`<span style="width:10px;height:10px;border-radius:50%;background:${d === active ? on : off}"></span>`);
    }
    if (hideTotal) setStyle(el, { visibility: "hidden" });
  }
  for (const el of findByAttr(root, "data-slot", "progress")) {
    const frac = Math.min(1, Math.max(0, idx / Math.max(opts.total, 1)));
    if (attrOf(el, "data-progress-w")) setStyle(el, { width: `${Math.round(parseFloat(attrOf(el, "data-progress-w")!) * frac)}px` });
    else setStyle(el, { width: `${(frac * 100).toFixed(1)}%` });
    if (opts.isSingle) hide($, (isTag(el.parent as AnyNode) ? (el.parent as Element) : el));
  }

  // textos
  let authorText = "";
  for (const slot of tpl.slots) {
    if (slot.role === "image") continue;
    const el = findByAttr(root, "data-slot", slot.id)[0];
    if (!el) continue;
    if (slot.id === "initials") continue;
    const raw = fields[slot.id];
    if (raw === undefined || raw === null) {
      if (useSamples || slot.kind === "label") continue; // mantém o texto de exemplo / rótulo do brand book
      hide($, el);
      continue;
    }
    const val = String(raw).trim();
    if (slot.role === "author") authorText = val;
    if (!val) { hide($, el); continue; }
    setLeaf($, el, val.split("{brand}").join(opts.brandName), slot, opts.fallbackHl ?? null, opts.primary ?? null);
  }

  const initSlot = findByAttr(root, "data-slot", "initials")[0];
  if (initSlot && !useSamples) {
    const ini = String(fields.initials || initialsOf(authorText || String(fields.author || "")));
    if (ini) setLeaf($, initSlot, ini, { rich: false }, null);
    else hide($, initSlot);
  }

  // grupos
  for (const grp of tpl.groups) {
    const items = findByAttr(root, "data-group", grp.id);
    if (!items.length) continue;
    const first = items[0];
    const templateItem = $(first).clone();
    const provided = fields[grp.id];
    let rows: any[] | null = provided !== undefined ? provided : null;
    if (rows === null) rows = useSamples ? grp.sample_items : [];
    rows = (rows || []).filter(Boolean).slice(0, grp.max_items);

    rows.forEach((rowRaw, n) => {
      let row: Record<string, any> = rowRaw;
      if (typeof rowRaw === "string") row = grp.item_slots.length ? { [grp.item_slots[0].id]: rowRaw } : {};
      const clone = templateItem.clone();
      const cloneEl = clone.get(0) as Element;
      for (const sl of grp.item_slots) {
        const target = attrOf(cloneEl, "data-item-slot") === sl.id ? cloneEl : findByAttr(cloneEl, "data-item-slot", sl.id)[0];
        if (!target) continue;
        let v = row[sl.id];
        if ((v === undefined || v === null) && sl.role === "number") {
          const fmt2 = /^0\d$/.test(sl.sample || "");
          v = fmt2 ? String(n + 1).padStart(2, "0") : String(n + 1);
        }
        if (v === undefined || v === null || String(v).trim() === "") { hide($, target); continue; }
        setLeaf($, target, String(v), sl, opts.fallbackHl ?? null, opts.primary ?? null);
      }
      delete cloneEl.attribs["data-group"];
      $(first).before(clone);
    });
    for (const it of items) $(it).remove();
  }

  // imagens
  for (const holder of findByAttr(root, "data-image-slot")) {
    const sid = attrOf(holder, "data-image-slot")!;
    let src: string | undefined = fields[sid] || (sid === "image" ? slide.image_url || undefined : undefined);
    const isVideo = !!src && isVideoUrl(String(src));
    if (src && opts.imageResolver && !isVideo) src = opts.imageResolver(String(src));
    $(holder).empty();
    if (src && isVideo) {
      // vídeo: toca mudo e em loop na prévia; na exportação o Playwright troca por quadros extraídos com o ffmpeg
      $(holder).append(
        `<video src="${escapeHtml(String(src)).replace(/"/g, "&quot;")}" muted loop autoplay playsinline data-vsrc="${escapeHtml(String(src)).replace(/"/g, "&quot;")}" style="width:100%;height:100%;object-fit:cover;display:block"></video>`,
      );
    } else if (src) {
      $(holder).append(`<img src="${escapeHtml(String(src)).replace(/"/g, "&quot;")}" style="width:100%;height:100%;object-fit:cover;display:block">`);
    } else {
      const hint = attrOf(holder, "data-placeholder") || "Adicione uma imagem";
      $(holder).append(
        `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:var(--font-mono);font-size:26px;color:rgba(128,128,128,.85);border:3px dashed rgba(128,128,128,.45);border-radius:inherit;box-sizing:border-box">${escapeHtml(hint)}</div>`,
      );
    }
  }

  // logos / ícones da marca
  for (const img of descendants(root).filter((e) => e.name === "img" && hasAttr(e, "data-asset"))) {
    const data = opts.assets[attrOf(img, "data-asset")!];
    if (data) setAttr(img, "src", data);
    else hide($, img);
  }

  // tokens de texto ({handle}) em qualquer rótulo remanescente
  for (const node of textNodes(root)) {
    const s = node.data;
    if (s.includes(HANDLE_TOKEN) || s.includes("{{ handle }}")) {
      node.data = s.split("{{ handle }}").join(opts.handle).split(HANDLE_TOKEN).join(opts.handle);
    } else if (BINDING_RE.test(s)) node.data = s.replace(BINDING_RE_G, "");
  }

  // tipografia personalizada do editor
  const ct = slide.custom_typography;
  if (ct) {
    const titleStyle: Record<string, string> = {};
    if (ct.title_size) titleStyle.font_size = `${ct.title_size}px`;
    if (ct.title_font) titleStyle.font_family = `'${ct.title_font}', var(--font-title)`;
    if (ct.title_weight) titleStyle.font_weight = String(ct.title_weight);
    if (ct.title_italic) titleStyle.font_style = "italic";
    if (Object.keys(titleStyle).length) {
      for (const el of findByAttr(root, "data-fit", "1")) if (attrOf(el, "data-slot") === "title") setStyle(el, titleStyle);
    }
    const bodyStyle: Record<string, string> = {};
    if (ct.body_size) bodyStyle.font_size = `${ct.body_size}px`;
    if (ct.body_font) bodyStyle.font_family = `'${ct.body_font}', var(--font-body)`;
    if (ct.body_weight) bodyStyle.font_weight = String(ct.body_weight);
    if (ct.body_italic) bodyStyle.font_style = "italic";
    if (Object.keys(bodyStyle).length) {
      for (const el of findByAttr(root, "data-slot")) {
        const sid = attrOf(el, "data-slot")!;
        if (tpl.slots.find((s) => s.id === sid)?.role === "body") setStyle(el, bodyStyle);
      }
    }
  }

  // tamanho de fonte por campo (qualquer slot do modelo nativo)
  for (const [slotId, size] of Object.entries(slide.field_font_sizes || {})) {
    if (!size) continue;
    for (const el of findByAttr(root, "data-slot", slotId)) setStyle(el, { font_size: `${size}px` });
    for (const el of findByAttr(root, "data-item-slot", slotId)) setStyle(el, { font_size: `${size}px` });
  }
  return { $, root };
}

export const FIT_SCRIPT = `
(function(){
  var fr=document.querySelector('[data-tpl-root]'); if(!fr) return;
  function over(){ return fr.scrollHeight>fr.clientHeight+2; }
  function run(){
    var singles=[].slice.call(fr.querySelectorAll('[data-fit="1"],[data-fit="2"]'))
      .sort(function(a,b){return (+a.dataset.fit)-(+b.dataset.fit);});
    var groups={};
    [].slice.call(fr.querySelectorAll('[data-fit="3"]')).forEach(function(el){
      (groups[el.dataset.fitGroup]=groups[el.dataset.fitGroup]||[]).push(el); });
    var steps=singles.map(function(el){return [el];}).concat(Object.keys(groups).map(function(k){return groups[k];}));
    var bases=steps.map(function(list){return list.map(function(el){return parseFloat(getComputedStyle(el).fontSize);});});
    var factors=steps.map(function(){return 1;});
    var guard=0;
    [0.85,0.7,0.55].forEach(function(floor){
      steps.forEach(function(list,si){
        while(over() && factors[si]>floor && guard++<600){
          factors[si]*=0.97;
          list.forEach(function(el,i){ el.style.fontSize=(bases[si][i]*factors[si])+'px'; });
        }
      });
    });
    document.documentElement.setAttribute('data-fit-done','1');
  }
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run);}else{run();}
})();
`;

export function buildHead(brandbook: Brandbook, extraFonts: [string | null | undefined, number | null | undefined][] = []): string {
  const typo = brandbook.typography;
  const fams: string[] = [];
  for (const [name, weights] of [
    [typo.title_font, typo.title_weights], [typo.body_font, typo.body_weights], [typo.mono_font, typo.mono_weights],
  ] as const) {
    if (name) fams.push(`family=${name.replace(/ /g, "+")}:wght@${weights}`);
  }
  fams.push("family=Caveat:wght@600;700");
  const seen = new Set([typo.title_font, typo.body_font, typo.mono_font]);
  for (const [name, weight] of extraFonts) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const w = weight || 400;
    fams.push(`family=${name.replace(/ /g, "+")}:ital,wght@0,${w};1,${w}`);
  }
  const c = brandbook.colors;
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=1080, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>
  :root {
    --primary-600:${c.primary_600}; --primary-800:${c.primary_800}; --primary-100:${c.primary_100}; --primary-200:${c.primary_200};
    --neutral-50:${c.neutral_50}; --neutral-100:${c.neutral_100}; --neutral-200:${c.neutral_200}; --neutral-600:${c.neutral_600};
    --neutral-700:${c.neutral_700}; --neutral-900:${c.neutral_900}; --neutral-950:${c.neutral_950}; --neutral-dark:${c.neutral_dark};
    --green-check:${c.green_check};
    --font-title:'${typo.title_font}',sans-serif; --font-body:'${typo.body_font}',sans-serif;
    --font-mono:'${typo.mono_font}',monospace; --font-handwritten:'Caveat',cursive;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  body { width:1080px; height:1350px; overflow:hidden; background:#000; font-family:var(--font-body); -webkit-font-smoothing:antialiased; }
</style>`;
}

export function wrapDocument($: Doc, root: Element, brandbook: Brandbook, extraFonts: [string | null | undefined, number | null | undefined][] = []): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
${buildHead(brandbook, extraFonts)}
</head>
<body>
${$.html(root)}
<script>${FIT_SCRIPT}</script>
</body>
</html>`;
}

export { setStyle as setElementStyle };
