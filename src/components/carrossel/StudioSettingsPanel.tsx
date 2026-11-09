import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import * as service from "@/src/services/carrossel.service";
import * as comicService from "@/src/services/comic.service";
import type { BrandbookSummary, ImageTextStyle, ImageTextStyleOverview, PromptKind } from "@/src/services/carrossel.service";

const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none";
const labelCls = "mb-1 block text-xs text-muted-foreground";

/** Prompts editáveis (escrita do carrossel e foto da pessoa) e estilo do modelo Imagem e Texto. */
export function StudioSettingsPanel({ brandbooks }: { brandbooks: BrandbookSummary[] }) {
  return (
    <div className="space-y-8">
      <PromptsEditor brandbooks={brandbooks} />
      <ImageTextStyleEditor brandbooks={brandbooks} />
      <FlowExtensionSettings />
      <ElevenLabsSettings />
    </div>
  );
}

// ─── Prompts ───────────────────────────────────────────────────────────────────

function PromptsEditor({ brandbooks }: { brandbooks: BrandbookSummary[] }) {
  const [kinds, setKinds] = useState<Record<string, PromptKind> | null>(null);
  const [kind, setKind] = useState("native");
  const [scope, setScope] = useState("global");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => setKinds(await service.listPrompts()), []);
  useEffect(() => { void load().catch((e) => setMsg({ ok: false, text: service.errorMessage(e) })); }, [load]);

  const current = kinds?.[kind];
  const stored = current ? (scope === "global" ? current.global : current.brandbooks[scope]) : null;
  useEffect(() => { if (current) setText(stored ?? current.default); }, [kind, scope, kinds]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (value: string | null) => {
    setSaving(true);
    setMsg(null);
    try {
      const warnings = await service.savePrompt(kind, scope, value);
      await load();
      setMsg({ ok: true, text: value ? `Prompt salvo. ${warnings.join(" ")}` : "Voltou ao padrão." });
    } catch (e) {
      setMsg({ ok: false, text: service.errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const insert = (name: string) => {
    const el = area.current;
    const token = `{{${name}}}`;
    if (!el) { setText((t) => t + token); return; }
    const { selectionStart: a, selectionEnd: b } = el;
    setText(text.slice(0, a) + token + text.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };

  if (!kinds || !current) return <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-base font-bold">Prompts</h2>
        <p className="text-sm text-muted-foreground">Edite as instruções que a IA recebe. O app preenche as variáveis na hora de gerar.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={labelCls}>Qual prompt</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectCls}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </div>
        <div><label className={labelCls}>Vale para</label>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={selectCls}>
            <option value="global">Todas as marcas{current.global ? " (personalizado)" : ""}</option>
            {brandbooks.map((b) => <option key={b.id} value={b.id}>{b.name}{current.brandbooks[b.id] ? " (personalizado)" : ""}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{current.description} {stored ? "Usando texto personalizado." : "Usando o texto padrão."}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Variáveis (clique para inserir):</span>
        {current.variables.map((v) => (
          <button key={v.name} type="button" title={v.description + (v.required ? " (obrigatória)" : "")} onClick={() => insert(v.name)} className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent", v.required ? "border-primary/50 text-primary" : "border-input")}>
            {`{{${v.name}}}`}
          </button>
        ))}
      </div>
      <Textarea ref={area} rows={16} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
      {msg && <p className={cn("rounded-md p-2 text-xs", msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-destructive/10 text-destructive")}>{msg.text}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => save(null)} disabled={saving || !stored}><RotateCcw className="h-3.5 w-3.5" /> Voltar ao padrão</Button>
        <Button onClick={() => save(text)} disabled={saving || text.trim() === (stored ?? current.default).trim()}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar prompt</Button>
      </div>
    </section>
  );
}

// ─── Estilo do Imagem e Texto ──────────────────────────────────────────────────

type NumField = { key: keyof ImageTextStyle; label: string; min: number; max: number; step?: number };
const NUMS: NumField[] = [
  { key: "box_width", label: "Largura da caixa (%)", min: 50, max: 100 }, { key: "box_radius", label: "Cantos arredondados (px)", min: 0, max: 60 },
  { key: "headline_size", label: "Tamanho da headline (px)", min: 24, max: 120 }, { key: "subheadline_size", label: "Tamanho da subheadline (px)", min: 16, max: 60 },
  { key: "headline_weight", label: "Peso da headline", min: 400, max: 900, step: 100 }, { key: "overlay", label: "Escurecimento da foto", min: 0, max: 0.9, step: 0.02 },
  { key: "brightness", label: "Brilho da foto", min: 0.3, max: 1.3, step: 0.02 }, { key: "username_size", label: "Tamanho do username (px)", min: 18, max: 80 },
  { key: "headline_max", label: "Limite da headline (caracteres)", min: 20, max: 200 }, { key: "subheadline_max", label: "Limite da subheadline (caracteres)", min: 20, max: 300 },
];

function ImageTextStyleEditor({ brandbooks }: { brandbooks: BrandbookSummary[] }) {
  const [overview, setOverview] = useState<ImageTextStyleOverview | null>(null);
  const [scope, setScope] = useState("global");
  const [style, setStyle] = useState<ImageTextStyle | null>(null);
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const seq = useRef(0);
  const brandForPreview = scope === "global" ? (brandbooks.find((b) => b.is_default) || brandbooks[0])?.id : scope;

  useEffect(() => { service.getImageTextStyle().then(setOverview).catch((e) => setMsg({ ok: false, text: service.errorMessage(e) })); }, []);
  useEffect(() => {
    if (!overview) return;
    const base = { ...overview.defaults, ...overview.global, ...(scope === "global" ? {} : overview.brandbooks[scope] || {}) };
    setStyle(base);
  }, [overview, scope]);

  useEffect(() => {
    if (!style || !brandForPreview) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      service.previewImageTextHtml({ brandbook_id: brandForPreview, style }).then((h) => { if (mine === seq.current) setHtml(h); }).catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [style, brandForPreview]);

  if (!overview || !style) return null;
  const set = <K extends keyof ImageTextStyle>(k: K, v: ImageTextStyle[K]) => setStyle({ ...style, [k]: v });
  const customized = scope === "global" ? Object.keys(overview.global).length > 0 : !!overview.brandbooks[scope];

  const save = async (value: Partial<ImageTextStyle> | null) => {
    setSaving(true);
    setMsg(null);
    try {
      setOverview(await service.saveImageTextStyle(scope, value));
      setMsg({ ok: true, text: value ? "Estilo salvo." : "Estilo restaurado." });
    } catch (e) {
      setMsg({ ok: false, text: service.errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-base font-bold">Estilo do modelo "Imagem e Texto"</h2>
        <p className="text-sm text-muted-foreground">Cor e posição da caixa, tamanhos, username e pontinhos. Vale para todas as marcas ou só para uma.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <div><label className={labelCls}>Configurar para</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={selectCls}>
              <option value="global">Todas as marcas</option>
              {brandbooks.map((b) => <option key={b.id} value={b.id}>{b.name}{overview.brandbooks[b.id] ? " (personalizado)" : ""}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={labelCls}>Cor da caixa (vazio = cor da marca)</label>
              <div className="flex gap-2"><input type="color" value={/^#[0-9a-f]{6}$/i.test(style.box_color) ? style.box_color : "#000000"} onChange={(e) => set("box_color", e.target.value)} className="h-9 w-10 rounded border border-input bg-transparent" /><Input value={style.box_color} onChange={(e) => set("box_color", e.target.value)} placeholder="Cor da marca" /></div></div>
            <div><label className={labelCls}>Posição da caixa</label>
              <select value={style.box_position} onChange={(e) => set("box_position", e.target.value as ImageTextStyle["box_position"])} className={selectCls}><option value="bottom">Embaixo</option><option value="center">Centro</option><option value="top">Topo</option></select></div>
            <div><label className={labelCls}>Fonte (Google Fonts)</label><Input value={style.font} onChange={(e) => set("font", e.target.value)} /></div>
            <div><label className={labelCls}>Cor da headline</label><Input value={style.headline_color} onChange={(e) => set("headline_color", e.target.value)} /></div>
            <div><label className={labelCls}>Cor da subheadline</label><Input value={style.subheadline_color} onChange={(e) => set("subheadline_color", e.target.value)} /></div>
            <div><label className={labelCls}>Username (vazio = @ da marca)</label><Input value={style.username} onChange={(e) => set("username", e.target.value)} /></div>
            {NUMS.map((f) => (
              <div key={f.key}><label className={labelCls}>{f.label}: <span className="font-mono text-foreground">{style[f.key] as number}</span></label>
                <input type="range" min={f.min} max={f.max} step={f.step ?? 1} value={style[f.key] as number} onChange={(e) => set(f.key, Number(e.target.value) as never)} className="w-full accent-[var(--primary)]" /></div>
            ))}
          </div>
          <div className="flex gap-4 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={style.show_username} onChange={(e) => set("show_username", e.target.checked)} /> Mostrar username</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={style.show_dots} onChange={(e) => set("show_dots", e.target.checked)} /> Mostrar pontinhos</label>
          </div>
          {msg && <p className={cn("rounded-md p-2 text-xs", msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-destructive/10 text-destructive")}>{msg.text}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => save(null)} disabled={saving || !customized}><RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão</Button>
            <Button onClick={() => save(style)} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar estilo</Button>
          </div>
        </div>
        <div className="mx-auto w-[300px] overflow-hidden rounded-lg bg-black ring-1 ring-white/10" style={{ height: 375 }}>
          {html && <iframe title="Prévia" srcDoc={html} sandbox="allow-scripts" scrolling="no" className="pointer-events-none border-0" style={{ width: 1080, height: 1350, transform: `scale(${300 / 1080})`, transformOrigin: "top left" }} />}
        </div>
      </div>
    </section>
  );
}

// ─── ElevenLabs ────────────────────────────────────────────────────────────────

function ElevenLabsSettings() {
  const [settings, setSettings] = useState<comicService.ElevenSettings | null>(null);
  const [key, setKey] = useState("");
  const [voice, setVoice] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    comicService.getElevenSettings().then((s) => { setSettings(s); setVoice(s.voice_id); setModel(s.model); }).catch(() => undefined);
  }, []);

  const save = async (apiKey?: string) => {
    setSaving(true);
    setMsg(null);
    try {
      const s = await comicService.saveElevenSettings({ api_key: apiKey ?? key, voice_id: voice, model });
      setSettings(s);
      setKey("");
      setMsg({ ok: true, text: "Salvo." });
    } catch (e) {
      setMsg({ ok: false, text: service.errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-base font-bold">ElevenLabs · narração das mini-novelas</h2>
        <p className="text-sm text-muted-foreground">Usada para gerar a voz do narrador e dos personagens no vídeo da HQ. A chave fica criptografada e só você a usa.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label className={labelCls}>API key {settings.configured && <span className="text-emerald-300">(configurada{settings.from_env ? " no servidor" : ""})</span>}</label>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={settings.configured ? "Deixe vazio para manter a atual" : "Cole a API key do ElevenLabs"} autoComplete="off" />
        </div>
        <div><label className={labelCls}>Voz padrão (voice id, opcional)</label><Input value={voice} onChange={(e) => setVoice(e.target.value)} /></div>
        <div><label className={labelCls}>Modelo de voz</label><Input value={model} onChange={(e) => setModel(e.target.value)} /></div>
      </div>
      {msg && <p className={cn("rounded-md p-2 text-xs", msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-destructive/10 text-destructive")}>{msg.text}</p>}
      <div className="flex justify-end gap-2">
        {settings.configured && !settings.from_env && <Button variant="ghost" onClick={() => save("-")} disabled={saving}>Remover a chave</Button>}
        <Button onClick={() => save()} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
      </div>
    </section>
  );
}

// ─── Google Flow (extensão) ────────────────────────────────────────────────────

function FlowExtensionSettings() {
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = () => service.getFlowStatus().then((s) => setConnected(s.connected)).catch(() => undefined);
    void check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  const generate = async () => {
    setError(null);
    try { setToken(await service.createFlowToken()); setCopied(false); } catch (e) { setError(service.errorMessage(e)); }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-base font-bold">Google Flow · agente local</h2>
        <p className="text-sm text-muted-foreground">Gera as imagens das mini-novelas no Flow, usando os créditos do seu plano do Google. Quem gera é o seu navegador, logado na sua conta.</p>
      </div>
      <p className={cn("rounded-md p-2 text-xs", connected ? "bg-emerald-500/10 text-emerald-300" : "bg-secondary text-muted-foreground")}>
        {connected ? "Agente conectado. Escolha \"Google Flow (extensão)\" ao desenhar os quadros." : "Agente não conectado."}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
        <li>Precisa do <b>Node.js</b> instalado no seu PC. <a href="/flow-agent.zip" download className="text-primary hover:underline">Baixe o agente (ZIP)</a> e extraia numa pasta.</li>
        <li>Gere o código de conexão abaixo.</li>
        <li>Dê dois cliques em <code className="font-mono">iniciar.bat</code>. Na primeira vez ele instala o necessário e pede o endereço desta CollabSuite e o código.</li>
        <li>Ele abre uma janela do Chrome/Edge no <code className="font-mono">flow.google.com</code>: entre com a sua conta Google (só na primeira vez, o login fica salvo) e deixe o agente rodando enquanto gera.</li>
      </ol>
      <p className="text-xs text-muted-foreground">É o mesmo método do CarrosselX: o agente controla a janela do Flow e envia os character sheets pela janela de arquivos de verdade. A extensão de navegador antiga não consegue anexar arquivos; não use as duas ao mesmo tempo.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={generate}>Gerar código de conexão</Button>
        <span className="text-xs text-muted-foreground">Endereço desta CollabSuite: <code className="font-mono">{window.location.origin}</code></span>
      </div>
      {token && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input readOnly value={token} className="font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(token); setCopied(true); }}>{copied ? "Copiado" : "Copiar"}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Vale por 180 dias e dá acesso à sua conta: não compartilhe.</p>
        </div>
      )}
      {error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
