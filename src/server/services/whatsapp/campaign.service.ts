import { prisma } from "../../lib/prisma";
import { isLikelyValidPhone } from "./connectionManager";
import { BRAZIL_OFFSET_MS } from "../task.service";

const DEFAULT_MIN_DELAY = 3;
const DEFAULT_MAX_DELAY = 8;
const DEFAULT_DAILY_LIMIT = 200;

async function findOwnedCampaign(userId: number, campaignId: number) {
  const campaign = await prisma.whatsAppCampaign.findFirst({
    where: { id: campaignId, user_id: userId },
  });
  if (!campaign) {
    throw new Error("Campanha não encontrada.");
  }
  return campaign;
}

async function assertOwnedConnection(userId: number, connectionId: number) {
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { id: connectionId, user_id: userId },
    select: { id: true },
  });
  if (!connection) {
    throw new Error("Conexão do WhatsApp não encontrada.");
  }
}

async function assertOwnedList(userId: number, listId: number) {
  const list = await prisma.whatsAppContactList.findFirst({
    where: { id: listId, user_id: userId },
    select: { id: true },
  });
  if (!list) {
    throw new Error("Lista de contatos não encontrada.");
  }
}

export interface AdhocRecipientInput {
  name?: string | null;
  phone: string;
}

export interface CampaignInput {
  connection_id: number;
  list_id?: number | null;
  group_jid?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  media_filename?: string | null;
  name: string;
  message: string;
  scheduled_at?: string | null;
  min_delay_seconds?: number;
  max_delay_seconds?: number;
  daily_limit?: number | null;
  recipients?: AdhocRecipientInput[];
}

function withRecipientCounts() {
  return {
    include: {
      _count: {
        select: { recipients: true },
      },
    },
  } as const;
}

export async function listCampaigns(userId: number) {
  const campaigns = await prisma.whatsAppCampaign.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    ...withRecipientCounts(),
  });

  // Attach a lightweight per-campaign status breakdown for the progress views without a
  // separate round trip from the frontend.
  const counts = await prisma.whatsAppCampaignRecipient.groupBy({
    by: ["campaign_id", "status"],
    where: { campaign_id: { in: campaigns.map((c) => c.id) } },
    _count: { _all: true },
  });

  return campaigns.map((c) => ({
    ...c,
    recipient_counts: buildStatusBreakdown(counts.filter((row) => row.campaign_id === c.id)),
  }));
}

function buildStatusBreakdown(rows: { status: string; _count: { _all: number } }[]) {
  const breakdown = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    if (row.status in breakdown) {
      (breakdown as any)[row.status] = row._count._all;
    }
  }
  return breakdown;
}

export async function getCampaign(userId: number, campaignId: number) {
  const campaign = await findOwnedCampaign(userId, campaignId);
  const counts = await prisma.whatsAppCampaignRecipient.groupBy({
    by: ["status"],
    where: { campaign_id: campaignId },
    _count: { _all: true },
  });
  return { ...campaign, recipient_counts: buildStatusBreakdown(counts) };
}

export async function listRecipients(userId: number, campaignId: number) {
  await findOwnedCampaign(userId, campaignId);
  return prisma.whatsAppCampaignRecipient.findMany({
    where: { campaign_id: campaignId },
    orderBy: { id: "asc" },
  });
}

function validateRecipientSource(data: Pick<CampaignInput, "list_id" | "recipients" | "group_jid">) {
  const hasList = !!data.list_id;
  const hasAdhoc = !!data.recipients && data.recipients.length > 0;
  const hasGroup = !!data.group_jid;
  const selectedCount = [hasList, hasAdhoc, hasGroup].filter(Boolean).length;
  if (selectedCount !== 1) {
    throw new Error("Informe exatamente um destino: uma lista de contatos, um grupo do WhatsApp, ou destinatários avulsos.");
  }
  if (hasAdhoc) {
    for (const r of data.recipients!) {
      if (!r.phone || !isLikelyValidPhone(r.phone)) {
        throw new Error(`Número de telefone inválido: "${r.phone}".`);
      }
    }
  }
}

async function replaceRecipients(campaignId: number, data: Pick<CampaignInput, "list_id" | "recipients" | "group_jid">) {
  await prisma.whatsAppCampaignRecipient.deleteMany({ where: { campaign_id: campaignId } });

  if (data.group_jid) {
    // A group send still goes through the same per-recipient pipeline (rate limiting, retry,
    // status tracking) as a list/ad-hoc campaign — it's just a single "recipient" whose `phone`
    // column holds the group JID directly instead of a phone number. The worker checks
    // `campaign.group_jid` to know not to re-derive a JID from it.
    await prisma.whatsAppCampaignRecipient.create({
      data: { campaign_id: campaignId, contact_id: null, phone: data.group_jid, name: null },
    });
  } else if (data.list_id) {
    const contacts = await prisma.whatsAppContact.findMany({ where: { list_id: data.list_id } });
    if (contacts.length > 0) {
      await prisma.whatsAppCampaignRecipient.createMany({
        data: contacts.map((c) => ({
          campaign_id: campaignId,
          contact_id: c.id,
          phone: c.phone,
          name: c.name,
        })),
      });
    }
  } else if (data.recipients && data.recipients.length > 0) {
    await prisma.whatsAppCampaignRecipient.createMany({
      data: data.recipients.map((r) => ({
        campaign_id: campaignId,
        contact_id: null,
        phone: r.phone.trim(),
        name: (r.name || "").trim() || null,
      })),
    });
  }
}

export async function createCampaign(userId: number, data: CampaignInput, taskId?: number | null) {
  await assertOwnedConnection(userId, data.connection_id);
  if (data.list_id) await assertOwnedList(userId, data.list_id);
  validateRecipientSource(data);

  const campaign = await prisma.whatsAppCampaign.create({
    data: {
      user_id: userId,
      connection_id: data.connection_id,
      list_id: data.list_id || null,
      group_jid: data.group_jid || null,
      media_url: data.media_url || null,
      media_type: data.media_type || null,
      media_filename: data.media_filename || null,
      task_id: taskId || null,
      name: data.name,
      message: data.message,
      status: "draft",
      scheduled_at: data.scheduled_at ? new Date(data.scheduled_at) : null,
      min_delay_seconds: data.min_delay_seconds ?? DEFAULT_MIN_DELAY,
      max_delay_seconds: data.max_delay_seconds ?? DEFAULT_MAX_DELAY,
      daily_limit: data.daily_limit === undefined ? DEFAULT_DAILY_LIMIT : data.daily_limit,
    },
  });

  await replaceRecipients(campaign.id, data);

  return getCampaign(userId, campaign.id);
}

export async function updateCampaign(userId: number, campaignId: number, data: Partial<CampaignInput>) {
  const campaign = await findOwnedCampaign(userId, campaignId);
  if (campaign.status !== "draft") {
    throw new Error("Somente campanhas em rascunho podem ser editadas. Cancele o agendamento primeiro.");
  }

  if (data.connection_id) await assertOwnedConnection(userId, data.connection_id);
  if (data.list_id) await assertOwnedList(userId, data.list_id);

  const recipientsChanged = data.list_id !== undefined || data.recipients !== undefined || data.group_jid !== undefined;
  if (recipientsChanged) {
    validateRecipientSource({
      list_id: data.list_id !== undefined ? data.list_id : campaign.list_id,
      recipients: data.recipients,
      group_jid: data.group_jid !== undefined ? data.group_jid : campaign.group_jid,
    });
  }

  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: {
      ...(data.connection_id !== undefined ? { connection_id: data.connection_id } : {}),
      ...(data.list_id !== undefined ? { list_id: data.list_id || null } : {}),
      ...(data.group_jid !== undefined ? { group_jid: data.group_jid || null } : {}),
      ...(data.media_url !== undefined ? { media_url: data.media_url || null } : {}),
      ...(data.media_type !== undefined ? { media_type: data.media_type || null } : {}),
      ...(data.media_filename !== undefined ? { media_filename: data.media_filename || null } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.message !== undefined ? { message: data.message } : {}),
      ...(data.scheduled_at !== undefined ? { scheduled_at: data.scheduled_at ? new Date(data.scheduled_at) : null } : {}),
      ...(data.min_delay_seconds !== undefined ? { min_delay_seconds: data.min_delay_seconds } : {}),
      ...(data.max_delay_seconds !== undefined ? { max_delay_seconds: data.max_delay_seconds } : {}),
      ...(data.daily_limit !== undefined ? { daily_limit: data.daily_limit } : {}),
    },
  });

  if (recipientsChanged) {
    await replaceRecipients(campaignId, {
      list_id: data.list_id !== undefined ? data.list_id : campaign.list_id,
      recipients: data.recipients,
      group_jid: data.group_jid !== undefined ? data.group_jid : campaign.group_jid,
    });
  }

  return getCampaign(userId, campaignId);
}

/** Keeps a "whatsapp" task's own due_at/hour_at (what the Agenda actually reads) in sync with
 *  its linked campaign's send time, so scheduling the message also schedules the task.
 *  hour_at must reflect the Brazil wall-clock hour regardless of the server process's own
 *  timezone (the container has no TZ set and defaults to UTC) — same fixed-offset convention
 *  as task.service.ts's parseBrazilDateTime/withBrazilTime. */
async function syncTaskSchedule(taskId: number, date: Date | null) {
  if (!date) return;
  const brazilLocal = new Date(date.getTime() - BRAZIL_OFFSET_MS);
  const hh = String(brazilLocal.getUTCHours()).padStart(2, "0");
  const mm = String(brazilLocal.getUTCMinutes()).padStart(2, "0");
  await prisma.task.update({ where: { id: taskId }, data: { due_at: date, hour_at: `${hh}:${mm}` } });
}

/** draft -> scheduled. scheduled_at null/past means "send ASAP" — the worker treats it as due immediately. */
export async function scheduleCampaign(userId: number, campaignId: number, scheduledAt: string | null) {
  const campaign = await findOwnedCampaign(userId, campaignId);
  if (campaign.status !== "draft" && campaign.status !== "paused") {
    throw new Error("Somente campanhas em rascunho ou pausadas podem ser agendadas.");
  }
  const recipientCount = await prisma.whatsAppCampaignRecipient.count({ where: { campaign_id: campaignId } });
  if (recipientCount === 0) {
    throw new Error("A campanha não tem destinatários.");
  }
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: { status: "scheduled", scheduled_at: scheduledDate },
  });
  if (campaign.task_id && scheduledDate) {
    await syncTaskSchedule(campaign.task_id, scheduledDate);
  }
  return getCampaign(userId, campaignId);
}

/** scheduled/paused -> draft, so a "whatsapp" task can go back to being edited before it's sent. */
export async function unscheduleCampaign(userId: number, campaignId: number) {
  const campaign = await findOwnedCampaign(userId, campaignId);
  if (campaign.status === "sending" || campaign.status === "done") {
    throw new Error("Não é possível cancelar o agendamento de uma campanha que já está sendo enviada ou concluída.");
  }
  await prisma.whatsAppCampaign.update({ where: { id: campaignId }, data: { status: "draft", scheduled_at: null } });
  return getCampaign(userId, campaignId);
}

/** Fetches the WhatsApp campaign linked to a task (the "whatsapp" task template), if any. */
export async function getCampaignByTaskId(taskId: number) {
  return prisma.whatsAppCampaign.findUnique({
    where: { task_id: taskId },
    include: { _count: { select: { recipients: true } } },
  });
}

/** Creates or updates the single WhatsApp campaign linked to a task — used by the "whatsapp" task
 *  template, where the campaign IS the task's content rather than a standalone item in the
 *  Campanhas list. Only the user who originally configured it (i.e. whose connection it sends
 *  through) can edit it afterwards. */
export async function upsertTaskCampaign(userId: number, taskId: number, data: CampaignInput) {
  const existing = await prisma.whatsAppCampaign.findUnique({ where: { task_id: taskId } });
  if (existing) {
    if (existing.user_id !== userId) {
      throw new Error("Esta mensagem de WhatsApp foi configurada por outro usuário e só pode ser editada por ele.");
    }
    return updateCampaign(userId, existing.id, data);
  }
  return createCampaign(userId, { ...data, name: data.name || `WhatsApp — tarefa ${taskId}` }, taskId);
}

export async function pauseCampaign(userId: number, campaignId: number) {
  const campaign = await findOwnedCampaign(userId, campaignId);
  if (campaign.status !== "sending" && campaign.status !== "scheduled") {
    throw new Error("Somente campanhas agendadas ou em envio podem ser pausadas.");
  }
  await prisma.whatsAppCampaign.update({ where: { id: campaignId }, data: { status: "paused" } });
  return getCampaign(userId, campaignId);
}

export async function deleteCampaign(userId: number, campaignId: number) {
  await findOwnedCampaign(userId, campaignId);
  await prisma.whatsAppCampaign.delete({ where: { id: campaignId } });
  return { success: true };
}
