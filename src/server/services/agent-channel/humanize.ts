/** Envio "humanizado" do modelo de referência: a resposta vira várias mensagens curtas, com "digitando…"
 *  e atraso proporcional ao tamanho de cada uma. */
const CHARS_PER_SECOND = 27;
const MIN_DELAY_MS = 500;
const MAX_CHUNK = 60;
const GAP_BETWEEN_CHUNKS_MS = 400;

export function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length <= MAX_CHUNK) {
      chunks.push(line);
      continue;
    }

    let current = "";
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (!current) current = sentence;
      else if (current.length + 1 + sentence.length <= MAX_CHUNK) current += ` ${sentence}`;
      else {
        chunks.push(current);
        current = sentence;
      }

      while (current.length > MAX_CHUNK) {
        let breakIdx = current.lastIndexOf(" ", MAX_CHUNK);
        if (breakIdx <= 0) breakIdx = MAX_CHUNK;
        chunks.push(current.slice(0, breakIdx));
        current = current.slice(breakIdx).trim();
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

export const typingDelayMs = (text: string) => Math.max(MIN_DELAY_MS, Math.round((text.length / CHARS_PER_SECOND) * 1000));
export const GAP_MS = GAP_BETWEEN_CHUNKS_MS;
