import QRCode from "qrcode";
import { prisma } from "../../lib/prisma";
import * as connectionManager from "./connectionManager";
import { invalidateConnectionFlag } from "../tickets/inbound.service";

async function findOwnedConnection(userId: number, connectionId: number) {
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { id: connectionId, user_id: userId },
  });
  if (!connection) {
    throw new Error("Conexão do WhatsApp não encontrada.");
  }
  return connection;
}

async function toSafeConnection<
  T extends { auth_state: string | null; qr: string | null; status: string }
>(row: T) {
  const { auth_state, qr, ...rest } = row;
  let qr_data_url: string | null = null;
  if (qr && status_is_pairing(rest.status)) {
    try {
      qr_data_url = await QRCode.toDataURL(qr);
    } catch {
      qr_data_url = null;
    }
  }
  return { ...rest, has_session: !!auth_state, qr_data_url };
}

function status_is_pairing(status: string) {
  return status === "pairing";
}

export async function listConnections(userId: number) {
  const rows = await prisma.whatsAppConnection.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
  });
  return Promise.all(rows.map(toSafeConnection));
}

export async function getConnection(userId: number, connectionId: number) {
  const row = await findOwnedConnection(userId, connectionId);
  return toSafeConnection(row);
}

export async function createConnection(userId: number, data: { label: string }) {
  const row = await prisma.whatsAppConnection.create({
    data: { user_id: userId, label: data.label, status: "disconnected" },
  });
  return toSafeConnection(row);
}

export async function renameConnection(userId: number, connectionId: number, label: string) {
  await findOwnedConnection(userId, connectionId);
  const row = await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { label },
  });
  return toSafeConnection(row);
}

export async function updateTicketSettings(
  userId: number,
  connectionId: number,
  data: { receive_tickets?: boolean; greeting_message?: string | null; farewell_message?: string | null }
) {
  const connection = await findOwnedConnection(userId, connectionId);
  const row = await prisma.whatsAppConnection.update({
    where: { id: connection.id },
    data: {
      ...(data.receive_tickets !== undefined ? { receive_tickets: data.receive_tickets } : {}),
      ...(data.greeting_message !== undefined ? { greeting_message: data.greeting_message?.trim() || null } : {}),
      ...(data.farewell_message !== undefined ? { farewell_message: data.farewell_message?.trim() || null } : {}),
    },
  });
  invalidateConnectionFlag(connection.id);
  // Ligou o atendimento numa conexão já pareada: sobe o socket para começar a receber agora.
  if (row.receive_tickets && row.auth_state && !connectionManager.isConnectionLive(row.id)) {
    connectionManager.startConnection(row.id).catch((err) => console.error("[whatsapp] Falha ao iniciar conexão de atendimento:", err));
  }
  return toSafeConnection(row);
}

export async function startPairing(userId: number, connectionId: number) {
  const connection = await findOwnedConnection(userId, connectionId);
  await connectionManager.startConnection(connection.id);
  return getConnection(userId, connectionId);
}

export async function disconnectConnection(userId: number, connectionId: number) {
  const connection = await findOwnedConnection(userId, connectionId);
  await connectionManager.disconnectConnection(connection.id);
  return getConnection(userId, connectionId);
}

export async function deleteConnection(userId: number, connectionId: number) {
  const connection = await findOwnedConnection(userId, connectionId);
  await connectionManager.logoutAndForget(connection.id);
  // Cascades WhatsAppCampaign (and its recipients); WhatsAppContactList.connection_id is set null.
  await prisma.whatsAppConnection.delete({ where: { id: connection.id } });
  return { success: true };
}
