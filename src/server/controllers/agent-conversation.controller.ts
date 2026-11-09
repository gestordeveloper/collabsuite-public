import type { Request, Response } from "express";
import * as agentConversationService from "../services/agent-conversation.service";
import type { MessageAttachmentInput } from "../services/agent-run.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const agentId = parseInt(req.params.agentId);
    const conversations = await agentConversationService.listConversations(agentId, req.user!.id);
    res.json(conversations);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function sendMessage(req: Request, res: Response) {
  try {
    const agentId = parseInt(req.params.agentId);
    const { conversation_id, message, icp_ids, attachments } = req.body as {
      conversation_id?: number | null;
      message: string;
      icp_ids?: number[];
      attachments?: MessageAttachmentInput[];
    };
    const result = await agentConversationService.sendMessage({
      agentId,
      conversationId: conversation_id ?? null,
      userId: req.user!.id,
      companyId: req.user!.company_id ?? null,
      message,
      icpIds: icp_ids,
      attachments,
    });
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const conversation = await agentConversationService.getConversation(parseInt(req.params.id), req.user!.id);
    res.json(conversation);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function rename(req: Request, res: Response) {
  try {
    const { title } = req.body as { title: string };
    const result = await agentConversationService.renameConversation(parseInt(req.params.id), req.user!.id, title);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const result = await agentConversationService.deleteConversation(parseInt(req.params.id), req.user!.id);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
