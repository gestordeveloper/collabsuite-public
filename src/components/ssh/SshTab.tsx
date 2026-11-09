import { useCallback, useRef, useState } from "react";
import { ChevronDown, History, Server, TerminalSquare, X, Zap } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import * as ssh from "@/src/services/ssh.service";
import { ErrorBox, Loading, useLoad } from "@/src/components/github/common";
import { CommandsPanel } from "./CommandsPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { SessionsPanel } from "./SessionsPanel";
import { TerminalView, type TerminalApi } from "./TerminalView";

type Section = "servers" | "commands" | "sessions" | `term-${number}`;
interface OpenTerm { uid: number; conn: ssh.SshConnection; status: ssh.TermStatus }

const DOT: Record<string, string> = { connecting: "bg-warning animate-pulse", connected: "bg-success", closed: "bg-muted-foreground", error: "bg-destructive" };

export function SshTab({ projectId }: { projectId: number }) {
  const [section, setSection] = useState<Section>("servers");
  const [terms, setTerms] = useState<OpenTerm[]>([]);
  const [menu, setMenu] = useState(false);
  const apis = useRef(new Map<number, TerminalApi>());
  const seq = useRef(0);
  const conns = useLoad(() => ssh.listConnections(projectId), [projectId]);
  const cmds = useLoad(() => ssh.listCommands(projectId), [projectId]);

  const open = useCallback((conn: ssh.SshConnection) => {
    const uid = ++seq.current;
    setTerms((t) => [...t, { uid, conn, status: { state: "connecting" } }]);
    setSection(`term-${uid}`);
  }, []);

  const close = (uid: number) => {
    const t = terms.find((x) => x.uid === uid);
    if (t?.status.state === "connected" && !confirm(`Encerrar a sessão em "${t.conn.name}"?`)) return;
    apis.current.delete(uid);
    setTerms((all) => all.filter((x) => x.uid !== uid));
    setSection((s) => (s === `term-${uid}` ? "servers" : s));
  };

  const setStatus = useCallback((uid: number, status: ssh.TermStatus) => setTerms((all) => all.map((t) => (t.uid === uid ? { ...t, status } : t))), []);

  function run(uid: number, c: ssh.SshCommand, conn: ssh.SshConnection) {
    setMenu(false);
    if (c.confirm && !confirm(`Executar em "${conn.name}" (${conn.username}@${conn.host})?\n\n${c.command}`)) return;
    apis.current.get(uid)?.send(c.command.replace(/\n/g, "\r") + "\r");
    apis.current.get(uid)?.focus();
  }

  const refresh = async () => { await Promise.all([conns.reload(), cmds.reload()]); };
  const activeTerm = terms.find((t) => section === `term-${t.uid}`);

  const NavButton = ({ id, icon, label }: { id: Section; icon: React.ReactNode; label: string }) => (
    <button
      type="button"
      role="tab"
      aria-selected={section === id}
      onClick={() => setSection(id)}
      className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors", section === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      <span className={section === id ? "text-primary" : "text-subtle"}>{icon}</span> {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-1 overflow-x-auto border-b" role="tablist">
        <NavButton id="servers" icon={<Server className="h-4 w-4" />} label="Servidores" />
        <NavButton id="commands" icon={<Zap className="h-4 w-4" />} label="Comandos" />
        <NavButton id="sessions" icon={<History className="h-4 w-4" />} label="Sessões" />
        {terms.length > 0 && <span className="mx-1 mb-2 h-5 w-px shrink-0 bg-border" />}
        {terms.map((t) => (
          <div key={t.uid} className={cn("flex shrink-0 items-center border-b-2", section === `term-${t.uid}` ? "border-primary" : "border-transparent")}>
            <button type="button" role="tab" aria-selected={section === `term-${t.uid}`} onClick={() => setSection(`term-${t.uid}`)} className="flex items-center gap-2 py-2 pl-3 pr-1 text-[13px] font-medium">
              <span className={cn("h-2 w-2 rounded-full", DOT[t.status.state])} aria-hidden />
              <TerminalSquare className="h-4 w-4 text-subtle" /> {t.conn.name}
            </button>
            <button type="button" onClick={() => close(t.uid)} aria-label={`Fechar terminal ${t.conn.name}`} className="mr-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>

      {section === "servers" && (conns.error ? <ErrorBox message={conns.error} onRetry={conns.reload} /> : conns.loading && !conns.data ? <Loading /> : <ConnectionsPanel projectId={projectId} connections={conns.data ?? []} onChanged={conns.reload} onOpenTerminal={open} />)}
      {section === "commands" && (cmds.error ? <ErrorBox message={cmds.error} onRetry={cmds.reload} /> : cmds.loading && !cmds.data ? <Loading /> : <CommandsPanel projectId={projectId} commands={cmds.data ?? []} onChanged={cmds.reload} />)}
      {section === "sessions" && <SessionsPanel projectId={projectId} />}

      {/* Os terminais ficam montados (só escondidos) para a sessão não cair ao trocar de aba. */}
      {terms.map((t) => {
        const visible = section === `term-${t.uid}`;
        return (
          <div key={t.uid} className={visible ? "block" : "hidden"}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-mono text-xs text-muted-foreground">{t.conn.username}@{t.conn.host}:{t.conn.port}</span>
              {t.status.state === "connected" && t.status.recording && <span className="rounded-full border px-2 py-0.5 text-[11px] text-subtle">● gravando</span>}
              <div className="relative ml-auto">
                <Button size="sm" variant="outline" onClick={() => setMenu((m) => !m)} disabled={t.status.state !== "connected"} aria-haspopup="menu" aria-expanded={menu && visible}>
                  <Zap className="h-4 w-4" /> Comandos salvos <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                {menu && visible && (
                  <div className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg" role="menu">
                    {(cmds.data ?? []).length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum comando salvo. Crie na aba Comandos.</p>
                    ) : (
                      (cmds.data ?? []).map((c) => (
                        <button key={c.id} type="button" role="menuitem" onClick={() => run(t.uid, c, t.conn)} className="block w-full rounded-md px-3 py-2 text-left hover:bg-accent">
                          <span className="block text-[13px] font-medium">{c.name}</span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">{c.command.split("\n")[0]}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="h-[calc(100vh-360px)] min-h-[420px]">
              <TerminalView connection={t.conn} visible={visible} onStatus={(s) => setStatus(t.uid, s)} onReady={(api) => apis.current.set(t.uid, api)} />
            </div>
          </div>
        );
      })}
      {activeTerm && null}
    </div>
  );
}
