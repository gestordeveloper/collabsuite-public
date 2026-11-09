import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Copy, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import * as ig from "@/src/services/instagram.service";

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
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label={`Copiar ${label}`}
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Configuração do app do Meta — feita UMA vez para a plataforma toda. As contas dos clientes são
 * conectadas depois, projeto a projeto, com o login do Facebook de quem administra a Página.
 */
export function MetaConfigCard({ onChanged }: { onChanged: () => void }) {
  const [cfg, setCfg] = useState<ig.MetaConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (c: ig.MetaConfig) => {
    setCfg(c);
    setAppId(c.app_id);
    setUrl(c.public_url || window.location.origin);
    setSecret("");
  };

  useEffect(() => {
    ig.getConfig().then((c) => {
      apply(c);
      setOpen(!c.configured);
    }).catch(() => {});
  }, []);

  if (!cfg) return null;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      apply(await ig.saveConfig({ app_id: appId, app_secret: secret || undefined, public_url: url }));
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(ig.errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const localhost = /localhost|127\.0\.0\.1/.test(cfg.public_url || url);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-4 text-left">
        <Settings2 className="h-4 w-4 text-primary" />
        <span className="flex-1">
          <span className="block text-sm font-semibold">App do Meta (configuração única da plataforma)</span>
          <span className="block text-xs text-muted-foreground">
            {cfg.configured ? `Configurado${cfg.source === "env" ? " pelo .env" : ""} · App ${cfg.app_id}` : "Ainda não configurado — é o primeiro passo para conectar qualquer cliente"}
          </span>
        </span>
        {cfg.configured && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
            <li>Em <a className="text-primary underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a> crie um app do tipo <em>Empresa</em> e adicione os produtos <strong>Login do Facebook</strong> e <strong>Instagram</strong>.</li>
            <li>Em <em>Configurações → Básico</em> copie o <strong>ID do app</strong> e a <strong>Chave secreta</strong> e cole abaixo. <strong>É um app só</strong> — vale para todos os clientes.</li>
            <li>Em <em>Login do Facebook → Configurações</em>, cole a <strong>URI de redirecionamento OAuth</strong> abaixo.</li>
            <li>Em <em>Webhooks → Instagram</em>, cole a <strong>URL de callback</strong> e o <strong>Token de verificação</strong> abaixo e assine o campo <em>comments</em>.</li>
            <li>Depois, na lista abaixo, clique em <strong>Conectar</strong> em cada projeto e entre com o Facebook de quem administra a Página daquele cliente.</li>
          </ol>

          {cfg.can_edit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>ID do app (App ID)</Label>
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="1234567890123456" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label>Chave secreta (App Secret)</Label>
                <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={cfg.has_secret ? "•••••••• (salva — deixe vazio para manter)" : "cole a chave secreta"} autoComplete="off" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Endereço público da plataforma</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.suaempresa.com" />
                {localhost && <p className="text-xs text-amber-500">Em localhost dá para conectar contas, mas o Instagram não consegue entregar comentários (webhook) nem baixar as imagens para publicar. Para isso use um endereço público HTTPS.</p>}
              </div>
              {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive sm:col-span-2">{error}</p>}
              <div className="sm:col-span-2">
                <Button onClick={save} disabled={saving || !appId.trim() || (!secret.trim() && !cfg.has_secret)}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar configuração
                </Button>
              </div>
            </div>
          ) : (
            !cfg.configured && <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">Peça a um administrador da plataforma para informar o App ID e o App Secret aqui. Depois disso você já conecta as contas dos clientes.</p>
          )}

          {cfg.configured && (
            <div className="grid gap-3 sm:grid-cols-2">
              <CopyField label="URI de redirecionamento OAuth (Login do Facebook)" value={cfg.callback_url} />
              <CopyField label="URL de callback do webhook (Instagram)" value={cfg.webhook_url} />
              <CopyField label="Token de verificação do webhook" value={cfg.verify_token} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Enquanto o app estiver em modo de desenvolvimento, quem conecta uma conta precisa ser administrador/testador do app (Funções do app). Para clientes externos, publique o app no modo ao vivo.</p>
        </div>
      )}
    </div>
  );
}
