import type { Response } from "express";

export class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function sendError(res: Response, err: any, scope = "tickets") {
  const status = err instanceof HttpError ? err.status : 400;
  if (status >= 500 || !(err instanceof HttpError)) console.error(`[${scope}]`, err);
  res.status(status).json({ error: err?.message || "Erro ao processar a solicitação." });
}
