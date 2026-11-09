import http from "http";
import type { Request, Response } from "express";
import { verifyToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { ensureStudioxRunning, STUDIOX_PORT } from "./process";

export const STUDIOX_COOKIE = "studiox_auth";

const knownUsers = new Map<number, number>(); // userId -> expira (ms): evita um SELECT por arquivo estático
const USER_TTL_MS = 60_000;

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function authorized(req: Request): Promise<boolean> {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const payload = verifyToken(bearer || readCookie(req.headers.cookie, STUDIOX_COOKIE) || "");
  if (!payload) return false;
  const seen = knownUsers.get(payload.userId);
  if (seen && seen > Date.now()) return true;
  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true } });
  if (!user) return false;
  knownUsers.set(payload.userId, Date.now() + USER_TTL_MS);
  return true;
}

/** Montado em `/studiox`: `req.url` já chega sem o prefixo, que é exatamente o que o app Python espera. */
export async function studioxProxy(req: Request, res: Response) {
  try {
    if (!(await authorized(req))) {
      res.status(401).type("text/plain").send("Sessão expirada. Recarregue o CollabSuite.");
      return;
    }
    await ensureStudioxRunning();
  } catch (err: any) {
    res.status(503).type("text/plain").send(err?.message || "StudioX indisponível.");
    return;
  }

  const headers = { ...req.headers, host: `127.0.0.1:${STUDIOX_PORT}` };
  delete headers.cookie;        // a sessão do CollabSuite não é da conta do StudioX
  delete headers.authorization;
  const upstream = http.request(
    { host: "127.0.0.1", port: STUDIOX_PORT, method: req.method, path: req.url || "/", headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) res.status(502).type("text/plain").send(`StudioX não respondeu: ${err.message}`);
    else res.destroy();
  });
  res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
}
