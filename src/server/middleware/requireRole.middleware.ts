import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@prisma/client";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Você não tem permissão para executar esta ação." });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole("admin", "super_admin");
