import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Copy, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import * as social from "@/src/services/social.service";

function CopyField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="space-y-1 sm:col-span-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-1.5">
        <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2"
          onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          aria-label={`Copiar ${label}`}
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

const COPY: Record<social.Platform, { title: string; idLabel: string; secretLabel: string; idHint: string; steps: ReactNode }> = {
  youtube: {
    title: "App do Google / YouTube (configuração única da plataforma)",
    idLabel: "ID do cliente OAuth",
    secretLabel: "Chave secreta do cliente",
    idHint: "123456789-abc...apps.googleusercontent.com",
    steps: (
      <>
        <li>Em <a className="text-primary underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">console.cloud.google.com</a> crie um projeto e, em <em>APIs e serviços → Biblioteca</em>, ative a <strong>YouTube Data API v3</strong>.</li>
        <li>Em <em>Tela de permissão OAuth</em>: tipo <strong>Externo</strong>, preencha o nome do app e seu e-mail, adicione os escopos <code>youtube.upload</code> e <code>youtube.readonly</code>. Depois clique em <strong>Publicar app</strong> (em modo "Teste" a conexão expira a cada 7 dias).</li>
        <li>Em <em>Credenciais → Criar credenciais → ID do cliente OAuth</em>, tipo <strong>Aplicativo da Web</strong>, e cole a <strong>URI de redirecionamento</strong> abaixo em "URIs de redirecionamento autorizados".</li>
        <li>Copie o <strong>ID do cliente</strong> e a <strong>Chave secreta</strong> e cole aqui.</li>
        <li>Vídeos enviados por um app Google não verificado ficam <strong>privados</strong> até passar pela auditoria de API do YouTube (formulário de conformidade).</li>
      </>
    ),
  },
  tiktok: {
    title: "App do TikTok (configuração única da plataforma)",
    idLabel: "Client Key",
    secretLabel: "Client Secret",
    idHint: "awxxxxxxxxxxxxxxxx",
    steps: (
      <>
        <li>Em <a className="text-primary underline" href="https://developers.tiktok.com/apps/" target="_blank" rel="noreferrer">developers.tiktok.com/apps</a> crie um app (<em>Connect an app</em>) e preencha nome, ícone e categoria.</li>
        <li>Em <em>Add products</em> adicione <strong>Login Kit</strong> e <strong>Content Posting API</strong> (marque <em>Direct Post</em>). Escopos: <code>user.info.basic</code>, <code>video.publish</code>, <code>video.upload</code>.</li>
        <li>No Login Kit, cadastre a <strong>URI de redirecionamento</strong> abaixo (precisa ser HTTPS público).</li>
        <li>Copie a <strong>Client Key</strong> e o <strong>Client Secret</strong> (Credentials) e cole aqui.</li>
        <li>Enquanto o app não passar na auditoria do TikTok, ele só consegue postar de forma <strong>privada</strong> ("Só eu") ou enviar para o <strong>rascunho</strong>. Quem conecta precisa estar em <em>Sandbox → Target users</em> se o app estiver em modo sandbox.</li>
      </>
    ),
  },
};

/** Configuração do app de UMA rede (YouTube ou TikTok) — feita uma vez para a plataforma toda. */
export function SocialConfigCard({ platform, config, onChanged }: { platform: social.Platform; config: social.SocialConfig; onChanged: () => void }) {
  const copy = COPY[platform];
  const [open, setOpen] = useState(!config.configured);
  const [clientId, setClientId] = useState(config.client_id);
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState(config.public_url || window.location.origin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setClientId(config.client_id);
    setUrl(config.public_url || window.location.origin);
  }, [config.client_id, config.public_url]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await social.saveConfig(platform, { client_id: clientId, client_secret: secret || undefined, public_url: url });
      setSecret("");
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const localhost = /localhost|127\.0\.0\.1/.test(config.public_url || url);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-4 text-left">
        <Settings2 className="h-4 w-4 text-primary" />
        <span className="flex-1">
          <span className="block text-sm font-semibold">{copy.title}</span>
          <span className="block text-xs text-muted-foreground">
            {config.configured ? `Configurado${config.source === "env" ? " pelo .env" : ""}` : "Ainda não configurado — é o primeiro passo para conectar qualquer cliente"}
          </span>
        </span>
        {config.configured && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">{copy.steps}</ol>

          {config.can_edit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{copy.idLabel}</Label>
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={copy.idHint} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label>{copy.secretLabel}</Label>
                <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={config.has_secret ? "•••••••• (salva — deixe vazio para manter)" : "cole a chave secreta"} autoComplete="off" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Endereço público da plataforma</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.suaempresa.com" />
                {localhost && (
                  <p className="text-xs text-amber-500">
                    {platform === "tiktok" ? "O TikTok só aceita redirecionamento HTTPS público — em localhost não dá para conectar." : "Em localhost a conexão funciona (o Google aceita http://localhost), mas use o mesmo endereço que você abre no navegador."}
                  </p>
                )}
              </div>
              {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive sm:col-span-2">{error}</p>}
              <div className="sm:col-span-2">
                <Button onClick={save} disabled={saving || !clientId.trim() || (!secret.trim() && !config.has_secret)}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar configuração
                </Button>
              </div>
            </div>
          ) : (
            !config.configured && <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">Peça a um administrador da plataforma para informar as credenciais aqui. Depois disso você já conecta as contas dos clientes.</p>
          )}

          {config.redirect_uri && (
            <div className="grid gap-3 sm:grid-cols-2">
              <CopyField label="URI de redirecionamento OAuth (cole no painel da rede)" value={config.redirect_uri} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
