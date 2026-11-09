import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Copy, Settings2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import * as gh from "@/src/services/github.service";

function CopyField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-1.5">
        <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2"
          aria-label={`Copiar ${label}`}
          onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Configuração do OAuth App do GitHub — feita UMA vez para a plataforma toda por um administrador.
 * Depois cada pessoa conecta a própria conta com um clique.
 */
export function GithubConfigCard({ onChanged }: { onChanged: () => void }) {
  const [cfg, setCfg] = useState<gh.GithubConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (c: gh.GithubConfig) => {
    setCfg(c);
    setClientId(c.client_id);
    setUrl(c.public_url || window.location.origin);
    setSecret("");
  };

  useEffect(() => {
    gh.getConfig().then((c) => { apply(c); setOpen(!c.configured); }).catch((e) => setError(gh.errMsg(e)));
  }, []);

  if (!cfg) return error ? <p className="text-sm text-destructive">{error}</p> : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      apply(await gh.saveConfig({ client_id: clientId, client_secret: secret || undefined, public_url: url }));
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(gh.errMsg(err, "Não foi possível salvar."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={open}>
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">Configuração do app do GitHub</span>
        <span className={cn("text-xs", cfg.configured ? "text-success" : "text-warning")}>{cfg.configured ? "Configurado" : "Pendente"}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <form onSubmit={save} className="space-y-3 border-t px-4 py-4">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>No GitHub: <b>Settings → Developer settings → OAuth Apps → New OAuth App</b>.</li>
            <li>Em <b>Authorization callback URL</b>, cole o endereço de retorno abaixo.</li>
            <li>Gere um <b>Client secret</b> e informe o Client ID e o secret aqui.</li>
          </ol>
          <p className="rounded-lg border bg-surface px-3 py-2 text-xs text-muted-foreground">
            <b>OAuth App</b> (Client ID tipo <code>Ov23…</code>): o token não expira — é o mais simples e libera tudo (criar repositório, PRs, Actions).{" "}
            <b>GitHub App</b> (Client ID tipo <code>Iv1.…</code>/<code>Iv23…</code>): o token vence em ~8 h, mas a CollabSuite o renova sozinha; dê ao app as permissões de Contents, Pull requests, Issues, Actions e Workflows (leitura e escrita) e instale-o nos repositórios.
          </p>
          <CopyField label="Authorization callback URL" value={cfg.callback_url ?? `${url.replace(/\/+$/, "")}/api/github/oauth/callback`} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gh-client-id">Client ID</Label>
              <Input id="gh-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Ov23liAbCdEf123456" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gh-client-secret">Client secret</Label>
              <Input
                id="gh-client-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={cfg.has_secret ? "•••••••• (mantido)" : "Cole o secret"}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gh-public-url">Endereço público do app</Label>
            <Input id="gh-public-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.suaempresa.com" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            {cfg.configured && <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>}
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
