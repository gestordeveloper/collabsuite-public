/**
 * Auditoria e gravação das sessões. A gravação guarda só a SAÍDA do terminal (formato asciicast v2, uma linha JSON por evento) —
 * nunca o que foi digitado — em disco FORA de /uploads (que é servido publicamente), e só é lida por dono/admin via API.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { assertSshAccess, type Actor } from "./access";

const MAX_RECORDING_BYTES = 10 * 1024 * 1024;
const recordingsDir = () => path.resolve(process.env.SSH_RECORDINGS_DIR || path.join(process.cwd(), ".ssh-recordings"));

export interface Recorder {
  file: string;
  write(data: string): void;
  /** Fecha o arquivo e diz se o limite de tamanho cortou o final. */
  close(): Promise<{ truncated: boolean }>;
}

export function createRecorder(sessionId: number, cols: number, rows: number): Recorder {
  const dir = recordingsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = `${sessionId}-${crypto.randomBytes(6).toString("hex")}.cast`;
  const stream = fs.createWriteStream(path.join(dir, file), { flags: "wx", mode: 0o600 });
  const started = Date.now();
  let bytes = 0;
  let truncated = false;
  const line = (s: string) => {
    bytes += Buffer.byteLength(s);
    stream.write(s);
  };
  line(JSON.stringify({ version: 2, width: cols, height: rows, timestamp: Math.floor(started / 1000) }) + "\n");
  return {
    file,
    write(data) {
      if (truncated) return;
      const entry = JSON.stringify([(Date.now() - started) / 1000, "o", data]) + "\n";
      if (bytes + Buffer.byteLength(entry) > MAX_RECORDING_BYTES) {
        truncated = true;
        return;
      }
      line(entry);
    },
    close: () => new Promise((resolve) => stream.end(() => resolve({ truncated }))),
  };
}

/** No boot: sessões que ficaram "abertas" porque o servidor caiu/reiniciou. */
export async function sweepStuckSessions() {
  await prisma.sshSession.updateMany({ where: { ended_at: null }, data: { ended_at: new Date(), end_reason: "server_closed" } });
}

export async function listSessions(actor: Actor, projectId: number, page = 1) {
  await assertSshAccess(actor, projectId);
  const take = 30;
  const rows = await prisma.sshSession.findMany({
    where: { project_id: projectId },
    orderBy: { started_at: "desc" },
    skip: (Math.max(1, page) - 1) * take,
    take: take + 1,
  });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.user_id).filter((x): x is number => !!x) } }, select: { id: true, first_name: true, last_name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    has_next: rows.length > take,
    sessions: rows.slice(0, take).map((r) => {
      const u = r.user_id ? byId.get(r.user_id) : null;
      return {
        id: r.id,
        user: u ? { id: u.id, name: `${u.first_name} ${u.last_name ?? ""}`.trim() || u.email, email: u.email } : null,
        connection_name: r.connection_name,
        host: r.host,
        username: r.username,
        started_at: r.started_at.toISOString(),
        ended_at: r.ended_at?.toISOString() ?? null,
        end_reason: r.end_reason,
        ip: r.ip,
        bytes_out: r.bytes_out,
        has_recording: !!r.recording_file,
        recording_truncated: r.recording_truncated,
      };
    }),
  };
}

export async function readRecording(actor: Actor, projectId: number, sessionId: number): Promise<string> {
  await assertSshAccess(actor, projectId);
  const s = await prisma.sshSession.findFirst({ where: { id: sessionId, project_id: projectId }, select: { recording_file: true } });
  if (!s?.recording_file) throw new HttpError("Esta sessão não tem gravação.", 404);
  // O nome vem do banco, mas nunca confiamos em caminho: só o basename, dentro da pasta de gravações.
  const file = path.join(recordingsDir(), path.basename(s.recording_file));
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch {
    throw new HttpError("O arquivo da gravação não foi encontrado.", 404);
  }
}
