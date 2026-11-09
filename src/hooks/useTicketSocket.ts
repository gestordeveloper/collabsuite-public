import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/src/store/auth.store";
import type { Ticket, TicketMessage } from "@/src/services/ticket.service";

export type TicketEvent = { action: "update"; ticket: Ticket } | { action: "delete"; ticketId: number };
export type TicketMessageEvent = { action: "create" | "update"; ticketId: number; message: TicketMessage };

interface Handlers {
  onTicket?: (event: TicketEvent) => void;
  onMessage?: (event: TicketMessageEvent) => void;
  onTransferred?: (event: { ticket: Ticket }) => void;
  onReconnect?: () => void;
}

/**
 * Socket próprio da tela de atendimento (mesmo padrão do useWhatsAppSocket): o servidor já manda cada evento
 * só para quem pode ver o ticket, então aqui basta repassar para os handlers da tela.
 */
export function useTicketSocket(handlers: Handlers) {
  const { user } = useAuthStore();
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!user) return;
    const socket: Socket = io({ auth: { userId: user.id } });

    socket.on("ticket", (e: TicketEvent) => ref.current.onTicket?.(e));
    socket.on("ticket_message", (e: TicketMessageEvent) => ref.current.onMessage?.(e));
    socket.on("ticket_transferred", (e: { ticket: Ticket }) => ref.current.onTransferred?.(e));
    // Uma queda de conexão pode ter perdido eventos: a tela recarrega o que está visível.
    let firstConnect = true;
    socket.on("connect", () => {
      if (firstConnect) firstConnect = false;
      else ref.current.onReconnect?.();
    });

    return () => {
      socket.disconnect();
    };
  }, [user]);
}
