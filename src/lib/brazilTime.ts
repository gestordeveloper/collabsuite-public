// América/São_Paulo usa UTC-3 fixo (sem horário de verão desde 2019). Não usamos o fuso horário
// ambiente do navegador (que varia por usuário/SO) para não desalinhar due_at/scheduled_at entre
// o que a pessoa digita e o instante UTC realmente enviado à API — espelha o mesmo offset fixo
// usado no backend (src/server/services/task.service.ts).
const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Converte um instante UTC (ISO) para "YYYY-MM-DDTHH:MM" em horário de Brasília, para
 *  preencher um <input type="datetime-local"> — independente do fuso do navegador. */
export function toBrazilInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - BRAZIL_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Converte um valor de <input type="datetime-local"> ("YYYY-MM-DDTHH:MM"), interpretado como
 *  horário de Brasília, para o instante UTC (ISO) correto — independente do fuso do navegador. */
export function fromBrazilInputValue(value: string): string {
  const [datePart, timePart] = value.split(/[T ]/);
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, mnt] = (timePart || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mnt || 0, 0, 0) + BRAZIL_OFFSET_MS).toISOString();
}

/** Formata um instante UTC (ISO) como "dd/mm/aaaa, HH:MM:SS" em horário de Brasília, para
 *  exibição — independente do fuso do navegador. */
export function formatBrazilDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - BRAZIL_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
