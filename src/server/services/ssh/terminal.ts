/**
 * Terminal interativo: namespace Socket.IO "/ssh". Uma aba do navegador = um socket = uma sessão SSH.
 *
 * Segurança (o namespace padrão do app confia num userId enviado pelo cliente; este NÃO):
 *  - o JWT é validado na conexão e o usuário é recarregado do banco;
 *  - a permissão (dono/admin) é checada a cada "open", contra o projeto do acesso pedido;
 *  - o servidor só conecta se a impressão digital estiver fixada, e recusa se ela mudou;
 *  - limites de sessões simultâneas, tempo ocioso e duração máxima;
 *  - cada tentativa vira um registro de auditoria.
 */
import { StringDecoder } from "string_decoder";
import type { Server } from "socket.io";
import { prisma } from "../../lib/prisma";
import { verifyToken } from "../../lib/jwt";
import { assertSshAccess } from "./access";
import { Client, buildConfig, friendlyError, type ClientChannel, type StoredConnection } from "./client";
import { createRecorder, type Recorder } from "./session.service";

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const limits = () => ({
  idleMs: process.env.SSH_IDLE_SECONDS ? num("SSH_IDLE_SECONDS", 1800) * 1000 : num("SSH_IDLE_MINUTES", 30) * 60_000,
  maxMs: num("SSH_MAX_HOURS", 8) * 3_600_000,
  perUser: num("SSH_MAX_SESSIONS", 5),
});

/** Sessões abertas por usuário (em memória: o processo é único e o boot encerra as "órfãs" no banco). */
const openByUser = new Map<number, number>();
const bump = (userId: number, by: number) => openByUser.set(userId, Math.max(0, (openByUser.get(userId) ?? 0) + by));

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

type EndReason = "closed" | "disconnected" | "idle" | "max_duration" | "error" | "auth_failed" | "host_key_mismatch" | "server_closed";

export function registerSshNamespace(io: Server) {
  const ns = io.of("/ssh");

  ns.use(async (socket, next) => {
    const payload = verifyToken(String(socket.handshake.auth?.token ?? ""));
    if (!payload) return next(new Error("unauthorized"));
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, role: true } }).catch(() => null);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  ns.on("connection", (socket) => {
    const user = socket.data.user as { id: number; role: string };
    let opening = false;
    let live: { finish: (reason: EndReason) => Promise<void>; stream: ClientChannel | null; touch: () => void } | null = null;

    const status = (state: string, extra: Record<string, unknown> = {}) => socket.emit("status", { state, ...extra });

    socket.on("open", async (req: { connectionId?: number; cols?: number; rows?: number }) => {
      if (opening || live) return;
      opening = true;
      let sessionId = 0;
      try {
        const connectionId = Number(req?.connectionId);
        const conn = Number.isInteger(connectionId) ? await prisma.sshConnection.findUnique({ where: { id: connectionId } }) : null;
        if (!conn) return status("error", { code: "not_found", message: "Acesso SSH não encontrado." });
        try {
          await assertSshAccess(user, conn.project_id);
        } catch (e: any) {
          return status("error", { code: "forbidden", message: e?.message || "Sem permissão." });
        }
        if (!conn.host_fingerprint) {
          return status("error", { code: "fingerprint_not_trusted", message: "Antes de abrir o terminal, teste a conexão e confirme a impressão digital do servidor." });
        }
        const { idleMs, maxMs, perUser } = limits();
        if ((openByUser.get(user.id) ?? 0) >= perUser) {
          return status("error", { code: "too_many_sessions", message: `Limite de ${perUser} sessões simultâneas atingido. Feche alguma para abrir outra.` });
        }

        const cols = clamp(req?.cols, 10, 500, 80);
        const rows = clamp(req?.rows, 2, 200, 24);
        const fwd = String(socket.handshake.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
        const session = await prisma.sshSession.create({
          data: {
            connection_id: conn.id,
            project_id: conn.project_id,
            user_id: user.id,
            connection_name: conn.name,
            host: conn.host,
            username: conn.username,
            ip: (fwd || socket.handshake.address || "").slice(0, 64) || null,
            user_agent: String(socket.handshake.headers["user-agent"] ?? "").slice(0, 300) || null,
          },
        });
        sessionId = session.id;
        bump(user.id, 1);
        status("connecting");

        const client = new Client();
        let recorder: Recorder | null = null;
        let bytesOut = 0;
        let stream: ClientChannel | null = null;
        let ended = false;
        let idleTimer: NodeJS.Timeout | null = null;
        let maxTimer: NodeJS.Timeout | null = null;
        let mismatch = false;

        const finish = async (reason: EndReason) => {
          if (ended) return;
          ended = true;
          if (idleTimer) clearTimeout(idleTimer);
          if (maxTimer) clearTimeout(maxTimer);
          try { stream?.end(); } catch { /* já fechado */ }
          client.end();
          bump(user.id, -1);
          const rec = recorder ? await recorder.close().catch(() => ({ truncated: false })) : { truncated: false };
          await prisma.sshSession.update({
            where: { id: session.id },
            data: { ended_at: new Date(), end_reason: reason, bytes_out: bytesOut, recording_truncated: rec.truncated },
          }).catch(() => undefined);
          live = null;
        };
        const touch = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            status("closed", { reason: "idle", message: "Sessão encerrada por inatividade." });
            void finish("idle");
          }, idleMs);
        };
        live = { finish, stream: null, touch };

        let config;
        try {
          config = buildConfig(conn as StoredConnection, (fp) => {
            const same = fp === conn.host_fingerprint;
            if (!same) mismatch = true;
            return same;
          });
        } catch {
          status("error", { code: "secret", message: "Não foi possível ler as credenciais salvas. Cadastre-as novamente." });
          return void (await finish("error"));
        }

        client.on("keyboard-interactive", (_n, _i, _l, _p, done) => done([config.password ?? ""]));
        client.on("error", (err) => {
          if (ended) return;
          if (mismatch) {
            status("error", { code: "host_key_mismatch", message: "ATENÇÃO: a impressão digital do servidor mudou. A conexão foi bloqueada por segurança (possível interceptação). Se o servidor foi reinstalado, remova e recadastre o acesso." });
            return void finish("host_key_mismatch");
          }
          const f = friendlyError(err);
          status("error", { code: f.code, message: f.message });
          void finish(f.code === "auth_failed" ? "auth_failed" : "error");
        });
        client.on("close", () => {
          if (!ended) {
            status("closed", { reason: "server_closed", message: "O servidor encerrou a conexão." });
            void finish("closed");
          }
        });

        client.on("ready", () => {
          client.shell({ term: "xterm-256color", cols, rows }, (err, ch) => {
            if (err || ended) {
              status("error", { code: "shell", message: "Não foi possível abrir o shell no servidor." });
              return void finish("error");
            }
            stream = ch;
            if (live) live.stream = ch;
            if (conn.record_sessions) {
              recorder = createRecorder(session.id, cols, rows);
              void prisma.sshSession.update({ where: { id: session.id }, data: { recording_file: recorder.file } }).catch(() => undefined);
            }
            void prisma.sshConnection.update({ where: { id: conn.id }, data: { last_used_at: new Date() } }).catch(() => undefined);
            maxTimer = setTimeout(() => {
              status("closed", { reason: "max_duration", message: "Sessão encerrada: duração máxima atingida." });
              void finish("max_duration");
            }, maxMs);
            touch();
            status("connected", { sessionId: session.id, recording: !!conn.record_sessions });

            const decoder = new StringDecoder("utf8"); // um caractere UTF-8 pode vir partido entre dois pacotes
            const onOut = (buf: Buffer) => {
              touch(); // ocioso = sem digitação E sem saída (um build longo, só assistido, não pode cair)
              bytesOut += buf.length;
              const text = decoder.write(buf);
              if (!text) return;
              recorder?.write(text);
              socket.emit("data", text);
            };
            ch.on("data", onOut);
            ch.stderr.on("data", onOut);
            ch.on("close", () => {
              status("closed", { reason: "exit", message: "Sessão encerrada." });
              void finish("closed");
            });
          });
        });

        client.connect(config);
      } catch (err) {
        console.error("[ssh] open:", err instanceof Error ? err.message : err);
        status("error", { code: "error", message: "Não foi possível iniciar a sessão." });
        if (live) await live.finish("error");
        else if (sessionId) await prisma.sshSession.update({ where: { id: sessionId }, data: { ended_at: new Date(), end_reason: "error" } }).catch(() => undefined);
      } finally {
        opening = false;
      }
    });

    socket.on("data", (data: unknown) => {
      if (!live?.stream || typeof data !== "string" || data.length > 65_536) return;
      live.touch();
      live.stream.write(data);
    });

    socket.on("resize", (size: { cols?: number; rows?: number }) => {
      if (!live?.stream) return;
      live.stream.setWindow(clamp(size?.rows, 2, 200, 24), clamp(size?.cols, 10, 500, 80), 0, 0);
    });

    socket.on("close", () => void live?.finish("closed"));
    socket.on("disconnect", () => void live?.finish("disconnected"));
  });
}
