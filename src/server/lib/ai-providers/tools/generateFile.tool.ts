import { z } from "zod";
import { storeBuffer } from "../../../controllers/upload.controller";
import { buildGeneratedFile } from "../../fileGeneration";
import type { ToolHandler } from "./registry";

const argsSchema = z.object({
  filename: z.string().min(1),
  format: z.enum(["pdf", "docx", "xlsx", "txt", "md"]),
  content: z.string().min(1),
});

export const generateFileTool: ToolHandler = {
  definition: {
    name: "generate_file",
    description:
      "Gera um arquivo para download (PDF, Word, Excel ou texto/markdown) a partir de um conteúdo e retorna o link. Use quando o usuário pedir um relatório, documento, planilha ou arquivo de texto.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Nome do arquivo, sem extensão" },
        format: { type: "string", enum: ["pdf", "docx", "xlsx", "txt", "md"], description: "Formato do arquivo a gerar" },
        content: {
          type: "string",
          description:
            'Para pdf/docx/txt/md: o texto do documento (linhas iniciadas com "# " ou "## " viram títulos, "- " vira lista, "**texto**" vira negrito). Para xlsx: um JSON (string) de um array de arrays (linhas e colunas) ou de um array de objetos (cada chave vira uma coluna).',
        },
      },
      required: ["filename", "format", "content"],
    },
  },
  argsSchema,
  async execute(rawArgs, ctx) {
    const args = argsSchema.parse(rawArgs);
    const { buffer, ext, mimeType } = await buildGeneratedFile(args.format, args.content);
    const url = await storeBuffer(buffer, ext, mimeType);

    return JSON.stringify({
      success: true,
      file_url: url,
      filename: `${args.filename}.${ext}`,
      mime_type: mimeType,
    });
  },
};
