import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle, CircleDot, Loader2, PlugZap, RotateCw } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { openTerminalSocket, type SshConnection, type TermStatus } from "@/src/services/ssh.service";

export const TERMINAL_THEME = {
  background: "#0B0B0D",
  foreground: "#E7E7EA",
  cursor: "#EC1889",
  cursorAccent: "#0B0B0D",
  selectionBackground: "rgba(236, 24, 137, 0.35)",
  black: "#1A1A1F", red: "#FF5A5F", green: "#2BD47D", yellow: "#F7B32B", blue: "#4C9BFF", magenta: "#9B7BFF", cyan: "#2DD4BF", white: "#D4D4D8",
  brightBlack: "#6B6B76", brightRed: "#FF7A7E", brightGreen: "#5BE39B", brightYellow: "#FFC85A", brightBlue: "#7BB4FF", brightMagenta: "#B79EFF", brightCyan: "#5EE4D2", brightWhite: "#FFFFFF",
};

export interface TerminalApi {
  /** Digita o texto no terminal (usado pelos comandos salvos). */
  send: (text: string) => void;
  focus: () => void;
}

/**
 * Um terminal = uma sessão SSH (o servidor valida JWT, permissão e impressão digital).
 * Fica montado mesmo quando a aba está escondida, para não derrubar a sessão ao trocar de aba.
 */
export function TerminalView({ connection, visible, onStatus, onReady }: {
  connection: SshConnection;
  visible: boolean;
  onStatus: (s: TermStatus) => void;
  onReady: (api: TerminalApi) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReturnType<typeof openTerminalSocket> | null>(null);
  const [status, setStatus] = useState<TermStatus>({ state: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  // O xterm em si: criado uma vez por aba.
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    termRef.current = term;
    fitRef.current = fit;

    // Ctrl+Shift+C / Ctrl+Shift+V (e Ctrl+C só quando há seleção) copiam/colam; o resto vai para o servidor.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && key === "c" && (e.shiftKey || term.hasSelection())) {
        void navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      if (e.ctrlKey && e.shiftKey && key === "v") {
        void navigator.clipboard?.readText().then((t) => term.paste(t));
        return false;
      }
      return true;
    });

    const sendInput = term.onData((d) => socketRef.current?.emit("data", d));
    const resize = term.onResize(({ cols, rows }) => socketRef.current?.emit("resize", { cols, rows }));

    const refit = () => {
      // Escondido (aba em segundo plano) tem tamanho 0: ajustar agora estragaria o tamanho do PTY.
      if (hostRef.current && hostRef.current.offsetWidth > 0 && hostRef.current.offsetHeight > 0) {
        try { fit.fit(); } catch { /* terminal ainda sem dimensão */ }
      }
    };
    const ro = new ResizeObserver(refit);
    ro.observe(hostRef.current!);

    onReady({
      send: (text) => socketRef.current?.emit("data", text),
      focus: () => term.focus(),
    });

    return () => {
      ro.disconnect();
      sendInput.dispose();
      resize.dispose();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A sessão: reabre quando a pessoa clica em "Reconectar".
  useEffect(() => {
    const term = termRef.current!;
    const fit = fitRef.current!;
    const set = (s: TermStatus) => {
      setStatus(s);
      onStatusRef.current(s);
    };
    if (attempt > 0) term.reset();
    set({ state: "connecting" });
    try { fit.fit(); } catch { /* sem dimensão ainda */ }

    const socket = openTerminalSocket();
    socketRef.current = socket;
    socket.on("connect", () => socket.emit("open", { connectionId: connection.id, cols: term.cols, rows: term.rows }));
    socket.on("connect_error", (e: Error) =>
      set({ state: "error", code: "socket", message: e.message === "unauthorized" ? "Sua sessão expirou. Entre de novo na CollabSuite." : "Não foi possível falar com o servidor da CollabSuite." }));
    socket.on("data", (d: string) => term.write(d));
    socket.on("status", (s: TermStatus) => {
      set(s);
      if (s.state === "connected") {
        try { fit.fit(); } catch { /* ok */ }
        socket.emit("resize", { cols: term.cols, rows: term.rows });
        term.focus();
      }
    });
    socket.on("disconnect", () => setStatus((cur) => (cur.state === "connected" || cur.state === "connecting" ? { state: "closed", reason: "disconnected", message: "A conexão com a CollabSuite caiu." } : cur)));

    return () => {
      socket.emit("close");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [attempt, connection.id]);

  // Voltou a ficar visível: ajusta o tamanho e devolve o foco.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* ok */ }
      termRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [visible]);

  const live = status.state === "connected";
  const failed = status.state === "error" || status.state === "closed";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border bg-[#0B0B0D]" data-testid="terminal" data-state={status.state}>
      <div ref={hostRef} className="h-full w-full p-2" />
      {status.state === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm text-white" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Conectando a {connection.username}@{connection.host}…
        </div>
      )}
      {failed && (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#141418]/95 px-4 py-3 text-sm text-white" role="alert">
          {status.state === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> : <PlugZap className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1">{status.message}</span>
          {status.state === "error" && (status.code === "fingerprint_not_trusted" || status.code === "forbidden" || status.code === "host_key_mismatch") ? null : (
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}><RotateCw className="h-4 w-4" /> Reconectar</Button>
          )}
        </div>
      )}
      {live && <CircleDot className="pointer-events-none absolute right-3 top-3 h-3 w-3 text-success" aria-label="Conectado" />}
    </div>
  );
}
