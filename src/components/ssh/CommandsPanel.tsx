import { useEffect, useState } from "react";
import { Pencil, Plus, ShieldQuestion, Trash2, Zap } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import * as ssh from "@/src/services/ssh.service";

export function CommandsPanel({ projectId, commands, onChanged }: { projectId: number; commands: ssh.SshCommand[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<ssh.SshCommand | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(c: ssh.SshCommand) {
    if (!confirm(`Excluir o comando "${c.name}"?`)) return;
    try {
      await ssh.deleteCommand(projectId, c.id);
      await onChanged();
    } catch (err) {
      setError(ssh.errMsg(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Comandos do projeto (deploy, reiniciar serviço, ver logs…) para rodar com um clique em qualquer terminal aberto. Os marcados com confirmação pedem um “ok” antes de executar.
        </p>
        <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Novo comando</Button>
      </div>
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {commands.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          <Zap className="mx-auto mb-3 h-8 w-8" />
          Nenhum comando salvo ainda.
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {commands.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.confirm && <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"><ShieldQuestion className="h-3 w-3" /> pede confirmação</span>}
                </div>
                {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded bg-[#0B0B0D] px-2.5 py-1.5 font-mono text-[11.5px] text-[#E7E7EA]">{c.command}</pre>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Editar ${c.name}`}><Pencil className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(c)} aria-label={`Excluir ${c.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </li>
          ))}
        </ul>
      )}

      <CommandDialog open={editing !== null} projectId={projectId} initial={editing && editing !== "new" ? editing : null} onClose={() => setEditing(null)} onSaved={onChanged} />
    </div>
  );
}

function CommandDialog({ open, projectId, initial, onClose, onSaved }: { open: boolean; projectId: number; initial: ssh.SshCommand | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");
  const [confirmRun, setConfirmRun] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(initial?.name ?? "");
    setCommand(initial?.command ?? "");
    setDescription(initial?.description ?? "");
    setConfirmRun(initial?.confirm ?? true);
  }, [open, initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), command, description: description.trim() || null, confirm: confirmRun };
      if (initial) await ssh.updateCommand(projectId, initial.id, payload);
      else await ssh.createCommand(projectId, payload);
      await onSaved();
      onClose();
    } catch (err) {
      setError(ssh.errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar comando" : "Novo comando"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cmd-name">Nome</Label>
            <Input id="cmd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deploy" required maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmd-command">Comando</Label>
            <textarea id="cmd-command" value={command} onChange={(e) => setCommand(e.target.value)} rows={4} spellCheck={false} required placeholder="cd /var/www/app && git pull && npm run build && pm2 restart app" className="w-full resize-y rounded-lg border border-input bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-primary" />
            <p className="text-[11px] text-subtle">Cada linha é digitada no terminal seguida de Enter.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmd-desc">Descrição (opcional)</Label>
            <Input id="cmd-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={confirmRun} onChange={(e) => setConfirmRun(e.target.checked)} /> Pedir confirmação antes de executar
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
