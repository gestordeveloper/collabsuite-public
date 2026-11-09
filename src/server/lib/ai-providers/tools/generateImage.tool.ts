import { z } from "zod";
import { prisma } from "../../prisma";
import { storeBuffer } from "../../../controllers/upload.controller";
import { resolveApiKey } from "../../../services/ai-credential.service";
import { generateImageOpenRouter, DEFAULT_IMAGE_MODEL } from "../imageGeneration";
import type { ToolHandler } from "./registry";

const argsSchema = z.object({
  prompt: z.string().min(1),
});

export const generateImageTool: ToolHandler = {
  definition: {
    name: "generate_image",
    description:
      "Gera uma imagem a partir de uma descrição em texto (usando IA de geração de imagem) e a salva na galeria do usuário. Use quando o usuário pedir para criar, gerar ou desenhar uma imagem.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Descrição detalhada da imagem a ser gerada" },
      },
      required: ["prompt"],
    },
  },
  argsSchema,
  async execute(rawArgs, ctx) {
    const args = argsSchema.parse(rawArgs);

    const apiKey = await resolveApiKey("openrouter", ctx.userId, ctx.companyId);
    const { buffer, mimeType } = await generateImageOpenRouter(apiKey, args.prompt);
    const ext = mimeType.split("/")[1] || "png";
    const url = await storeBuffer(buffer, ext, mimeType);

    const image = await prisma.generatedImage.create({
      data: {
        user_id: ctx.userId,
        company_id: ctx.companyId,
        agent_id: ctx.agentId ?? null,
        run_id: ctx.runId ?? null,
        prompt: args.prompt,
        model: DEFAULT_IMAGE_MODEL,
        url,
      },
    });

    return JSON.stringify({ success: true, image_id: image.id, image_url: url });
  },
};
