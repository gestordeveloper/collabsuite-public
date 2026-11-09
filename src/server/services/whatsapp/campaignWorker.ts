import type { AnyMessageContent } from "baileys";
import { prisma } from "../../lib/prisma";
import { ensureConnected, toJid } from "./connectionManager";
import { fetchStoredFileBytes } from "../../lib/fileStorage";
import { notifyUser } from "../notification.service";

/**
 * No job-queue library exists in this codebase, so this is a plain in-process poller. It is
 * intentionally conservative: it advances at most one recipient per campaign per tick, and gates
 * that on both a randomized min/max delay AND the connection's rolling 24h daily_limit — Baileys
 * is an unofficial WhatsApp Web protocol, and aggressive sending risks the number getting banned.
 */

const POLL_INTERVAL_MS = 18000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CONNECT_FAILURES = 3;

// In-memory pacing/failure state. Reset on process restart — the DB-derived min_delay_seconds
// floor (checked below) still holds even then, so a restart can never make sends happen faster
// than configured, only lose the extra "organic" jitter and the failure-streak counter.
const nextAllowedSendAt = new Map<number, number>();
const connectFailureStreak = new Map<number, number>();

let timer: ReturnType<typeof setInterval> | null = null;

export function startCampaignWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.error("[whatsapp-worker] Erro inesperado no ciclo do worker:", err));
  }, POLL_INTERVAL_MS);
  console.log(`[whatsapp-worker] Worker de campanhas iniciado (intervalo de ${POLL_INTERVAL_MS / 1000}s).`);
}

export function stopCampaignWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  await promoteDueCampaigns();

  const sendingCampaigns = await prisma.whatsAppCampaign.findMany({
    where: { status: "sending" },
  });

  for (const campaign of sendingCampaigns) {
    try {
      await processCampaignTick(campaign);
    } catch (err) {
      console.error(`[whatsapp-worker] Erro ao processar a campanha ${campaign.id}:`, err);
    }
  }
}

/** status: scheduled with scheduled_at null or already in the past -> sending. Fetches the due
 *  campaigns before flipping them so we know exactly which ones just started (and their owner),
 *  in order to notify each owner exactly once. */
async function promoteDueCampaigns(): Promise<void> {
  const due = await prisma.whatsAppCampaign.findMany({
    where: {
      status: "scheduled",
      OR: [{ scheduled_at: null }, { scheduled_at: { lte: new Date() } }],
    },
    select: { id: true, user_id: true, name: true },
  });
  if (due.length === 0) return;

  await prisma.whatsAppCampaign.updateMany({
    where: { id: { in: due.map((c) => c.id) } },
    data: { status: "sending" },
  });

  for (const campaign of due) {
    try {
      await notifyUser(campaign.user_id, {
        type: "campaign_started",
        title: "Campanha de WhatsApp iniciada",
        body: `O envio da campanha "${campaign.name}" começou.`,
        link: "/whatsapp",
        metadata: { campaignId: campaign.id },
      });
    } catch (err) {
      // The campaign is already flipped to "sending" above and won't be revisited by this
      // query again, so a failure here just means this one owner misses the notification —
      // it must not stop the remaining campaigns in this batch from being notified.
      console.error(`[whatsapp-worker] Falha ao notificar início da campanha ${campaign.id}:`, err);
    }
  }
}

async function processCampaignTick(campaign: {
  id: number;
  connection_id: number;
  message: string;
  group_jid: string | null;
  media_url: string | null;
  media_type: string | null;
  media_filename: string | null;
  min_delay_seconds: number;
  max_delay_seconds: number;
  daily_limit: number | null;
}): Promise<void> {
  await skipOptedOutRecipients(campaign.id);

  const pendingCount = await prisma.whatsAppCampaignRecipient.count({
    where: { campaign_id: campaign.id, status: "pending" },
  });

  if (pendingCount === 0) {
    await prisma.whatsAppCampaign.update({
      where: { id: campaign.id },
      data: { status: "done" },
    });
    nextAllowedSendAt.delete(campaign.id);
    connectFailureStreak.delete(campaign.id);
    return;
  }

  // In-memory jitter gate.
  const gate = nextAllowedSendAt.get(campaign.id);
  if (gate && Date.now() < gate) return;

  // Hard floor derived from the DB so pacing survives a worker restart even without the jitter map.
  const lastSent = await prisma.whatsAppCampaignRecipient.findFirst({
    where: { campaign_id: campaign.id, sent_at: { not: null } },
    orderBy: { sent_at: "desc" },
    select: { sent_at: true },
  });
  if (lastSent?.sent_at) {
    const floorMs = Math.max(0, campaign.min_delay_seconds) * 1000;
    const elapsed = Date.now() - lastSent.sent_at.getTime();
    if (elapsed < floorMs) return;
  }

  // Conservative daily cap, counted across every campaign sharing this connection.
  if (campaign.daily_limit != null) {
    const since = new Date(Date.now() - DAY_MS);
    const sentLast24h = await prisma.whatsAppCampaignRecipient.count({
      where: {
        sent_at: { gte: since },
        campaign: { connection_id: campaign.connection_id },
      },
    });
    if (sentLast24h >= campaign.daily_limit) {
      return; // wait for the rolling window to free up capacity
    }
  }

  const nextRecipient = await prisma.whatsAppCampaignRecipient.findFirst({
    where: { campaign_id: campaign.id, status: "pending" },
    orderBy: { id: "asc" },
  });
  if (!nextRecipient) return;

  let sock;
  try {
    sock = await ensureConnected(campaign.connection_id, 20000);
    connectFailureStreak.delete(campaign.id);
  } catch (err) {
    const streak = (connectFailureStreak.get(campaign.id) || 0) + 1;
    connectFailureStreak.set(campaign.id, streak);
    console.warn(`[whatsapp-worker] Falha ao conectar para a campanha ${campaign.id} (tentativa ${streak}):`, (err as Error)?.message || err);
    if (streak >= MAX_CONNECT_FAILURES) {
      await prisma.whatsAppCampaign.update({
        where: { id: campaign.id },
        data: { status: "failed" },
      });
      connectFailureStreak.delete(campaign.id);
    }
    return;
  }

  // A group-targeted campaign's single recipient row holds the group JID directly in `phone`
  // (see campaign.service.ts#replaceRecipients) rather than a number to convert.
  const jid = campaign.group_jid || toJid(nextRecipient.phone);
  const text = campaign.message.replace(/\{\{\s*nome\s*\}\}/gi, nextRecipient.name || "");

  try {
    const content = await buildMessageContent(campaign, text);
    await sock.sendMessage(jid, content);
    await prisma.whatsAppCampaignRecipient.update({
      where: { id: nextRecipient.id },
      data: { status: "sent", sent_at: new Date(), error: null },
    });
  } catch (err: any) {
    await prisma.whatsAppCampaignRecipient.update({
      where: { id: nextRecipient.id },
      data: { status: "failed", error: String(err?.message || err).slice(0, 500) },
    });
  }

  scheduleNextSend(campaign.id, campaign.min_delay_seconds, campaign.max_delay_seconds);
}

/** Builds the Baileys message payload for a send — plain text, or one of the supported media
 *  types (downloaded server-side from wherever uploadFile put it, S3 or local) with the message
 *  as caption. WhatsApp doesn't render a caption on regular audio attachments, so it's dropped
 *  there rather than silently ignored without the sender realizing why. */
async function buildMessageContent(
  campaign: { message: string; media_url: string | null; media_type: string | null; media_filename: string | null },
  text: string
): Promise<AnyMessageContent> {
  if (!campaign.media_url || !campaign.media_type) {
    return { text };
  }

  const buffer = await fetchStoredFileBytes(campaign.media_url);
  const caption = text || undefined;

  switch (campaign.media_type) {
    case "image":
      return { image: buffer, caption };
    case "video":
      return { video: buffer, caption };
    case "audio":
      return { audio: buffer, mimetype: "audio/mpeg" };
    case "document":
      return { document: buffer, mimetype: "application/pdf", fileName: campaign.media_filename || "documento.pdf", caption };
    default:
      return { text };
  }
}

function scheduleNextSend(campaignId: number, minSec: number, maxSec: number): void {
  const lo = Math.max(0, minSec);
  const hi = Math.max(lo, maxSec);
  const delayMs = (lo + Math.random() * (hi - lo)) * 1000;
  nextAllowedSendAt.set(campaignId, Date.now() + delayMs);
}

/**
 * WhatsAppCampaignRecipient.contact_id is a plain nullable reference (no Prisma relation defined
 * in the schema), so opted-out contacts are matched with a small manual join rather than a
 * relational filter.
 */
async function skipOptedOutRecipients(campaignId: number): Promise<void> {
  const pending = await prisma.whatsAppCampaignRecipient.findMany({
    where: { campaign_id: campaignId, status: "pending", contact_id: { not: null } },
    select: { id: true, contact_id: true },
  });
  if (pending.length === 0) return;

  const contactIds = [...new Set(pending.map((p) => p.contact_id as number))];
  const optedOutContacts = await prisma.whatsAppContact.findMany({
    where: { id: { in: contactIds }, opted_out: true },
    select: { id: true },
  });
  if (optedOutContacts.length === 0) return;

  const optedOutSet = new Set(optedOutContacts.map((c) => c.id));
  const idsToSkip = pending.filter((p) => p.contact_id && optedOutSet.has(p.contact_id)).map((p) => p.id);
  if (idsToSkip.length === 0) return;

  await prisma.whatsAppCampaignRecipient.updateMany({
    where: { id: { in: idsToSkip } },
    data: { status: "skipped" },
  });
}
