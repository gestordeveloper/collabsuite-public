import { useEffect, useState } from "react";
import { Terminal, Trash2, Loader2, Play, Plus, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Badge } from "@/src/components/ui/badge";
import { useAuthStore } from "@/src/store/auth.store";
import * as svc from "@/src/services/local-cli.service";
import type { CliPreset, LocalCli } from "@/src/services/local-cli.service";

const errMsg = (e: any) => e?.response?.data?.error || e?.message || "Erro inesperado.";

export function LocalCliSettings() {
  return (
    <div className="space-y-6">
      <AgentSection />
      <ServerClis />
    </div>
  );
}

/** CLIs do próprio computador do usuário, via agente local (funciona com a CollabSuite hospedada em servidor). */
function AgentSection() {
  const [status, setStatus] = useState<svc.CliAgentStatus | null>(null);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => svc.getCliAgentStatus().then(setStatus).catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="space-y-3 pt-2">
      <div className="flex items-start gap-3 rounded-xl border p-4 bg-muted/10">
        <Terminal className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Agente de CLIs (seu computador)</p>
          <p className="text-sm text-muted-foreground">
            Use os CLIs de IA instalados no <b>seu PC</b> (Claude Code, Codex, Gemini, Qwen…) com o seu próprio login, sem chave de API.
            O agente conecta o seu computador a esta CollabSuite; os CLIs aparecem como opção de IA nas mini novelas e nos carrosséis.
            Ele só recebe pedidos de texto e roda o CLI numa pasta temporária vazia: <b>não lê nem altera os seus projetos</b>.
          </p>
        </div>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Precisa do <b>Node.js</b> no seu PC. <a href="/cli-agent.zip" download className="text-primary hover:underline">Baixe o agente (ZIP)</a> e extraia numa pasta.</li>
        <li>Gere o código de conexão abaixo.</li>
        <li>Dê dois cliques em <code className="font-mono">iniciar.bat</code>, informe o endereço <code className="font-mono">{window.location.origin}</code> e o código. Deixe a janela aberta enquanto usa.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={async () => { try { setToken(await svc.createCliAgentToken()); setCopied(false); setError(null); } catch (e) { setError(errMsg(e)); } }}>Gerar código de conexão</Button>
        {status && (
          <Badge variant={status.connected ? "default" : "outline"}>{status.connected ? "agente conectado" : "agente desconectado"}</Badge>
        )}
      </div>
      {status?.connected && (
        <p className="text-xs text-muted-foreground">
          {status.clis.length ? <>CLIs detectados: <b>{status.clis.map((c) => c.name).join(", ")}</b></> : "O agente está conectado, mas não achou nenhum CLI instalado (claude, codex, gemini, qwen). Veja o config.json do agente."}
        </p>
      )}
      {token && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input readOnly value={token} className="font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(token); setCopied(true); }}>{copied ? "Copiado" : "Copiar"}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Vale por 180 dias e dá acesso à sua conta: não compartilhe.</p>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/** CLIs instalados no servidor onde a CollabSuite roda (útil no dev local ou num servidor com os CLIs). */
function ServerClis() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [clis, setClis] = useState<LocalCli[] | null>(null);
  const [presets, setPresets] = useState<CliPreset[]>([]);
  const [detected, setDetected] = useState<CliPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [adding, setAdding] = useState<CliPreset | null>(null);

  async function load() {
    try {
      setClis(await svc.listLocalClis());
      if (isAdmin) {
        const p = await svc.getCliPresets();
        setPresets(p.presets);
        setDetected(p.detected);
      }
      setError(null);
    } catch (e) { setError(errMsg(e)); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function test(cli: LocalCli) {
    setTesting(cli.id);
    try {
      const r = await svc.testLocalCli(cli.id, cli.models[0]);
      setResults((x) => ({ ...x, [cli.id]: { ok: true, text: `Respondeu em ${(r.ms / 1000).toFixed(1)}s: "${r.reply.slice(0, 80)}"` } }));
    } catch (e) {
      setResults((x) => ({ ...x, [cli.id]: { ok: false, text: errMsg(e) } }));
    } finally { setTesting(null); }
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-start gap-3 rounded-xl border p-4 bg-muted/10">
        <Terminal className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          CLIs de IA instalados <b>na máquina onde o servidor roda</b> (diferente do agente acima) (Claude Code, Codex, Gemini CLI…) aparecem como opção de IA nas mini novelas
          e nos carrosséis, usando o login do próprio CLI, sem chave de API. Só funciona onde o CLI está instalado e autenticado (em produção no Docker, normalmente não está).
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {clis?.map((cli) => (
        <Card key={cli.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {cli.name}
              <Badge variant={cli.installed ? "default" : "destructive"}>{cli.installed ? "instalado" : "não encontrado"}</Badge>
              {!cli.is_active && <Badge variant="outline">desativado</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-mono text-xs text-muted-foreground break-all">{cli.command} {cli.args}</p>
            {cli.models.length > 0 && <p className="text-xs text-muted-foreground">Modelos: {cli.models.join(", ")}</p>}
            {results[cli.id] && (
              <p className={`flex items-start gap-1.5 text-xs ${results[cli.id].ok ? "text-emerald-400" : "text-destructive"}`}>
                {results[cli.id].ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                <span className="break-words">{results[cli.id].text}</span>
              </p>
            )}
            {isAdmin && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={testing !== null} onClick={() => test(cli)}>
                  {testing === cli.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Testar
                </Button>
                <Button size="sm" variant="outline" onClick={async () => { await svc.updateLocalCli(cli.id, { is_active: !cli.is_active }); await load(); }}>
                  {cli.is_active ? "Desativar" : "Ativar"}
                </Button>
                <Button size="sm" variant="ghost" className="hover:text-destructive" aria-label="Remover CLI"
                  onClick={async () => { if (window.confirm(`Remover o CLI "${cli.name}"?`)) { await svc.deleteLocalCli(cli.id); await load(); } }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {clis && !clis.length && <p className="text-sm text-muted-foreground">Nenhum CLI cadastrado ainda.</p>}

      {isAdmin && !adding && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Adicionar CLI</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const found = detected.find((d) => d.preset === p.preset)?.path;
              return (
                <Button key={p.preset} size="sm" variant="outline" onClick={() => setAdding(p)}>
                  <Plus className="h-3.5 w-3.5" /> {p.label}{p.command ? (found ? " ✓" : " (não detectado)") : ""}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {isAdmin && adding && <CliForm preset={adding} onCancel={() => setAdding(null)} onSaved={async () => { setAdding(null); await load(); }} />}
      {!isAdmin && <p className="text-xs text-muted-foreground">Somente administradores cadastram CLIs.</p>}
    </div>
  );
}

function CliForm({ preset, onCancel, onSaved }: { preset: CliPreset; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(preset.preset === "custom" ? "" : preset.label);
  const [command, setCommand] = useState(preset.command);
  const [args, setArgs] = useState(preset.args);
  const [mode, setMode] = useState<"stdin" | "arg">(preset.prompt_mode);
  const [models, setModels] = useState(preset.models);
  const [timeout, setTimeoutSec] = useState(300);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      await svc.createLocalCli({ name, preset: preset.preset, command, args, prompt_mode: mode, models, timeout_sec: timeout, is_active: true });
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Novo CLI: {preset.label}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como aparece no seletor" /></div>
          <div className="space-y-1"><Label>Comando</Label><Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="claude ou C:\caminho\cli.exe" /></div>
        </div>
        <div className="space-y-1">
          <Label>Argumentos</Label>
          <Input className="font-mono text-xs" value={args} onChange={(e) => setArgs(e.target.value)} />
          <p className="text-xs text-muted-foreground">Use <code>{"{model}"}</code> onde vai o modelo (some sozinho se nenhum for escolhido) e <code>{"{outfile}"}</code> se o CLI grava a resposta em arquivo.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label>Modelos (separados por vírgula)</Label><Input value={models} onChange={(e) => setModels(e.target.value)} placeholder="opcional" /></div>
          <div className="space-y-1"><Label>Prompt enviado por</Label>
            <select value={mode} onChange={(e) => setMode(e.target.value as "stdin" | "arg")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="stdin">stdin (entrada padrão)</option><option value="arg">último argumento</option>
            </select></div>
          <div className="space-y-1"><Label>Tempo limite (s)</Label><Input type="number" min={10} max={1800} value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value))} /></div>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-2">
          <Button disabled={saving || !name.trim() || !command.trim()} onClick={save}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        </div>
      </CardContent>
    </Card>
  );
}
