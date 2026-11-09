import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Pause, Play, RotateCcw, Video } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Empty, ErrorBox, Loading, useLoad } from "@/src/components/github/common";
import * as ssh from "@/src/services/ssh.service";
import { TERMINAL_THEME } from "./TerminalView";

const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
function duration(a: string, b: string | null) {
  if (!b) return "em andamento";
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}min ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`;
}

/** Auditoria: quem abriu o terminal, onde, quando, por quanto tempo e por que acabou — com reprodução da sessão. */
export function SessionsPanel({ projectId }: { projectId: number }) {
  const [page, setPage] = useState(1);
  const [replay, setReplay] = useState<ssh.SshSessionRow | null>(null);
  const { data, loading, error, reload } = useLoad(() => ssh.listSessions(projectId, page), [projectId, page]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data || data.sessions.length === 0) return <Empty>Nenhuma sessão registrada ainda. Cada vez que alguém abrir o terminal, ela aparece aqui.</Empty>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Registro de auditoria das sessões deste projeto (não pode ser apagado pela interface).</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="bg-surface/50 text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 font-medium">Quem</th>
              <th className="px-3 py-2 font-medium">Servidor</th>
              <th className="px-3 py-2 font-medium">Início</th>
              <th className="px-3 py-2 font-medium">Duração</th>
              <th className="px-3 py-2 font-medium">Término</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-accent/30">
                <td className="px-3 py-2">{s.user?.name ?? <span className="text-subtle">usuário removido</span>}</td>
                <td className="px-3 py-2"><span className="font-medium">{s.connection_name}</span><span className="block font-mono text-[11px] text-muted-foreground">{s.username}@{s.host}</span></td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(s.started_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{duration(s.started_at, s.ended_at)}<span className="block text-[11px] text-subtle">{fmtBytes(s.bytes_out)}</span></td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={s.end_reason === "host_key_mismatch" || s.end_reason === "auth_failed" ? "text-destructive" : ""}>{ssh.endReasonLabel(s.end_reason)}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{s.ip ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {s.has_recording && (
                    <Button size="sm" variant="outline" onClick={() => setReplay(s)}><Video className="h-3.5 w-3.5" /> Reproduzir</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Mais recentes</Button>
        <span className="text-xs text-subtle">página {page}</span>
        <Button size="sm" variant="ghost" disabled={!data.has_next} onClick={() => setPage((p) => p + 1)}>Mais antigas →</Button>
      </div>
      <ReplayDialog projectId={projectId} session={replay} onClose={() => setReplay(null)} />
    </div>
  );
}

interface CastEvent { t: number; data: string }

function parseCast(text: string): { cols: number; rows: number; events: CastEvent[] } {
  const lines = text.split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]);
  const events: CastEvent[] = [];
  for (const l of lines.slice(1)) {
    try {
      const [t, kind, data] = JSON.parse(l);
      if (kind === "o" && typeof data === "string") events.push({ t, data });
    } catch { /* linha cortada no fim */ }
  }
  return { cols: header.width || 80, rows: header.height || 24, events };
}

const SPEEDS = [1, 2, 4, 0] as const; // 0 = instantâneo

function ReplayDialog({ projectId, session, onClose }: { projectId: number; session: ssh.SshSessionRow | null; onClose: () => void }) {
  return (
    <Dialog open={session !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Reprodução — {session?.connection_name} ({session ? fmtDate(session.started_at) : ""})</DialogTitle>
        </DialogHeader>
        {session && <Player projectId={projectId} session={session} />}
      </DialogContent>
    </Dialog>
  );
}

function Player({ projectId, session }: { projectId: number; session: ssh.SshSessionRow }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idx = useRef(0);
  const [cast, setCast] = useState<ReturnType<typeof parseCast> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [progress, setProgress] = useState(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    ssh.getRecording(projectId, session.id).then((t) => setCast(parseCast(t))).catch((e) => setError(ssh.errMsg(e)));
  }, [projectId, session.id]);

  useEffect(() => {
    if (!cast || !hostRef.current) return;
    const term = new Terminal({ cols: Math.min(cast.cols, 200), rows: Math.min(cast.rows, 60), fontSize: 12, fontFamily: '"Geist Mono", ui-monospace, Menlo, Consolas, monospace', theme: TERMINAL_THEME, disableStdin: true, scrollback: 5000 });
    term.open(hostRef.current);
    termRef.current = term;
    setPlaying(true);
    return () => { stop(); term.dispose(); termRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast]);

  const total = cast?.events.length ? cast.events[cast.events.length - 1].t : 0;

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  // Avança evento a evento respeitando os intervalos gravados (limitados a 1,5 s para não esperar pausas longas).
  useEffect(() => {
    stop();
    if (!playing || !cast || !termRef.current) return;
    const term = termRef.current;
    const step = () => {
      const events = cast.events;
      if (idx.current >= events.length) { setPlaying(false); setProgress(1); return; }
      if (speedRef.current === 0) {
        while (idx.current < events.length) term.write(events[idx.current++].data);
        setProgress(1);
        setPlaying(false);
        return;
      }
      const cur = events[idx.current];
      term.write(cur.data);
      idx.current++;
      setProgress(total ? cur.t / total : 1);
      const next = events[idx.current];
      if (!next) { setPlaying(false); return; }
      const wait = Math.min(1500, Math.max(0, (next.t - cur.t) * 1000)) / speedRef.current;
      timer.current = setTimeout(step, wait);
    };
    step();
    return stop;
  }, [playing, cast, total]);

  function restart() {
    stop();
    termRef.current?.reset();
    idx.current = 0;
    setProgress(0);
    setPlaying(true);
  }

  if (error) return <ErrorBox message={error} />;
  if (!cast) return <Loading label="Carregando gravação…" />;

  return (
    <div className="space-y-3">
      {session.recording_truncated && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">Gravação cortada: a sessão passou do limite de 10 MB e o final não foi guardado.</p>}
      <div className="overflow-hidden rounded-xl border bg-[#0B0B0D] p-2"><div ref={hostRef} data-testid="replay" className="max-h-[60vh] overflow-auto" /></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => setPlaying((p) => !p)} disabled={progress >= 1 && !playing && idx.current >= cast.events.length}>
          {playing ? <><Pause className="h-4 w-4" /> Pausar</> : <><Play className="h-4 w-4" /> Continuar</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={restart}><RotateCcw className="h-4 w-4" /> Do início</Button>
        <div className="inline-flex gap-1 rounded-[9px] border bg-surface p-[3px]" role="group" aria-label="Velocidade">
          {SPEEDS.map((s) => (
            <button key={s} type="button" onClick={() => setSpeed(s)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${speed === s ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {s === 0 ? "Pular" : `${s}x`}
            </button>
          ))}
        </div>
        <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <span className="text-xs text-subtle">{total.toFixed(0)}s gravados</span>
      </div>
    </div>
  );
}
