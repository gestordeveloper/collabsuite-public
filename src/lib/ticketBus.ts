import { useEffect } from "react";
import type { TicketEvent, TicketMessageEvent } from "@/src/hooks/useTicketSocket";

type Events = { ticket: TicketEvent; message: TicketMessageEvent; reconnect: undefined };
type Listener<K extends keyof Events> = (payload: Events[K]) => void;

const listeners: { [K in keyof Events]: Set<Listener<K>> } = { ticket: new Set(), message: new Set(), reconnect: new Set() };

/** Barramento mínimo: a tela abre um único socket e repassa os eventos para os componentes interessados. */
export const ticketBus = {
  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    (listeners[type] as Set<Listener<K>>).forEach((fn) => fn(payload));
  },
};

export function useTicketBus<K extends keyof Events>(type: K, handler: Listener<K>) {
  useEffect(() => {
    const set = listeners[type] as Set<Listener<K>>;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }, [type, handler]);
}
