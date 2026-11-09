import type { Request, Response } from "express";
import * as connectionService from "../../services/whatsapp/connection.service";
import * as connectionManager from "../../services/whatsapp/connectionManager";

function handleError(err: any, res: Response) {
  console.error("[whatsapp/connections]", err);
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

export async function list(req: Request, res: Response) {
  try {
    const connections = await connectionService.listConnections(req.user!.id);
    res.json(connections);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function get(req: Request, res: Response) {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const connection = await connectionService.getConnection(req.user!.id, connectionId);
    res.json(connection);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const connection = await connectionService.createConnection(req.user!.id, req.body);
    res.status(201).json(connection);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function rename(req: Request, res: Response) {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const connection = await connectionService.renameConnection(req.user!.id, connectionId, req.body.label);
    res.json(connection);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function updateTicketSettings(req: Request, res: Response) {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const connection = await connectionService.updateTicketSettings(req.user!.id, connectionId, req.body);
    res.json(connection);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function connect(req: Request, res: Response) {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const connection = await connectionService.startPairing(req.user!.id, connectionId);
    res.json(connection);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function disconnect(req: Request, res: Response) {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const connection = await connectionService.disconnectConnection(req.user!.id, connectionId);
    res.json(connection);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const result = await connectionService.deleteConnection(req.user!.id, connectionId);
    res.json(result);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function listGroups(req: Request, res: Response) {
  try {
    const connectionId = parseInt(req.params.connectionId);
    await connectionService.getConnection(req.user!.id, connectionId); // ownership check
    const groups = await connectionManager.listGroups(connectionId);
    res.json(groups);
  } catch (err: any) {
    handleError(err, res);
  }
}
