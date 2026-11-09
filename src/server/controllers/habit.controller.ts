import type { Request, Response } from "express";
import * as habitService from "../services/habit.service";
import * as teamService from "../services/habit-team.service";
import * as focusService from "../services/habit-focus.service";
import * as summaryService from "../services/habit-summary.service";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function handleError(err: any, res: Response) {
  res.status(400).json({ error: err.message || "Erro ao processar a solicitação." });
}

/** "Hoje" no calendário do usuário, enviado pelo cliente (?today=YYYY-MM-DD); cai no dia UTC do servidor. */
function todayFrom(value: unknown): string | undefined {
  return typeof value === "string" && DAY_RE.test(value) ? value : undefined;
}

export async function list(req: Request, res: Response) {
  try {
    res.json(await habitService.listHabits(req.user!.id, todayFrom(req.query.today)));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const habit = await habitService.createHabit(
      req.user!.id,
      req.user!.company_id ?? null,
      req.body,
      todayFrom(req.query.today)
    );
    res.status(201).json(habit);
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function update(req: Request, res: Response) {
  try {
    res.json(await habitService.updateHabit(parseInt(req.params.id), req.user!.id, req.body, todayFrom(req.query.today)));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    res.json(await habitService.deleteHabit(parseInt(req.params.id), req.user!.id));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function setLog(req: Request, res: Response) {
  try {
    const { date, done, today } = req.body as { date: string; done: boolean; today?: string };
    res.json(await habitService.setHabitLog(parseInt(req.params.id), req.user!.id, date, done, today));
  } catch (err: any) {
    handleError(err, res);
  }
}

// ── resumo semanal ──

export async function summary(req: Request, res: Response) {
  try {
    const today = todayFrom(req.query.today) ?? habitService.todayUtc();
    const requested = todayFrom(req.query.week_start);
    // Sem week_start usa a semana corrente (domingo a sábado).
    res.json(await summaryService.buildWeeklySummary(req.user!.id, requested ?? habitService.weekStart(today), today));
  } catch (err: any) {
    handleError(err, res);
  }
}

// ── foco do dia ──

export async function getFocus(req: Request, res: Response) {
  try {
    const day = todayFrom(req.query.date) ?? habitService.todayUtc();
    res.json(await focusService.getFocus(req.user!.id, day));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function saveFocus(req: Request, res: Response) {
  try {
    res.json(await focusService.saveFocus(req.user!.id, req.body.date, { items: req.body.items, review: req.body.review }));
  } catch (err: any) {
    handleError(err, res);
  }
}

// ── hábitos de equipe ──

export async function teamBoard(req: Request, res: Response) {
  try {
    res.json(await teamService.getTeamBoard(req.user!.id, todayFrom(req.query.today)));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function teamCandidates(req: Request, res: Response) {
  try {
    res.json(await teamService.listCandidates(req.user!.id));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function teamCreate(req: Request, res: Response) {
  try {
    res.status(201).json(await teamService.createTeamHabit(req.user!.id, req.user!.company_id ?? null, req.body));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function teamUpdate(req: Request, res: Response) {
  try {
    res.json(await teamService.updateTeamHabit(parseInt(req.params.id), req.user!.id, req.body));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function teamRemove(req: Request, res: Response) {
  try {
    res.json(await teamService.deleteTeamHabit(parseInt(req.params.id), req.user!.id));
  } catch (err: any) {
    handleError(err, res);
  }
}

export async function teamNudge(req: Request, res: Response) {
  try {
    res.json(await teamService.nudgeTeamHabit(parseInt(req.params.id), req.user!.id, todayFrom(req.query.today)));
  } catch (err: any) {
    handleError(err, res);
  }
}
