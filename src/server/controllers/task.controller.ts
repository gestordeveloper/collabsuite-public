import type { Request, Response } from "express";
import * as taskService from "../services/task.service";
import * as activityService from "../services/activity.service";
import multer from "multer";
import path from "path";
import { storeBuffer, extFromMime } from "./upload.controller";
import { emitAll, emitToUser } from "../lib/socket";

export async function listTasks(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const funnel_id = req.query.funnel_id ? parseInt(req.query.funnel_id as string) : undefined;
    const user_id = req.query.user_id ? parseInt(req.query.user_id as string) : undefined;
    const status = req.query.status as string | undefined;
    const is_sprint = req.query.is_sprint === "true" ? true : req.query.is_sprint === "false" ? false : undefined;

    const result = await taskService.listTasks({ funnel_id, user_id, status, is_sprint, page, limit }, req.user!.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getTask(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    if (!(await taskService.canViewTask(taskId, req.user!.id))) {
      return res.status(404).json({ error: "Tarefa não encontrada ou sem permissão de acesso." });
    }
    const task = await taskService.getTaskById(taskId);
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createTask(req: Request, res: Response) {
  try {
    console.log("=== CREATE TASK BODY ===", req.body);
    const task = await taskService.createTask(req.body, req.user!.id);
    emitAll("task_created", task);
    res.status(201).json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateTask(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const updated = await taskService.updateTask(taskId, req.body, req.user!.id);
    emitAll("task_updated", updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteTask(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    await taskService.softDeleteTask(taskId);
    emitAll("task_deleted", { taskId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function addTaskMember(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const { user_id } = req.body;
    const member = await taskService.addTaskMember(taskId, user_id);
    emitAll("task_member_added", { taskId, member });
    res.status(201).json(member);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function removeTaskMember(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);
    await taskService.removeTaskMember(taskId, userId);
    emitAll("task_member_removed", { taskId, userId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPublicCalendar(req: Request, res: Response) {
  try {
    const data = await taskService.getPublicCalendar(req.params.username);
    res.json(data);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function publicSchedule(req: Request, res: Response) {
  try {
    const meeting = await taskService.createPublicMeeting(req.params.username, req.body);
    emitToUser(meeting.user_id!, "task_created", meeting);
    res.status(201).json(meeting);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function generateMeetLink(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const updated = await taskService.generateMeetLink(taskId, req.user!.id);
    emitAll("task_updated", updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPublicTask(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: "ID inválido" });
    const task = await taskService.getTaskById(taskId);
    if (!task || task.deleted_at) return res.status(404).json({ error: "Tarefa não encontrada" });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/** Tarefa pública aprovável: existe, não foi removida e é do tipo documento. */
async function getApprovablePublicTask(req: Request, res: Response) {
  const taskId = parseInt(req.params.id);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return null; }
  const task = await taskService.getTaskById(taskId);
  if (!task || task.deleted_at) { res.status(404).json({ error: "Tarefa não encontrada" }); return null; }
  if ((task.template ?? "default") !== "default") {
    res.status(400).json({ error: "Esta tarefa não aceita aprovação" });
    return null;
  }
  return task;
}

export async function approvePublicTask(req: Request, res: Response) {
  try {
    const task = await getApprovablePublicTask(req, res);
    if (!task) return;
    const approved = req.body?.approved !== false;
    const updated = await taskService.setTaskApproval(task.id, approved, "Cliente");
    emitAll("task_updated", updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// Anexos de comentários do cliente: só tipos "seguros" (nada que o navegador execute, como html/svg/js),
// pois os arquivos são servidos na mesma origem do app.
const CLIENT_ATTACH_MIME = /^(image\/(png|jpe?g|gif|webp)|video\/|audio\/|application\/pdf|application\/zip|application\/msword|application\/vnd\.(ms-|openxmlformats-officedocument\.)|text\/(plain|csv))/i;
const CLIENT_ATTACH_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf", "zip", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "mp3", "wav", "ogg", "m4a", "webm", "mp4", "mov"]);
export const publicCommentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
}).single("file");

export async function addPublicComment(req: Request, res: Response) {
  try {
    const task = await getApprovablePublicTask(req, res);
    if (!task) return;
    const content = typeof req.body?.content === "string" ? req.body.content.trim().slice(0, 2000) : "";
    const file = req.file;
    if (!content && !file) return res.status(400).json({ error: "Comentário vazio" });

    let attachment: activityService.ActivityAttachment | undefined;
    if (file) {
      const mime = (file.mimetype || "").split(";")[0].trim();
      if (!CLIENT_ATTACH_MIME.test(mime)) return res.status(400).json({ error: "Tipo de arquivo não permitido" });
      const nameExt = path.extname(file.originalname).replace(/^\./, "").toLowerCase();
      const ext = CLIENT_ATTACH_EXT.has(nameExt) ? nameExt : extFromMime(mime);
      if (!CLIENT_ATTACH_EXT.has(ext)) return res.status(400).json({ error: "Tipo de arquivo não permitido" });
      const url = await storeBuffer(file.buffer, ext, mime);
      attachment = { url, name: file.originalname.slice(0, 255), type: mime, size: file.size };
    }

    const activity = await activityService.addClientComment(task.id, content, attachment);
    emitAll("task_updated", await taskService.getTaskById(task.id));
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function setTaskApproval(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    const user = req.user!;
    const by = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Equipe";
    const updated = await taskService.setTaskApproval(taskId, req.body?.approved !== false, by);
    emitAll("task_updated", updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function submitPublicForm(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: "ID inválido" });

    const task = await taskService.getTaskById(taskId);
    if (!task || task.deleted_at) return res.status(404).json({ error: "Tarefa não encontrada" });
    if (!task.form_schema) return res.status(400).json({ error: "Este recurso não tem um formulário configurado" });

    // Only allow fields configured in the form_schema
    let schema: any;
    try { schema = JSON.parse(task.form_schema as string); } catch { return res.status(400).json({ error: "Schema inválido" }); }

    const allowedFields = new Set(
      (schema.fields ?? []).map((f: any) => f.id)
    );

    const payload: Record<string, any> = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (allowedFields.has(key)) {
        payload[key] = val;
      }
    }

    // Save submission to form_response table
    await taskService.submitFormResponse(taskId, payload);
    res.json({ success: true, taskId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getFormResponses(req: Request, res: Response) {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: "ID inválido" });

    const responses = await taskService.getFormResponses(taskId);
    res.json(responses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}