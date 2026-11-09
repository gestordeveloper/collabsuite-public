import type { Request, Response } from "express";
import { sendError } from "../lib/httpError";
import * as connections from "../services/ssh/connection.service";
import * as commands from "../services/ssh/command.service";
import * as sessions from "../services/ssh/session.service";
import { assertSshAccess } from "../services/ssh/access";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendError(res, err, "ssh");
  }
};
const actor = (req: Request) => ({ id: req.user!.id, role: req.user!.role as string });
const pid = (req: Request) => parseInt(req.params.projectId);
const id = (req: Request) => parseInt(req.params.id);

/** Para a interface decidir se mostra a aba (a regra de verdade é aplicada em cada rota). */
export const access = wrap(async (req, res) => {
  try {
    await assertSshAccess(actor(req), pid(req));
    res.json({ allowed: true });
  } catch {
    res.json({ allowed: false });
  }
});

export const listConnections = wrap(async (req, res) => res.json(await connections.listConnections(actor(req), pid(req))));
export const createConnection = wrap(async (req, res) => res.status(201).json(await connections.createConnection(actor(req), pid(req), req.body ?? {})));
export const updateConnection = wrap(async (req, res) => res.json(await connections.updateConnection(actor(req), pid(req), id(req), req.body ?? {})));
export const deleteConnection = wrap(async (req, res) => res.json(await connections.deleteConnection(actor(req), pid(req), id(req))));
export const testConnection = wrap(async (req, res) => res.json(await connections.testConnection(actor(req), pid(req), id(req))));
export const trustFingerprint = wrap(async (req, res) => res.json(await connections.trustFingerprint(actor(req), pid(req), id(req), String(req.body?.fingerprint ?? ""))));

export const listCommands = wrap(async (req, res) => res.json(await commands.listCommands(actor(req), pid(req))));
export const createCommand = wrap(async (req, res) => res.status(201).json(await commands.createCommand(actor(req), pid(req), req.body ?? {})));
export const updateCommand = wrap(async (req, res) => res.json(await commands.updateCommand(actor(req), pid(req), id(req), req.body ?? {})));
export const deleteCommand = wrap(async (req, res) => res.json(await commands.deleteCommand(actor(req), pid(req), id(req))));

export const listSessions = wrap(async (req, res) => res.json(await sessions.listSessions(actor(req), pid(req), Math.max(1, parseInt(String(req.query.page ?? "1")) || 1))));
export const recording = wrap(async (req, res) => {
  const text = await sessions.readRecording(actor(req), pid(req), id(req));
  res.type("text/plain; charset=utf-8").set("Cache-Control", "no-store").send(text);
});
