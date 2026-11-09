import { z } from "zod";
import { prisma } from "../../prisma";
import { ensureConnected, toJid } from "../../../services/whatsapp/connectionManager";
import type { ToolHandler } from "./registry";

const argsSchema = z.object({
  connection_id: z.number().int().positive(),
  phone: z.string().min(8),
  message: z.string().min(1),
});

export const sendWhatsAppMessageTool: ToolHandler = {
  definition: {
    name: "send_whatsapp_message",
    description:
      "Envia UMA mensagem de texto pelo WhatsApp usando uma conexão do próprio usuário. Nunca use para disparos em massa ou campanhas.",
    parameters: {
      type: "object",
      properties: {
        connection_id: { type: "number", description: "ID da conexão de WhatsApp do usuário" },
        phone: { type: "string", description: "Telefone do destinatário com DDI e DDD, ex.: 5511999999999" },
        message: { type: "string", description: "Texto da mensagem" },
      },
      required: ["connection_id", "phone", "message"],
    },
  },
  argsSchema,
  async execute(rawArgs, ctx) {
    const args = argsSchema.parse(rawArgs);

    const connection = await prisma.whatsAppConnection.findFirst({
      where: { id: args.connection_id, user_id: ctx.userId },
    });
    if (!connection) {
      throw new Error("Conexão de WhatsApp não encontrada ou não pertence a você.");
    }

    const sock = await ensureConnected(args.connection_id, 20000);
    await sock.sendMessage(toJid(args.phone), { text: args.message });

    return JSON.stringify({ success: true, phone: args.phone });
  },
};
