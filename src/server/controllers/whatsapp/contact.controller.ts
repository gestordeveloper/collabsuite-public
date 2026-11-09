import type { Request, Response } from "express";
import * as contactService from "../../services/whatsapp/contact.service";

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function listLists(req: Request, res: Response) {
  try {
    const lists = await contactService.listLists(req.user!.id);
    res.json(lists);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function getList(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const list = await contactService.getList(req.user!.id, listId);
    res.json(list);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function createList(req: Request, res: Response) {
  try {
    const list = await contactService.createList(req.user!.id, req.body);
    res.status(201).json(list);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function updateList(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const list = await contactService.updateList(req.user!.id, listId, req.body);
    res.json(list);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function deleteList(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const result = await contactService.deleteList(req.user!.id, listId);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function listContacts(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const contacts = await contactService.listContacts(req.user!.id, listId);
    res.json(contacts);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function createContact(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const contact = await contactService.createContact(req.user!.id, listId, req.body);
    res.status(201).json(contact);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function bulkCreateContacts(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const result = await contactService.bulkCreateContacts(req.user!.id, listId, req.body.contacts);
    res.status(201).json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function updateContact(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const contactId = parseInt(req.params.contactId);
    const contact = await contactService.updateContact(req.user!.id, listId, contactId, req.body);
    res.json(contact);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function deleteContact(req: Request, res: Response) {
  try {
    const listId = parseInt(req.params.listId);
    const contactId = parseInt(req.params.contactId);
    const result = await contactService.deleteContact(req.user!.id, listId, contactId);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}
