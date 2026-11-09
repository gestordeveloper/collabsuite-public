import {
  makeWASocket,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
} from "baileys";
import type { WASocket, ConnectionState } from "baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import { prisma } from "../../lib/prisma";
import { emitToUser } from "../../lib/socket";
import { createPrismaAuthState, clearAuthState } from "../../lib/whatsapp/prismaAuthState";
import { attachInboundHandlers } from "../tickets/inbound.service";
import { attachAgentChannelHandlers } from "../agent-channel/channel.service";

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });

const MAX_AUTO_RECONNECT_ATTEMPTS = 5;

interface ManagedConnection {
  sock: WASocket;
  userId: number;
  isOpen: boolean;
}

/** At most one live Baileys socket per WhatsAppConnection.id, created lazily. */
const connections = new Map<number, ManagedConnection>();
const startPromises = new Map<number, Promise<void>>();
const manualDisconnects = new Set<number>();
const reconnectAttempts = new Map<number, number>();

export function isConnectionLive(connectionId: number): boolean {
  const managed = connections.get(connectionId);
  return !!managed?.isOpen;
}

export function getLiveSocket(connectionId: number): WASocket | null {
  return connections.get(connectionId)?.sock ?? null;
}

/** Normalizes a phone number into a WhatsApp JID, stripping everything but digits. */
export function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

export function isLikelyValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * Starts (or joins an already in-flight start of) a live Baileys socket for this connection.
 * Safe to call repeatedly — a no-op if a socket is already connecting/connected.
 */
export async function startConnection(connectionId: number): Promise<void> {
  if (connections.has(connectionId)) return;
  const inFlight = startPromises.get(connectionId);
  if (inFlight) return inFlight;

  const p = doStart(connectionId).finally(() => startPromises.delete(connectionId));
  startPromises.set(connectionId, p);
  return p;
}

async function doStart(connectionId: number): Promise<void> {
  const connectionRow = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } });
  if (!connectionRow) {
    throw new Error("Conexão do WhatsApp não encontrada.");
  }

  const userId = connectionRow.user_id;
  manualDisconnects.delete(connectionId);

  const { state, saveCreds } = await createPrismaAuthState(connectionId);

  // fetchLatestBaileysVersion() hits raw.githubusercontent.com on every connect attempt — if
  // that's unreachable (blocked egress, GitHub hiccup, etc.) fall back to Baileys' own bundled
  // default version instead of failing the whole connect() call.
  const version = await fetchLatestBaileysVersion()
    .then((res) => res.version)
    .catch((err) => {
      console.warn(`[whatsapp] Falha ao buscar a versão mais recente do Baileys, usando o padrão embutido:`, err?.message || err);
      return undefined;
    });

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: Browsers.macOS("Chrome"),
    version,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  const managed: ManagedConnection = { sock, userId, isOpen: false };
  connections.set(connectionId, managed);

  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { status: "pairing" },
  }).catch(() => {});
  emitToUser(userId, "whatsapp_status", { connectionId, status: "pairing" });

  sock.ev.on("creds.update", saveCreds);
  attachInboundHandlers(sock, connectionId);
  attachAgentChannelHandlers(sock, connectionId);
  sock.ev.on("connection.update", (update) => {
    handleConnectionUpdate(connectionId, managed, update).catch((err) => {
      console.error(`[whatsapp] Erro ao processar connection.update da conexão ${connectionId}:`, err);
    });
  });
}

async function handleConnectionUpdate(
  connectionId: number,
  managed: ManagedConnection,
  update: Partial<ConnectionState>
): Promise<void> {
  const { connection, lastDisconnect, qr } = update;
  const userId = managed.userId;

  if (qr) {
    let qrDataUrl: string | null = null;
    try {
      qrDataUrl = await QRCode.toDataURL(qr);
    } catch (err) {
      console.error(`[whatsapp] Falha ao gerar QR code (conexão ${connectionId}):`, err);
    }
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { qr, status: "pairing" },
    }).catch(() => {});
    emitToUser(userId, "whatsapp_qr", { connectionId, qr, qrDataUrl });
  }

  if (connection === "open") {
    managed.isOpen = true;
    reconnectAttempts.delete(connectionId);
    const rawJid = managed.sock.user?.id || "";
    const phoneNumber = rawJid.split(":")[0]?.split("@")[0] || null;

    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        status: "connected",
        phone_number: phoneNumber,
        qr: null,
        last_connected_at: new Date(),
      },
    }).catch(() => {});
    emitToUser(userId, "whatsapp_status", { connectionId, status: "connected", phoneNumber });
  }

  if (connection === "close") {
    managed.isOpen = false;
    connections.delete(connectionId);

    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const wasManual = manualDisconnects.has(connectionId);
    manualDisconnects.delete(connectionId);

    if (loggedOut) {
      await clearAuthState(connectionId);
      await prisma.whatsAppConnection.update({
        where: { id: connectionId },
        data: { status: "disconnected", phone_number: null },
      }).catch(() => {});
      reconnectAttempts.delete(connectionId);
      emitToUser(userId, "whatsapp_status", { connectionId, status: "disconnected", loggedOut: true });
      return;
    }

    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { status: "disconnected" },
    }).catch(() => {});
    emitToUser(userId, "whatsapp_status", { connectionId, status: "disconnected", loggedOut: false });

    if (wasManual) {
      reconnectAttempts.delete(connectionId);
      return;
    }

    const attempts = (reconnectAttempts.get(connectionId) || 0) + 1;
    reconnectAttempts.set(connectionId, attempts);
    if (attempts > MAX_AUTO_RECONNECT_ATTEMPTS) {
      console.warn(`[whatsapp] Conexão ${connectionId} excedeu o número de tentativas automáticas de reconexão.`);
      await prisma.whatsAppConnection.update({
        where: { id: connectionId },
        data: { status: "error" },
      }).catch(() => {});
      emitToUser(userId, "whatsapp_status", { connectionId, status: "error" });
      return;
    }

    const delayMs = Math.min(2000 * attempts, 15000);
    setTimeout(() => {
      startConnection(connectionId).catch((err) => {
        console.error(`[whatsapp] Falha ao reconectar automaticamente a conexão ${connectionId}:`, err);
      });
    }, delayMs);
  }
}

/** User-triggered soft disconnect: closes the live socket but keeps the paired session so a later "Conectar" resumes without a new QR scan. */
export async function disconnectConnection(connectionId: number): Promise<void> {
  manualDisconnects.add(connectionId);
  reconnectAttempts.delete(connectionId);
  const managed = connections.get(connectionId);
  if (managed) {
    connections.delete(connectionId);
    try {
      managed.sock.end(undefined);
    } catch {
      // socket already dead — nothing to do
    }
  }
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { status: "disconnected", qr: null },
  }).catch(() => {});
}

/** Full teardown before deleting a connection: best-effort logout (invalidates the WA-side session when live) then drops the in-memory socket. */
export async function logoutAndForget(connectionId: number): Promise<void> {
  manualDisconnects.add(connectionId);
  reconnectAttempts.delete(connectionId);
  const managed = connections.get(connectionId);
  if (managed) {
    connections.delete(connectionId);
    try {
      await managed.sock.logout();
    } catch {
      // best-effort — the row is being deleted regardless
    } finally {
      try {
        managed.sock.end(undefined);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Used by the campaign worker to get a ready-to-send socket even if the QR pairing UI isn't
 * open — lazily reconnects from persisted auth_state when nothing is live in memory.
 */
export async function ensureConnected(connectionId: number, timeoutMs = 20000): Promise<WASocket> {
  const existing = connections.get(connectionId);
  if (existing?.isOpen) return existing.sock;

  const row = await prisma.whatsAppConnection.findUnique({
    where: { id: connectionId },
    select: { auth_state: true },
  });
  if (!row?.auth_state) {
    throw new Error("Conexão sem sessão pareada. É necessário conectar via QR Code antes de enviar mensagens.");
  }

  await startConnection(connectionId);

  return new Promise<WASocket>((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Tempo esgotado ao tentar restabelecer a conexão do WhatsApp."));
    }, timeoutMs);
    const interval = setInterval(() => {
      const managed = connections.get(connectionId);
      if (managed?.isOpen) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(managed.sock);
      }
    }, 400);
  });
}

export interface WhatsAppGroupSummary {
  jid: string;
  subject: string;
  participantCount: number;
}

/** Lists the WhatsApp groups this connection's paired account currently participates in — used
 *  to let the user pick a group as a send target instead of typing a JID by hand. */
export async function listGroups(connectionId: number): Promise<WhatsAppGroupSummary[]> {
  const sock = await ensureConnected(connectionId);
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g) => ({
      jid: g.id,
      subject: g.subject || g.id,
      participantCount: g.participants?.length ?? 0,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}
