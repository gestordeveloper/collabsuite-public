import { z } from "zod";
import { prisma } from "../../prisma";
import type { ToolHandler } from "./registry";

const argsSchema = z.object({
  name: z.string().optional(),
});

export const getIcpTool: ToolHandler = {
  definition: {
    name: "get_icp",
    description:
      "Busca um ICP (perfil de cliente ideal) cadastrado pelo usuário, pelo nome. Se nenhum nome for informado ou não houver uma correspondência única, retorna a lista de ICPs disponíveis para o usuário escolher. Use antes de criar conteúdo que dependa do público-alvo.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome (ou parte do nome) do ICP a buscar" },
      },
      required: [],
    },
  },
  argsSchema,
  async execute(rawArgs, ctx) {
    const args = argsSchema.parse(rawArgs);

    const icps = await prisma.icp.findMany({ where: { user_id: ctx.userId }, orderBy: { name: "asc" } });
    if (icps.length === 0) {
      return JSON.stringify({
        message: "Nenhum ICP cadastrado ainda. Peça para o usuário cadastrar um em Agentes de IA > ICPs.",
      });
    }

    if (args.name) {
      const query = args.name.toLowerCase();
      const matches = icps.filter((i) => i.name.toLowerCase().includes(query));
      if (matches.length === 1) {
        const m = matches[0];
        return JSON.stringify({ name: m.name, niche: m.niche, description: m.description });
      }
      if (matches.length > 1) {
        return JSON.stringify({
          message: "Mais de um ICP corresponde a esse nome. Peça para o usuário especificar qual.",
          options: matches.map((m) => m.name),
        });
      }
    }

    return JSON.stringify({
      message: args.name ? "Nenhum ICP encontrado com esse nome. ICPs disponíveis:" : "ICPs disponíveis:",
      available_icps: icps.map((i) => ({ name: i.name, niche: i.niche })),
    });
  },
};
