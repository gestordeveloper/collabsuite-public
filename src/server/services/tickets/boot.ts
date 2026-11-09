import { prisma } from "../../lib/prisma";
import { startConnection } from "../whatsapp/connectionManager";
import { startBotWorker } from "../bot/worker";

/**
 * Conexões habilitadas para atendimento precisam estar de pé para receber mensagens, mesmo sem ninguém com a
 * página aberta — então são religadas (a partir da sessão já pareada) quando o servidor sobe.
 */
export async function startTicketServices() {
  startBotWorker();

  const rows = await prisma.whatsAppConnection.findMany({
    where: {
      auth_state: { not: null },
      OR: [{ receive_tickets: true }, { agents: { some: { channel_enabled: true, is_active: true } } }],
    },
    select: { id: true, label: true },
  });
  for (const row of rows) {
    startConnection(row.id).catch((err) => console.error(`[tickets] Falha ao religar a conexão "${row.label}":`, err?.message || err));
    await new Promise((resolve) => setTimeout(resolve, 1500)); // escalona para não abrir todos os sockets de uma vez
  }
}
