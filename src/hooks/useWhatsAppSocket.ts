import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/src/store/auth.store";
import type { WhatsAppConnectionStatus } from "@/src/services/whatsappConnection.service";

export interface WhatsAppQrEvent {
  connectionId: number;
  qr: string;
  qrDataUrl: string | null;
}

export interface WhatsAppStatusEvent {
  connectionId: number;
  status: WhatsAppConnectionStatus;
  phoneNumber?: string | null;
  loggedOut?: boolean;
}

/**
 * Opens its own socket.io connection scoped to the lifetime of whichever component mounts it
 * (the WhatsApp page), separate from the app-wide `useSocket()` hook used for task/project
 * events. Pushes live QR codes and connection status changes for the current user's WhatsApp
 * connections — falls back gracefully to nothing if the socket never connects, since the
 * connections list is still refetched by the caller on a poll/interval.
 */
export function useWhatsAppSocket(onQr: (event: WhatsAppQrEvent) => void, onStatus: (event: WhatsAppStatusEvent) => void) {
  const { user } = useAuthStore();
  const onQrRef = useRef(onQr);
  const onStatusRef = useRef(onStatus);
  onQrRef.current = onQr;
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!user) return;

    const socket: Socket = io({ auth: { userId: user.id } });

    socket.on("whatsapp_qr", (event: WhatsAppQrEvent) => onQrRef.current(event));
    socket.on("whatsapp_status", (event: WhatsAppStatusEvent) => onStatusRef.current(event));

    return () => {
      socket.disconnect();
    };
  }, [user]);
}
