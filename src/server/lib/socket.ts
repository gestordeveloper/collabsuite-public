import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import { registerSshNamespace } from "../services/ssh/terminal";

let io: Server | null = null;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

  // Terminal SSH: namespace próprio, com JWT validado (o namespace padrão abaixo confia no userId do cliente).
  registerSshNamespace(io);

  io.on("connection", (socket) => {
    const userId = socket.handshake.auth?.userId as number | undefined;

    if (userId) {
      socket.join(`user:${userId}`);
    }

    socket.on("join_funnel", (funnelId: number) => {
      socket.join(`funnel:${funnelId}`);
    });

    socket.on("leave_funnel", (funnelId: number) => {
      socket.leave(`funnel:${funnelId}`);
    });

    socket.on("join_project", (projectId: number) => {
      socket.join(`project:${projectId}`);
    });

    socket.on("leave_project", (projectId: number) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on("join_run", (runId: number) => {
      socket.join(`run:${runId}`);
    });

    socket.on("leave_run", (runId: number) => {
      socket.leave(`run:${runId}`);
    });

    socket.on("disconnect", () => {
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.IO not initialized");
  }
  return io;
}

export function emitToFunnel(funnelId: number, event: string, data: unknown) {
  getIO().to(`funnel:${funnelId}`).emit(event, data);
}

export function emitToProject(projectId: number, event: string, data: unknown) {
  getIO().to(`project:${projectId}`).emit(event, data);
}

export function emitToUser(userId: number, event: string, data: unknown) {
  getIO().to(`user:${userId}`).emit(event, data);
}

export function emitToUsers(userIds: number[], event: string, data: unknown) {
  const io = getIO();
  for (const id of new Set(userIds)) io.to(`user:${id}`).emit(event, data);
}

export function emitToRun(runId: number, event: string, data: unknown) {
  getIO().to(`run:${runId}`).emit(event, data);
}

export function emitAll(event: string, data: unknown) {
  getIO().emit(event, data);
}