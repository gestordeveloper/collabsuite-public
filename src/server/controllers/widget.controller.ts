import type { Request, Response } from "express";
import multer from "multer";
import * as widgetService from "../services/widget.service";
import { emitAll } from "../lib/socket";
import { prisma } from "../lib/prisma";
import { storeBuffer, extFromMime } from "./upload.controller";

// Attachments coming from the public widget are capped much smaller than the internal
// /api/upload/file (500MB) and restricted to a mimetype allow-list: this endpoint only requires
// the widget's own JWT (issued to anyone who calls /initialize with an email, no password), so it
// has a wider abuse surface than the authenticated internal upload.
const WIDGET_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const WIDGET_ATTACHMENT_ALLOWED_MIME = [
  /^image\//,
  /^video\//,
  /^audio\//,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/vnd\.ms-excel$/,
  /^application\/vnd\.ms-powerpoint$/,
  /^text\/plain$/,
  /^text\/csv$/,
  /^application\/zip$/,
  /^application\/x-zip-compressed$/,
];

const widgetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: WIDGET_ATTACHMENT_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (WIDGET_ATTACHMENT_ALLOWED_MIME.some((re) => re.test(file.mimetype))) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de arquivo não permitido."));
    }
  },
});
const widgetUploadSingle = widgetUpload.single("file");
export function widgetUploadMiddleware(req: Request, res: Response, next: (err?: any) => void) {
  widgetUploadSingle(req, res, (err: any) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Arquivo muito grande. O limite é 25MB." });
      return;
    }
    res.status(400).json({ error: err.message || "Erro ao enviar arquivo." });
  });
}

export async function uploadAttachment(req: Request, res: Response) {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Nenhum arquivo enviado." });
      return;
    }

    const mimeType = file.mimetype || "application/octet-stream";
    const ext = extFromMime(mimeType);
    const url = await storeBuffer(file.buffer, ext, mimeType);

    res.json({ url, name: file.originalname, size: file.size, type: mimeType });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Erro ao enviar arquivo." });
  }
}

export async function initializeWidget(req: Request, res: Response) {
  try {
    const { funnel_id, user_id, first_name, last_name, email, telephone } = req.body;

    if (!funnel_id || !email || !first_name) {
      res.status(400).json({ error: "Parâmetros 'funnel_id', 'email' e 'first_name' são obrigatórios." });
      return;
    }

    const result = await widgetService.initializeWidgetUser({
      funnel_id: parseInt(funnel_id, 10),
      user_id: String(user_id),
      first_name,
      last_name,
      email,
      telephone,
    });

    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Erro ao inicializar widget." });
  }
}

export async function listTickets(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const email = req.user!.email;
    const funnelId = (req as any).widgetFunnelId;

    if (!funnelId) {
      res.status(400).json({ error: "Identificador do projeto não encontrado na sessão." });
      return;
    }

    const tickets = await widgetService.listWidgetTickets(userId, email, funnelId);
    res.json(tickets);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erro ao carregar chamados." });
  }
}

export async function createTicket(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const email = req.user!.email;
    const funnelId = (req as any).widgetFunnelId;
    const { title, description, call_reason } = req.body;

    if (!funnelId) {
      res.status(400).json({ error: "Identificador do projeto não encontrado na sessão." });
      return;
    }

    if (!title || !description || !call_reason) {
      res.status(400).json({ error: "Campos 'title', 'description' e 'call_reason' são obrigatórios." });
      return;
    }

    const ticket = await widgetService.createWidgetTicket(userId, email, funnelId, {
      title,
      description,
      call_reason,
    });

    // Notify agents via Socket.IO
    emitAll("task_created", ticket);

    res.status(201).json(ticket);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Erro ao criar chamado." });
  }
}

export async function listActivities(req: Request, res: Response) {
  try {
    const email = req.user!.email;
    const funnelId = (req as any).widgetFunnelId;
    const ticketId = parseInt(req.params.ticketId, 10);

    if (isNaN(ticketId)) {
      res.status(400).json({ error: "ID do chamado inválido." });
      return;
    }

    if (!funnelId) {
      res.status(400).json({ error: "Identificador do projeto não encontrado na sessão." });
      return;
    }

    const activities = await widgetService.listTicketActivities(ticketId, email, funnelId);
    res.json(activities);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Erro ao carregar mensagens." });
  }
}

export async function createActivity(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const email = req.user!.email;
    const funnelId = (req as any).widgetFunnelId;
    const ticketId = parseInt(req.params.ticketId, 10);
    const { content, attachment_url, attachment_name, attachment_type, attachment_size } = req.body;

    if (isNaN(ticketId)) {
      res.status(400).json({ error: "ID do chamado inválido." });
      return;
    }

    if ((!content || !content.trim()) && !attachment_url) {
      res.status(400).json({ error: "Informe uma mensagem ou anexe um arquivo." });
      return;
    }

    if (!funnelId) {
      res.status(400).json({ error: "Identificador do projeto não encontrado na sessão." });
      return;
    }

    const activity = await widgetService.createTicketActivity(ticketId, userId, email, funnelId, content, attachment_url
      ? { url: attachment_url, name: attachment_name, type: attachment_type, size: attachment_size }
      : undefined);

    // Notify agents via Socket.IO that task has been updated
    const updatedTask = await prisma.task.findUnique({
      where: { id: ticketId },
      include: {
        stage: { select: { id: true, name: true, stage_done: true } },
        user: { select: { id: true, first_name: true, last_name: true, photo: true } },
        activities: { include: { user: true }, orderBy: { created_at: "desc" } },
        taskUsers: { include: { user: true } },
      },
    });
    if (updatedTask) {
      emitAll("task_updated", updatedTask);
    }

    res.status(201).json(activity);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Erro ao enviar mensagem." });
  }
}
