import { prisma } from "../lib/prisma";
import { mergeDesignSlides, mergeTheme, safeParseJson } from "../../lib/proposal-designs/merge";
import { DEFAULT_THEME } from "../../lib/proposal-designs/theme.defaults";
import type { DesignOverrides, DesignId, SlideEnvelope, ThemeTokens } from "../../lib/proposal-designs/types";

export async function listTemplates(userId: number, companyId?: number | null) {
  const where: any = { user_id: userId };
  if (companyId) where.company_id = companyId;

  return prisma.proposalTemplate.findMany({
    where,
    orderBy: { created_at: "desc" },
  });
}

export async function getTemplateById(templateId: number) {
  return prisma.proposalTemplate.findUnique({
    where: { id: templateId },
  });
}

export async function createTemplate(data: {
  name: string;
  user_id: number;
  company_id?: number | null;
  cover?: string | null;
  about_company?: string | null;
  about_work?: string | null;
  values?: string | null;
  thank_you?: string | null;
  styles?: string | null;
  is_default?: boolean;
  design?: string;
  theme?: string | null;
  slides?: string | null;
}) {
  return prisma.proposalTemplate.create({
    data: {
      name: data.name,
      user_id: data.user_id,
      company_id: data.company_id ?? null,
      cover: data.cover ?? null,
      about_company: data.about_company ?? null,
      about_work: data.about_work ?? null,
      values: data.values ?? null,
      thank_you: data.thank_you ?? null,
      styles: data.styles ?? null,
      is_default: data.is_default ?? false,
      design: data.design ?? "classic",
      theme: data.theme ?? null,
      slides: data.slides ?? null,
    },
  });
}

export async function updateTemplate(
  templateId: number,
  data: {
    name?: string;
    cover?: string | null;
    about_company?: string | null;
    about_work?: string | null;
    values?: string | null;
    thank_you?: string | null;
    styles?: string | null;
    is_default?: boolean;
    design?: string;
    theme?: string | null;
    slides?: string | null;
  }
) {
  // If setting this as default, unset other defaults first
  if (data.is_default) {
    const existing = await prisma.proposalTemplate.findUnique({ where: { id: templateId } });
    if (existing) {
      await prisma.proposalTemplate.updateMany({
        where: { user_id: existing.user_id, is_default: true, id: { not: templateId } },
        data: { is_default: false },
      });
    }
  }

  return prisma.proposalTemplate.update({
    where: { id: templateId },
    data: {
      name: data.name,
      cover: data.cover !== undefined ? data.cover : undefined,
      about_company: data.about_company !== undefined ? data.about_company : undefined,
      about_work: data.about_work !== undefined ? data.about_work : undefined,
      values: data.values !== undefined ? data.values : undefined,
      thank_you: data.thank_you !== undefined ? data.thank_you : undefined,
      styles: data.styles !== undefined ? data.styles : undefined,
      is_default: data.is_default,
      design: data.design,
      theme: data.theme !== undefined ? data.theme : undefined,
      slides: data.slides !== undefined ? data.slides : undefined,
    },
  });
}

export async function deleteTemplate(templateId: number) {
  // Unlink from tasks first
  await prisma.task.updateMany({
    where: { proposal_template_id: templateId },
    data: { proposal_template_id: null },
  });
  return prisma.proposalTemplate.delete({ where: { id: templateId } });
}

/** Get the full proposal data for a task (merges template + task-specific data) */
export async function getProposalForTask(taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      user: true,
      proposalTemplate: true,
    },
  });

  if (!task || task.deleted_at) return null;

  // If no template associated, return null
  if (!task.proposal_template_id || !task.proposalTemplate) {
    return {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        content: task.content,
        cover: task.cover,
      },
      template: null,
    };
  }

  // Parse JSON fields from template (with safe parse)
  const template = task.proposalTemplate;
  const proposalData: Record<string, any> = {};
  if (task.proposal_data) {
    try { Object.assign(proposalData, JSON.parse(task.proposal_data)); } catch {}
  }

  // Helper: safe JSON parse with fallback
  function safeParse(val: string | null | undefined): any {
    if (!val) return null;
    try { return JSON.parse(val); } catch { return null; }
  }

  // Helper: merge template data with proposal overrides (supports both camelCase and snake_case keys)
  function mergeWithOverrides(templateField: string | null | undefined, ...overrideKeys: string[]): any {
    const base = safeParse(templateField);
    if (!base) return null;

    let merged = { ...base };
    for (const key of overrideKeys) {
      if (proposalData[key] && typeof proposalData[key] === 'object') {
        merged = { ...merged, ...proposalData[key] };
      }
    }
    return merged;
  }

  // Design-based deck (Modelo 1 / Modelo 2) — merged separately from the classic sections above.
  const design = (template.design || "classic") as DesignId;
  let theme: ThemeTokens | null = null;
  let slides: SlideEnvelope[] | null = null;
  if (design !== "classic") {
    const overrides = proposalData as DesignOverrides;
    theme = mergeTheme(DEFAULT_THEME[design], safeParseJson<Partial<ThemeTokens> | null>(template.theme, null));
    theme = mergeTheme(theme, overrides.designTheme);
    const baseSlides = safeParseJson<SlideEnvelope[]>(template.slides, []);
    slides = mergeDesignSlides(baseSlides, overrides.designSlides);
  }

  return {
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      content: task.content,
      cover: task.cover,
      first_name: task.first_name,
      last_name: task.last_name,
      email: task.email,
      phone: task.phone,
      due_at: task.due_at,
      end_at: task.end_at,
      estimated_time: task.estimated_time,
      value: proposalData.value,
    },
    template: {
      id: template.id,
      name: template.name,
      cover: mergeWithOverrides(template.cover, 'cover'),
      about_company: mergeWithOverrides(template.about_company, 'about_company', 'aboutCompany'),
      about_work: mergeWithOverrides(template.about_work, 'about_work', 'aboutWork'),
      values: mergeWithOverrides(template.values, 'values'),
      thank_you: mergeWithOverrides(template.thank_you, 'thank_you', 'thankYou'),
      styles: safeParse(template.styles),
      design,
      theme,
      slides,
    },
  };
}
