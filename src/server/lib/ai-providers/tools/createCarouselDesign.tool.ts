import { z } from "zod";
import { storeBuffer } from "../../../controllers/upload.controller";
import { resolveApiKey } from "../../../services/ai-credential.service";
import { createDesign } from "../../../services/design.service";
import { generateImageOpenRouter } from "../imageGeneration";
import type { ToolHandler } from "./registry";
import type { DesignElement, DesignPage, PageBackground } from "../../../../lib/design-studio/types";

const PAGE_WIDTH = 1080;
const PAGE_HEIGHT = 1350;
const DEFAULT_ACCENT = "#4f46e5";

const slideSchema = z
  .object({
    layout: z.enum(["image-bottom", "image-center", "text-card"]),
    headline: z.string().min(1).max(120),
    body: z.string().max(400).optional(),
    image_prompt: z.string().min(1).max(500).optional(),
  })
  .refine((s) => s.layout === "text-card" || !!s.image_prompt, {
    message: "image_prompt é obrigatório para slides com layout 'image-bottom' ou 'image-center'.",
    path: ["image_prompt"],
  });

const argsSchema = z.object({
  title: z.string().min(1).max(150),
  style: z.string().min(1).max(400),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  slides: z.array(slideSchema).min(2).max(10),
});

type Slide = z.infer<typeof slideSchema>;

/** Darkens a "#rrggbb" color by `factor` (0-1, applied as a multiplier on each channel). */
function shadeHex(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function counterElement(index: number, total: number, color: string): DesignElement {
  return {
    id: "counter",
    kind: "text",
    x: PAGE_WIDTH - 160,
    y: 40,
    width: 120,
    height: 40,
    rotation: 0,
    zIndex: 10,
    text: `${index}/${total}`,
    fontFamily: "Inter",
    fontSize: 26,
    fontWeight: 600,
    color,
    align: "right",
  };
}

function buildImageBottomPage(id: string, slide: Slide, background: PageBackground, index: number, total: number): DesignPage {
  const elements: DesignElement[] = [
    {
      id: "scrim",
      kind: "shape",
      shape: "rect",
      x: 0,
      y: 850,
      width: PAGE_WIDTH,
      height: 500,
      rotation: 0,
      zIndex: 1,
      fill: "rgba(15,15,20,0.62)",
    },
    {
      id: "headline",
      kind: "text",
      x: 64,
      y: 900,
      width: 952,
      height: 140,
      rotation: 0,
      zIndex: 2,
      text: slide.headline,
      fontFamily: "Inter",
      fontSize: 56,
      fontWeight: 700,
      color: "#ffffff",
      align: "left",
    },
    counterElement(index, total, "#ffffff"),
  ];
  if (slide.body) {
    elements.push({
      id: "body",
      kind: "text",
      x: 64,
      y: 1050,
      width: 952,
      height: 260,
      rotation: 0,
      zIndex: 2,
      text: slide.body,
      fontFamily: "Inter",
      fontSize: 30,
      fontWeight: 400,
      color: "#f1f5f9",
      align: "left",
    });
  }
  return { id, width: PAGE_WIDTH, height: PAGE_HEIGHT, background, elements };
}

function buildImageCenterPage(id: string, slide: Slide, background: PageBackground, accent: string, index: number, total: number): DesignPage {
  const elements: DesignElement[] = [
    {
      id: "card",
      kind: "shape",
      shape: "rect",
      x: 100,
      y: 435,
      width: 880,
      height: 480,
      rotation: 0,
      zIndex: 1,
      fill: "rgba(255,255,255,0.92)",
      borderRadius: 24,
    },
    {
      id: "headline",
      kind: "text",
      x: 140,
      y: 475,
      width: 800,
      height: 160,
      rotation: 0,
      zIndex: 2,
      text: slide.headline,
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: 700,
      color: accent,
      align: "center",
    },
    counterElement(index, total, "#ffffff"),
  ];
  if (slide.body) {
    elements.push({
      id: "body",
      kind: "text",
      x: 140,
      y: 635,
      width: 800,
      height: 220,
      rotation: 0,
      zIndex: 2,
      text: slide.body,
      fontFamily: "Inter",
      fontSize: 28,
      fontWeight: 400,
      color: "#334155",
      align: "center",
    });
  }
  return { id, width: PAGE_WIDTH, height: PAGE_HEIGHT, background, elements };
}

function buildTextCardPage(id: string, slide: Slide, accent: string, index: number, total: number): DesignPage {
  const background: PageBackground = { type: "gradient", angle: 135, from: accent, to: shadeHex(accent, 0.55) };
  const elements: DesignElement[] = [
    {
      id: "headline",
      kind: "text",
      x: 100,
      y: 520,
      width: 880,
      height: 260,
      rotation: 0,
      zIndex: 1,
      text: slide.headline,
      fontFamily: "Inter",
      fontSize: 64,
      fontWeight: 800,
      color: "#ffffff",
      align: "center",
    },
    counterElement(index, total, "rgba(255,255,255,0.85)"),
  ];
  if (slide.body) {
    elements.push({
      id: "body",
      kind: "text",
      x: 100,
      y: 800,
      width: 880,
      height: 200,
      rotation: 0,
      zIndex: 1,
      text: slide.body,
      fontFamily: "Inter",
      fontSize: 30,
      fontWeight: 400,
      color: "rgba(255,255,255,0.85)",
      align: "center",
    });
  }
  return { id, width: PAGE_WIDTH, height: PAGE_HEIGHT, background, elements };
}

export const createCarouselDesignTool: ToolHandler = {
  definition: {
    name: "create_carousel_design",
    description:
      "Cria um carrossel de design completo (formato feed vertical 1080x1350, de 2 a 10 slides) a partir de um roteiro " +
      "fornecido pelo usuário, gera as imagens de cada slide por IA e salva tudo pronto no Design Studio. Use quando o " +
      "usuário mandar um roteiro/ideia e pedir um carrossel pronto. Divida o roteiro em slides: o primeiro geralmente é " +
      "o gancho (frase de impacto — combina bem com layout 'text-card'), os slides do meio desenvolvem o conteúdo " +
      "(layout 'image-bottom' ou 'image-center', cada um com uma imagem ilustrativa e um título curto) e o último é a " +
      "chamada para ação (geralmente 'text-card'). Preencha 'style' com uma descrição da identidade visual " +
      "(cores, estilo fotográfico/ilustração, iluminação) que será aplicada a todas as imagens do carrossel para " +
      "manter consistência visual entre os slides. O retorno inclui 'design_url' com o link já pronto — repasse esse " +
      "valor exatamente como veio, sem inventar ou alterar domínio/URL.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Nome do design a ser salvo." },
        style: {
          type: "string",
          description: "Identidade visual compartilhada por todas as imagens do carrossel (estilo, cores, iluminação).",
        },
        accent_color: { type: "string", description: "Cor de destaque em hex (ex: #4f46e5). Opcional." },
        slides: {
          type: "array",
          minItems: 2,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              layout: { type: "string", enum: ["image-bottom", "image-center", "text-card"] },
              headline: { type: "string", description: "Título curto do slide." },
              body: { type: "string", description: "Texto de apoio opcional do slide." },
              image_prompt: {
                type: "string",
                description: "Descrição da imagem do slide. Obrigatório para layout 'image-bottom' ou 'image-center'.",
              },
            },
            required: ["layout", "headline"],
          },
        },
      },
      required: ["title", "style", "slides"],
    },
  },
  argsSchema,
  async execute(rawArgs, ctx) {
    const args = argsSchema.parse(rawArgs);
    const accent = args.accent_color || DEFAULT_ACCENT;
    const total = args.slides.length;

    let apiKey: string | null = null;
    const pages: DesignPage[] = [];

    for (let i = 0; i < total; i++) {
      const slide = args.slides[i];
      const pageId = `page-${i + 1}`;
      const index = i + 1;

      if (slide.layout === "text-card") {
        pages.push(buildTextCardPage(pageId, slide, accent, index, total));
        continue;
      }

      if (!apiKey) apiKey = await resolveApiKey("openrouter", ctx.userId, ctx.companyId);
      const { buffer, mimeType } = await generateImageOpenRouter(apiKey, `${args.style}. ${slide.image_prompt}`);
      const ext = mimeType.split("/")[1] || "png";
      const url = await storeBuffer(buffer, ext, mimeType);
      const background: PageBackground = { type: "image", url, size: "cover" };

      pages.push(
        slide.layout === "image-bottom"
          ? buildImageBottomPage(pageId, slide, background, index, total)
          : buildImageCenterPage(pageId, slide, background, accent, index, total)
      );
    }

    const design = await createDesign({
      name: args.title,
      user_id: ctx.userId,
      company_id: ctx.companyId,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      pages: JSON.stringify(pages),
    });

    const rawAppUrl = process.env.APP_URL || "";
    const appUrl = /^https?:\/\//i.test(rawAppUrl) ? rawAppUrl.replace(/\/$/, "") : "";
    return JSON.stringify({ success: true, design_id: design.id, design_url: `${appUrl}/designs/${design.id}`, slides: total });
  },
};
