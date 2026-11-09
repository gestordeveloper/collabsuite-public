import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/src/store/auth.store";

export interface RunStepEvent {
  runId: number;
  stepId: number;
  nodeId: string | null;
  output?: string;
  error?: string;
}

export interface RunFinishedEvent {
  runId: number;
  status: "done" | "error";
  output?: string;
}

/** Opens its own socket.io connection scoped to the run being watched (same pattern as
 *  useWhatsAppSocket) — joins the `run:{id}` room and forwards step-level progress events. */
export function useAgentRunSocket(
  runId: number | null,
  handlers: {
    onStepStarted?: (event: RunStepEvent) => void;
    onStepFinished?: (event: RunStepEvent) => void;
    onFinished?: (event: RunFinishedEvent) => void;
  }
) {
  const { user } = useAuthStore();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!user || !runId) return;

    const socket: Socket = io({ auth: { userId: user.id } });
    socket.emit("join_run", runId);
    socket.on("run:step_started", (e: RunStepEvent) => handlersRef.current.onStepStarted?.(e));
    socket.on("run:step_finished", (e: RunStepEvent) => handlersRef.current.onStepFinished?.(e));
    socket.on("run:finished", (e: RunFinishedEvent) => handlersRef.current.onFinished?.(e));

    return () => {
      socket.emit("leave_run", runId);
      socket.disconnect();
    };
  }, [user, runId]);
}
