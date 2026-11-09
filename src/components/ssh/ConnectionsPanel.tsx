import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileKey2, KeyRound, Loader2, Pencil, Plus, ShieldAlert, ShieldCheck, TerminalSquare, Trash2, Zap } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { cn } from "@/src/lib/utils";
import * as ssh from "@/src/services/ssh.service";
import { timeAgo } from "@/src/components/github/common";

export function ConnectionsPanel({ projectId, connections, onChanged, onOpenTerminal }: {
  projectId: number;
  connections: ssh.SshConnection[];
  onChanged: () => Promise<void>;
  onOpenTerminal: (c: ssh.SshConnection) => void;
}) {
  const [editing, setEditing] = useState<ssh.SshConnection | "new" | null>(null);
  const [results, setResults] = useState<Record<number, ssh.SshTestResult>>({});
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  const mark = (id: number, what: string | null) => setBusy((b) => { const n = { ...b }; if (what) n[id] = what; else delete n[id]; return n; });

  async function test(c: ssh.SshConnection) {
    mark(c.id, "test");
    setErrors((e) => ({ ...e, [c.id]: "" }));
    try {
      setResults((r) => { const n = { ...r }; delete n[c.id]; return n; }); // limpa o resultado antigo antes de testar
      const res = await ssh.testConnection(projectId, c.id);
      setResults((r) => ({ ...r, [c.id]: res }));
    } catch (err) {
      setErrors((e) => ({ ...e, [c.id]: ssh.errMsg(err) }));
    } finally {
      mark(c.id, null);
    }
  }

  async function trust(c: ssh.SshConnection, fingerprint: string) {
    mark(c.id, "trust");
    try {
      await ssh.trustFingerprint(projectId, c.id, fingerprint);
      setResults((r) => { const n = { ...r }; delete n[c.id]; return n; });
      await onChanged();
    } catch (err) {
      setErrors((e) => ({ ...e, [c.id]: ssh.errMsg(err) }));
    } finally {
      mark(c.id, null);
    }
  }

  async function resetTrust(c: ssh.SshConnection) {
    if (!confirm("Remover a confirmação deste servidor? Use só se ele foi reinstalado de propósito; você precisará testar e confirmar a impressão digital de novo.")) return;
    mark(c.id, "reset");
    try {
      await ssh.updateConnection(projectId, c.id, { reset_fingerprint: true });
      setResults((r) => { const n = { ...r }; delete n[c.id]; return n; });
      await onChanged();
    } catch (err) {
      setErrors((e) => ({ ...e, [c.id]: ssh.errMsg(err) }));
    } finally {
      mark(c.id, null);
    }
  }

  async function remove(c: ssh.SshConnection) {
    if (!confirm(`Excluir o acesso "${c.name}"? O histórico de sessões é mantido.`)) return;
    try {
      await ssh.deleteConnection(projectId, c.id);
      await onChanged();
    } catch (err) {
      setErrors((e) => ({ ...e, [c.id]: ssh.errMsg(err) }));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Acessos SSH deste projeto. As credenciais ficam criptografadas e nunca voltam para o navegador; antes do primeiro uso você confirma a impressão digital do servidor.
        </p>
        <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Novo acesso</Button>
      </div>

      {connections.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          <TerminalSquare className="mx-auto mb-3 h-8 w-8" />
          Nenhum acesso SSH cadastrado. Adicione o primeiro servidor deste projeto.
        </div>
      ) : (
        <ul className="space-y-3">
          {connections.map((c) => {
            const res = results[c.id];
            const trusted = !!c.host_fingerprint;
            return (
              <li key={c.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[15px] font-semibold">{c.name}</span>
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {c.auth_type === "key" ? <><FileKey2 className="h-3 w-3" /> chave</> : <><KeyRound className="h-3 w-3" /> senha</>}
                      </span>
                      {trusted ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success"><ShieldCheck className="h-3 w-3" /> Servidor confirmado</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning"><ShieldAlert className="h-3 w-3" /> Servidor não confirmado</span>
                      )}
                      {!c.record_sessions && <span className="rounded-full border px-2 py-0.5 text-[11px] text-subtle">sem gravação</span>}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{c.username}@{c.host}:{c.port}</p>
                    <p className="mt-0.5 text-[11px] text-subtle">{c.last_used_at ? `último uso ${timeAgo(c.last_used_at)}` : "nunca usado"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {trusted ? (
                      <Button size="sm" onClick={() => onOpenTerminal(c)}><TerminalSquare className="h-4 w-4" /> Abrir terminal</Button>
                    ) : (
                      <Button size="sm" onClick={() => test(c)} disabled={!!busy[c.id]}>
                        {busy[c.id] === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Testar e confirmar servidor
                      </Button>
                    )}
                    {trusted && (
                      <Button size="sm" variant="outline" onClick={() => test(c)} disabled={!!busy[c.id]}>
                        {busy[c.id] === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Testar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Editar ${c.name}`}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)} aria-label={`Excluir ${c.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>

                {errors[c.id] && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errors[c.id]}</p>}

                {res && (
                  <div className={cn("mt-3 rounded-lg border px-3 py-3 text-sm", res.ok ? (res.matches === false ? "border-destructive/40 bg-destructive/10" : "border-success/30 bg-success/10") : "border-destructive/30 bg-destructive/10")} role="status">
                    {!res.ok ? (
                      <p className="flex items-start gap-2 text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {res.message}</p>
                    ) : res.matches === false ? (
                      <div className="space-y-2">
                        <p className="flex items-start gap-2 font-medium text-destructive"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> ATENÇÃO: a impressão digital do servidor é DIFERENTE da que foi confirmada. Não use este acesso até descobrir o motivo (servidor reinstalado ou possível interceptação).</p>
                        <p className="font-mono text-xs">esperada: {c.host_fingerprint}</p>
                        <p className="font-mono text-xs">recebida: {res.fingerprint}</p>
                        <Button size="sm" variant="outline" onClick={() => resetTrust(c)}>Foi reinstalado: reconfirmar servidor</Button>
                      </div>
                    ) : res.pinned ? (
                      <p className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /> Conexão OK e a impressão digital confere com a confirmada.</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="flex items-start gap-2 text-success">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>Autenticação OK. Confira se a impressão digital abaixo é a do seu servidor (no servidor: <code className="rounded bg-background px-1 py-0.5 text-xs">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>).</span>
                        </p>
                        <p className="break-all rounded bg-background px-2 py-1.5 font-mono text-xs">{res.fingerprint}</p>
                        <Button size="sm" disabled={busy[c.id] === "trust"} onClick={() => trust(c, res.fingerprint!)}>
                          <ShieldCheck className="h-4 w-4" /> {busy[c.id] === "trust" ? "Confirmando…" : "Confiar neste servidor"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConnectionDialog open={editing !== null} projectId={projectId} initial={editing && editing !== "new" ? editing : null} onClose={() => setEditing(null)} onSaved={onChanged} />
    </div>
  );
}

function ConnectionDialog({ open, projectId, initial, onClose, onSaved }: { open: boolean; projectId: number; initial: ssh.SshConnection | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<"key" | "password">("key");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [record, setRecord] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(initial?.name ?? "");
    setHost(initial?.host ?? "");
    setPort(String(initial?.port ?? 22));
    setUsername(initial?.username ?? "");
    setAuthType(initial?.auth_type ?? "key");
    setSecret("");
    setPassphrase("");
    setRecord(initial?.record_sessions ?? true);
  }, [open, initial]);

  function loadKeyFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 20_000) return setError("Esse arquivo é grande demais para ser uma chave SSH.");
    const reader = new FileReader();
    reader.onload = () => setSecret(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = Number(port);
    setSaving(true);
    setError(null);
    try {
      const payload: ssh.SshConnectionInput = {
        name: name.trim(), host: host.trim(), port: p, username: username.trim(), auth_type: authType, record_sessions: record,
        ...(secret.trim() ? { secret } : {}),
        ...(authType === "key" && (secret.trim() || passphrase) ? { passphrase: passphrase || null } : {}),
      };
      if (initial) await ssh.updateConnection(projectId, initial.id, payload);
      else await ssh.createConnection(projectId, payload);
      await onSaved();
      onClose();
    } catch (err) {
      setError(ssh.errMsg(err, "Não foi possível salvar o acesso."));
    } finally {
      setSaving(false);
    }
  }

  const editingKeepsSecret = !!initial && initial.auth_type === authType;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar acesso SSH" : "Novo acesso SSH"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ssh-name">Nome</Label>
            <Input id="ssh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Produção" required maxLength={120} />
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="ssh-host">Servidor (host ou IP)</Label>
              <Input id="ssh-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="app.suaempresa.com" required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssh-port">Porta</Label>
              <Input id="ssh-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ssh-user">Usuário</Label>
            <Input id="ssh-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="deploy" required autoComplete="off" />
          </div>

          <div className="space-y-1.5">
            <Label>Autenticação</Label>
            <div className="inline-flex gap-1 rounded-[9px] border bg-surface p-[3px]">
              {([["key", "Chave privada"], ["password", "Senha"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setAuthType(k)} className={cn("rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors", authType === k ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
              ))}
            </div>
          </div>

          {authType === "key" ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ssh-key">Chave privada</Label>
                  <label className="cursor-pointer text-xs text-primary hover:underline">
                    carregar arquivo
                    <input type="file" className="hidden" onChange={(e) => { loadKeyFile(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
                <textarea
                  id="ssh-key"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={editingKeepsSecret ? "•••••• (chave mantida — cole outra só para trocar)" : "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
                  className="w-full resize-y rounded-lg border border-input bg-surface px-3 py-2 font-mono text-[11px] leading-snug outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ssh-pass">Senha da chave (passphrase, se tiver)</Label>
                <Input id="ssh-pass" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" placeholder={initial?.has_passphrase && !secret ? "•••••• (mantida)" : ""} />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="ssh-pw">Senha</Label>
              <Input id="ssh-pw" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" placeholder={editingKeepsSecret ? "•••••• (mantida)" : ""} />
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-surface p-3 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={record} onChange={(e) => setRecord(e.target.checked)} />
            <span>
              Gravar as sessões deste acesso
              <span className="block text-xs text-subtle">Guarda só o que aparece na tela (nunca o que você digita), para revisão por quem administra o projeto. Se o terminal mostrar segredos, eles ficam na gravação.</span>
            </span>
          </label>

          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
