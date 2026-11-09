import { prisma } from "../../lib/prisma";
import vapzapSeed from "./seed/vapzap.json";
import ebenezerSeed from "./seed/ebenezer.json";
import sammuelSeed from "./seed/sammuelfogaca.json";
import {
  DEFAULT_COLORS, DEFAULT_TYPOGRAPHY, DEFAULT_WRITING_RULES, type Brandbook,
} from "./types";

const SEEDS: Brandbook[] = [vapzapSeed, ebenezerSeed, sammuelSeed] as unknown as Brandbook[];
export const DEFAULT_BRANDBOOK_ID = "vapzap";

/** Completa campos ausentes (brandbooks salvos por versões antigas) sem tocar no que existe. */
export function normalizeBrandbook(raw: any): Brandbook {
  return {
    id: raw.id,
    name: raw.name || raw.id,
    handle: raw.handle || "@marca",
    description: raw.description ?? "Brandbook oficial",
    colors: { ...DEFAULT_COLORS, ...(raw.colors || {}) },
    typography: { ...DEFAULT_TYPOGRAPHY, ...(raw.typography || {}) },
    logo_filename: raw.logo_filename ?? null,
    icon_filename: raw.icon_filename ?? null,
    writing_rules: Array.isArray(raw.writing_rules) && raw.writing_rules.length ? raw.writing_rules : DEFAULT_WRITING_RULES,
    default_theme: raw.default_theme === "dark" ? "dark" : "light",
    slide_templates: Array.isArray(raw.slide_templates) ? raw.slide_templates : [],
    theme_tokens: raw.theme_tokens || {},
    source_file: raw.source_file ?? null,
    import_report: raw.import_report || {},
    is_default: !!raw.is_default,
    assets: raw.assets || {},
    source_html: raw.source_html ?? null,
  };
}

let seeded = false;

/** Primeira vez que a tabela está vazia: instala as marcas que acompanham o estúdio. */
export async function ensureDefaultBrandbooks(): Promise<void> {
  if (seeded) return;
  const count = await prisma.carouselBrandbook.count();
  if (count === 0) {
    for (const bb of SEEDS) {
      await prisma.carouselBrandbook.create({
        data: { id: bb.id, name: bb.name, is_default: !!bb.is_default, data: JSON.stringify(bb) },
      });
    }
  }
  seeded = true;
}

export async function listBrandbooks(): Promise<Brandbook[]> {
  await ensureDefaultBrandbooks();
  const rows = await prisma.carouselBrandbook.findMany();
  const list = rows.map((r) => normalizeBrandbook({ ...JSON.parse(r.data), id: r.id, is_default: r.is_default }));
  list.sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  return list;
}

export async function getBrandbook(id: string): Promise<Brandbook> {
  await ensureDefaultBrandbooks();
  const row = (await prisma.carouselBrandbook.findUnique({ where: { id } }))
    ?? (await prisma.carouselBrandbook.findUnique({ where: { id: DEFAULT_BRANDBOOK_ID } }))
    ?? (await prisma.carouselBrandbook.findFirst());
  if (!row) throw new Error(`Brandbook '${id}' não encontrado.`);
  return normalizeBrandbook({ ...JSON.parse(row.data), id: row.id, is_default: row.is_default });
}

export async function brandbookExists(id: string): Promise<boolean> {
  return (await prisma.carouselBrandbook.count({ where: { id } })) > 0;
}

export async function saveBrandbook(bb: Brandbook, userId?: number | null): Promise<Brandbook> {
  const data = JSON.stringify(bb);
  await prisma.carouselBrandbook.upsert({
    where: { id: bb.id },
    create: { id: bb.id, user_id: userId ?? null, name: bb.name, is_default: !!bb.is_default, data },
    update: { name: bb.name, data },
  });
  return bb;
}

export async function deleteBrandbook(id: string): Promise<boolean> {
  const row = await prisma.carouselBrandbook.findUnique({ where: { id } });
  if (!row) return false;
  if (row.is_default) throw new Error("Não é permitido excluir o brandbook padrão.");
  await prisma.carouselBrandbook.delete({ where: { id } });
  return true;
}

/** Versão enxuta para listagens: sem o HTML dos modelos (pesado) e sem os data URIs dos assets. */
export function summarize(bb: Brandbook) {
  const { slide_templates, assets, source_html, ...rest } = bb;
  return {
    ...rest,
    asset_names: Object.keys(assets || {}),
    slide_templates: slide_templates.map(({ html, ...t }) => ({ ...t, has_html: !!html })),
  };
}
