/** Buffer (debounce) por contato: várias mensagens seguidas viram uma só entrada para o agente.
 *  Equivale ao push_and_wait com Redis do modelo de referência, mas em memória (instância única). */
interface Pending<T> {
  items: T[];
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending<unknown>>();

export function pushAndFlush<T>(key: string, item: T, delayMs: number, flush: (items: T[]) => void): void {
  const existing = pending.get(key) as Pending<T> | undefined;
  if (existing) clearTimeout(existing.timer);
  const items = existing ? [...existing.items, item] : [item];
  const timer = setTimeout(() => {
    pending.delete(key);
    flush(items);
  }, Math.max(0, delayMs));
  pending.set(key, { items, timer });
}
