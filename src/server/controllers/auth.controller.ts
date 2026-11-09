import type { Request, Response } from "express";
import * as authService from "../services/auth.service";
import { sanitizeUser } from "../services/auth.service";
import { googleCalendarService } from "../services/googleCalendar.service";
import { prisma } from "../lib/prisma";

export async function register(req: Request, res: Response) {
  try {
    const result = await authService.registerUser(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Erro ao registrar usuário." });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { login, password } = req.body;
    const result = await authService.loginUser(login, password);
    res.json(result);
  } catch (err: any) {
    console.error("[LOGIN ERROR]", err);
    res.status(err.status || 500).json({ error: err.message || "Erro ao realizar login." });
  }
}

export async function me(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Não autorizado." });
    return;
  }
  res.json({ user: sanitizeUser(req.user) });
}

export async function listUsers(req: Request, res: Response) {
  try {
    const users = await authService.listUsers();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateUser(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.id);
    const updated = await authService.updateUser(userId, req.body);
    res.json(sanitizeUser(updated));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function googleAuthUrl(req: Request, res: Response) {
  try {
    const url = googleCalendarService.getAuthUrl(req.user!.id);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function googleAuthCallback(req: Request, res: Response) {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      res.status(400).send("Faltando code ou state");
      return;
    }

    const userId = parseInt(state as string);
    const tokens = await googleCalendarService.handleCallback(code as string);

    if (tokens.refresh_token) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        let settings: any = {};
        if (user.schedule_settings) {
          try { settings = JSON.parse(user.schedule_settings); } catch (e) {}
        }
        settings = { ...settings, google_refresh_token: tokens.refresh_token };
        await prisma.user.update({
          where: { id: userId },
          data: { schedule_settings: JSON.stringify(settings) }
        });
      }
    }

    res.send(`<script>window.close();</script>`);
  } catch (err: any) {
    res.status(500).send("Erro no callback do Google: " + err.message);
  }
}