import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Instagram, Plus, CalendarDays, Loader2, Trash2, Pencil, Pause, Play, MessageCircle, Send, Sparkles, ExternalLink, Link2Off, CheckCircle2, AlertTriangle, ChevronDown, Youtube, Music2, Clapperboard, Share2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs";
import { cn } from "@/src/lib/utils";
import * as ig from "@/src/services/instagram.service";
import * as social from "@/src/services/social.service";
import { PostDialog } from "@/src/components/instagram/PostDialog";
import { AutomationDialog } from "@/src/components/instagram/AutomationDialog";
import { MetaConfigCard } from "@/src/components/instagram/MetaConfigCard";
import { SocialConfigCard } from "@/src/components/social/SocialConfigCard";
import { SocialPostDialog } from "@/src/components/social/SocialPostDialog";

const STATUS: Record<ig.PostStatus, { label: string; cls: string }> = {
  scheduled: { label: "Agendada", cls: "bg-primary/15 text-primary" },
  publishing: { label: "Publicando…", cls: "bg-amber-500/15 text-amber-500" },
  published: { label: "Publicada", cls: "bg-emerald-500/15 text-emerald-500" },
  failed: { label: "Falhou", cls: "bg-destructive/15 text-destructive" },
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const IG_ERRORS: Record<string, string> = {
  cancelled: "A conexão foi cancelada.",
  invalid_state: "A sessão de conexão expirou. Tente novamente.",
  no_code: "O Facebook não devolveu o código de autorização.",
  no_instagram: "Nenhuma conta Instagram Business/Creator vinculada a uma Página do Facebook foi encontrada.",
  server_error: "Erro ao concluir a conexão. Veja o log do servidor.",
};

const SOCIAL_ERRORS: Record<string, string> = {
  cancelled: "A conexão foi cancelada.",
  invalid_state: "A sessão de conexão expirou. Tente novamente.",
  no_code: "A rede não devolveu o código de autorização.",
  server_error: "Erro ao concluir a conexão. Veja o log do servidor.",
};

const PLATFORM_ICON = { youtube: Youtube, tiktok: Music2 } as const;
const KIND_ICON: Record<social.SocialKind, typeof Youtube> = { youtube_short: Clapperboard, youtube_video: Youtube, tiktok: Music2 };

const FILTER_KEY = "instagram_project_filter";

export function InstagramPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<ig.InstagramAccounts | null>(null);
  const [tab, setTab] = useState(params.get("tab") || "posts");
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ id: string; projectId: number; accounts: ig.PendingAccount[] } | null>(null);
  /** null = todos os clientes */
  const [filter, setFilter] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(FILTER_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });

  const [socialAccounts, setSocialAccounts] = useState<social.SocialAccounts | null>(null);
  const [socialConfig, setSocialConfig] = useState<Record<social.Platform, social.SocialConfig> | null>(null);
  const [socialPosts, setSocialPosts] = useState<social.SocialPost[] | null>(null);
  const [editingSocial, setEditingSocial] = useState<social.SocialPost | null>(null);
  const [socialOpen, setSocialOpen] = useState(false);
  const [connectingSocial, setConnectingSocial] = useState<string | null>(null);

  const [posts, setPosts] = useState<ig.InstagramPost[] | null>(null);
  const [autos, setAutos] = useState<ig.InstagramAutomation[] | null>(null);
  const [summary, setSummary] = useState<{ active: number; comments: number; replies: number; dms: number } | null>(null);

  const [postOpen, setPostOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ig.InstagramPost | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [editingAuto, setEditingAuto] = useState<ig.InstagramAutomation | null>(null);
  const [openLog, setOpenLog] = useState<number | null>(null);
  const [logs, setLogs] = useState<Record<number, ig.Engagement[]>>({});
  const [connecting, setConnecting] = useState<number | null>(null);

  const projects = accounts?.projects ?? [];
  const connectedProjects = useMemo(() => projects.filter((p) => p.connected), [projects]);
  // Filtro salvo de um projeto que não existe mais volta para "todos".
  const activeFilter = filter && projects.some((p) => p.project_id === filter) ? filter : null;
  const filterAccount = activeFilter ? projects.find((p) => p.project_id === activeFilter) : null;

  const chooseFilter = (id: number | null) => {
    setFilter(id);
    try {
      if (id) localStorage.setItem(FILTER_KEY, String(id));
      else localStorage.removeItem(FILTER_KEY);
    } catch {
      /* sem storage: só não lembra */
    }
  };

  const loadAccounts = useCallback(() => ig.listAccounts().then(setAccounts).catch(() => setAccounts({ configured: false, projects: [] })), []);
  const loadPosts = useCallback(() => ig.listPosts(activeFilter ?? undefined).then(setPosts).catch(() => setPosts([])), [activeFilter]);
  const loadSocialAccounts = useCallback(() => social.listAccounts().then(setSocialAccounts).catch(() => setSocialAccounts({ configured: { youtube: false, tiktok: false }, projects: [] })), []);
  const loadSocialConfig = useCallback(() => social.getConfig().then(setSocialConfig).catch(() => {}), []);
  const loadSocialPosts = useCallback(() => social.listPosts(activeFilter ?? undefined).then(setSocialPosts).catch(() => setSocialPosts([])), [activeFilter]);
  const reloadAll = useCallback(() => { loadPosts(); loadSocialPosts(); }, [loadPosts, loadSocialPosts]);
  const loadAutos = useCallback(() => {
    ig.listAutomations(activeFilter ?? undefined).then(setAutos).catch(() => setAutos([]));
    ig.automationSummary(activeFilter ?? undefined).then(setSummary).catch(() => {});
  }, [activeFilter]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    loadSocialAccounts();
    loadSocialConfig();
  }, [loadSocialAccounts, loadSocialConfig]);
  useEffect(() => {
    setPosts(null);
    loadPosts();
  }, [loadPosts]);
  useEffect(() => {
    setSocialPosts(null);
    loadSocialPosts();
  }, [loadSocialPosts]);
  useEffect(() => {
    setAutos(null);
    loadAutos();
  }, [loadAutos]);

  // Retorno do OAuth do Facebook + clique em um item do Calendário (?task=ID).
  useEffect(() => {
    const next = new URLSearchParams(params);
    let changed = false;
    const proj = Number(params.get("project")) || null;
    if (params.get("ig_success")) {
      setBanner({ ok: true, text: "Instagram conectado com sucesso!" });
      if (proj) chooseFilter(proj);
      next.delete("ig_success"); changed = true;
    }
    const err = params.get("ig_error");
    if (err) {
      setBanner({ ok: false, text: err === "in_use" ? params.get("ig_detail") || "Esta conta já está conectada a outro projeto." : IG_ERRORS[err] ?? "Não foi possível conectar o Instagram." });
      next.delete("ig_error"); next.delete("ig_detail"); changed = true;
    }
    const sel = params.get("ig_select");
    if (sel) {
      ig.getPending(sel).then((list) => setPending({ id: sel, projectId: proj ?? 0, accounts: list })).catch((e) => setBanner({ ok: false, text: ig.errMsg(e) }));
      next.delete("ig_select"); changed = true;
    }
    const socialOk = params.get("social_success");
    if (socialOk) {
      setBanner({ ok: true, text: `${social.PLATFORM_LABEL[socialOk as social.Platform] ?? "Conta"} conectado com sucesso!` });
      if (proj) chooseFilter(proj);
      loadSocialAccounts();
      next.delete("social_success"); changed = true;
    }
    const socialErr = params.get("social_error");
    if (socialErr) {
      const detail = params.get("social_detail");
      setBanner({ ok: false, text: detail || SOCIAL_ERRORS[socialErr] || "Não foi possível conectar a conta." });
      next.delete("social_error"); next.delete("social_detail"); next.delete("social_platform"); changed = true;
    }
    const task = params.get("task");
    if (task) {
      // O item do Calendário pode ser uma postagem do Instagram ou de YouTube/TikTok.
      ig.getPostByTask(Number(task))
        .then((p) => { setEditingPost(p); setPostOpen(true); })
        .catch(() =>
          social.getPostByTask(Number(task))
            .then((p) => { setEditingSocial(p); setSocialOpen(true); })
            .catch(() => setBanner({ ok: false, text: "Postagem não encontrada." }))
        );
      next.delete("task"); changed = true;
    }
    if (proj) { next.delete("project"); changed = true; }
    if (changed) setParams(next, { replace: true });
  }, [params, setParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Posts em "publicando" mudam sozinhos: atualiza enquanto houver algum.
  useEffect(() => {
    const igBusy = posts?.some((p) => p.status === "publishing");
    const socialBusy = socialPosts?.some((p) => p.status === "publishing");
    if (!igBusy && !socialBusy) return;
    const t = setInterval(() => { if (igBusy) loadPosts(); if (socialBusy) loadSocialPosts(); }, 5000);
    return () => clearInterval(t);
  }, [posts, socialPosts, loadPosts, loadSocialPosts]);

  const connect = async (projectId: number) => {
    setConnecting(projectId);
    try {
      window.location.href = await ig.getConnectUrl(projectId);
    } catch (e) {
      setBanner({ ok: false, text: ig.errMsg(e) });
      setConnecting(null);
    }
  };

  const connectSocial = async (projectId: number, platform: social.Platform) => {
    setConnectingSocial(`${projectId}-${platform}`);
    try {
      window.location.href = await social.getConnectUrl(projectId, platform);
    } catch (e) {
      setBanner({ ok: false, text: ig.errMsg(e) });
      setConnectingSocial(null);
    }
  };

  const socialProjects = socialAccounts?.projects ?? [];
  const hasAnyConnection = connectedProjects.length > 0 || socialProjects.some((p) => p.youtube || p.tiktok);
  const hasSocial = (projectId: number) => { const s = socialProjects.find((p) => p.project_id === projectId); return !!(s?.youtube || s?.tiktok); };

  const requireConnection = (fn: () => void) => {
    if (hasAnyConnection) return fn();
    setTab("account");
    setBanner({ ok: false, text: "Conecte uma conta (Instagram, YouTube ou TikTok) de um projeto primeiro." });
  };

  /** Posts de todas as redes numa lista só, do mais recente para o mais antigo. */
  const feed = useMemo(() => {
    const at = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
    return [
      ...(posts ?? []).map((p) => ({ type: "ig" as const, at: at(p.scheduled_at), ig: p })),
      ...(socialPosts ?? []).map((p) => ({ type: "social" as const, at: at(p.scheduled_at), soc: p })),
    ].sort((a, b) => b.at - a.at);
  }, [posts, socialPosts]);

  const toggleLog = async (id: number) => {
    if (openLog === id) return setOpenLog(null);
    setOpenLog(id);
    setLogs((l) => ({ ...l, [id]: [] }));
    ig.listEngagements(id).then((rows) => setLogs((l) => ({ ...l, [id]: rows })));
  };

  const showProject = activeFilter === null;
  const ProjectBadge = ({ p }: { p: ig.ProjectRef }) => (
    <Badge variant="outline" className="gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: p.color || "var(--primary)" }} />
      {p.name}{p.username ? ` · @${p.username}` : ""}
    </Badge>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-xl font-bold"><Share2 className="h-5 w-5 text-primary" /> Redes sociais</h1>
            <p className="mt-1 text-sm text-muted-foreground">Cada projeto (cliente) tem as suas contas: Instagram, YouTube e TikTok. Programe tudo num lugar só — as postagens aparecem no Calendário — e automatize respostas e DMs no Instagram.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/agenda")}><CalendarDays className="mr-2 h-4 w-4" /> Ver no Calendário</Button>
            <Button onClick={() => requireConnection(() => { setEditingPost(null); setPostOpen(true); })}><Plus className="mr-2 h-4 w-4" /> Nova postagem</Button>
          </div>
        </div>

        {/* Seletor de cliente */}
        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => chooseFilter(null)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", activeFilter === null ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              Todos os clientes
            </button>
            {projects.map((p) => (
              <button
                key={p.project_id}
                onClick={() => chooseFilter(p.project_id)}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", activeFilter === p.project_id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: p.project_color || "var(--primary)" }} />
                {p.project_name}
                {!p.connected && !hasSocial(p.project_id) && <span className="text-[10px] opacity-60">· sem conta</span>}
              </button>
            ))}
          </div>
        )}

        {banner && (
          <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", banner.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : "border-destructive/40 bg-destructive/10 text-destructive")}>
            {banner.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1">{banner.text}</span>
            <button onClick={() => setBanner(null)} className="text-xs underline">fechar</button>
          </div>
        )}

        {pending && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">Qual conta do Instagram você quer usar neste projeto?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {pending.accounts.map((a) => (
                <button
                  key={a.instagramId}
                  onClick={async () => {
                    try {
                      setAccounts(await ig.selectPending(pending.id, a.instagramId));
                      setPending(null);
                      setBanner({ ok: true, text: "Instagram conectado com sucesso!" });
                      if (pending.projectId) chooseFilter(pending.projectId);
                    } catch (e) {
                      setBanner({ ok: false, text: ig.errMsg(e) });
                    }
                  }}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:border-primary"
                >
                  {a.avatar ? <img src={a.avatar} alt="" className="h-10 w-10 rounded-full object-cover" /> : <Instagram className="h-10 w-10 text-muted-foreground" />}
                  <span><span className="block text-sm font-semibold">@{a.username}</span><span className="text-xs text-muted-foreground">Página: {a.pageName}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="posts">Postagens</TabsTrigger>
            <TabsTrigger value="engage">Engajar</TabsTrigger>
            <TabsTrigger value="account">Contas</TabsTrigger>
          </TabsList>

          {/* ── Postagens ── */}
          <TabsContent value="posts" className="mt-4 space-y-3">
            {filterAccount && !filterAccount.connected && !hasSocial(filterAccount.project_id) && (
              <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                {filterAccount.project_name} ainda não tem nenhuma conta conectada. <button className="text-primary underline" onClick={() => setTab("account")}>Conectar agora</button>
              </p>
            )}
            {posts === null || socialPosts === null ? (
              <Loading />
            ) : feed.length === 0 ? (
              <Empty icon={CalendarDays} title="Nenhuma postagem ainda" text="Agende uma postagem — ela vai direto para o Calendário." />
            ) : (
              feed.map((item) => {
                if (item.type === "social") {
                  const s = item.soc;
                  const KIcon = KIND_ICON[s.kind];
                  return (
                    <div key={`s${s.id}`} className="flex gap-3 rounded-xl border border-border bg-card p-3">
                      <Thumb url={s.media[0]} icon={KIcon} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", STATUS[s.status].cls)}>{s.status === "publishing" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{STATUS[s.status].label}</span>
                          <Badge variant="outline" className="gap-1"><KIcon className="h-3 w-3" /> {social.KIND_LABEL[s.kind]}</Badge>
                          <span className="text-xs text-muted-foreground">{s.status === "published" ? `Publicada em ${fmt(s.published_at)}` : fmt(s.scheduled_at)}</span>
                          {showProject && <ProjectBadge p={s.project} />}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm">{s.title || s.caption || <em className="text-muted-foreground">Sem legenda</em>}</p>
                        {s.status === "failed" && s.error && <p className="mt-1 line-clamp-2 text-xs text-destructive">{s.error}</p>}
                        {s.note && <p className="mt-1 line-clamp-2 text-xs text-amber-500">{s.note}</p>}
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        {s.permalink && <a href={s.permalink} target="_blank" rel="noreferrer" className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label="Abrir na rede"><ExternalLink className="h-4 w-4" /></a>}
                        <button onClick={() => { setEditingSocial(s); setSocialOpen(true); }} className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label="Abrir"><Pencil className="h-4 w-4" /></button>
                        {s.status !== "publishing" && (
                          <button
                            onClick={async () => {
                              if (!confirm(s.status === "published" ? "Remover este registro? O vídeo continua na rede." : "Cancelar esta postagem agendada?")) return;
                              try { await social.deletePost(s.id); loadSocialPosts(); } catch (e) { setBanner({ ok: false, text: ig.errMsg(e) }); }
                            }}
                            className="rounded-md p-2 text-muted-foreground hover:text-destructive"
                            aria-label="Excluir"
                          ><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    </div>
                  );
                }
                const p = item.ig;
                return (
                <div key={`i${p.id}`} className="flex gap-3 rounded-xl border border-border bg-card p-3">
                  <Thumb url={p.media[0]} count={p.media.length} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", STATUS[p.status].cls)}>{p.status === "publishing" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{STATUS[p.status].label}</span>
                      <span className="text-xs text-muted-foreground">{p.status === "published" ? `Publicada em ${fmt(p.published_at)}` : fmt(p.scheduled_at)}</span>
                      <Badge variant="outline" className="gap-1"><Instagram className="h-3 w-3" /> Instagram</Badge>
                      {showProject && <ProjectBadge p={p.project} />}
                      {p.automation && <Badge variant="outline" className="gap-1"><MessageCircle className="h-3 w-3" /> {p.automation.title}</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">{p.title || p.caption || <em className="text-muted-foreground">Sem legenda</em>}</p>
                    {p.status === "failed" && p.error && <p className="mt-1 line-clamp-2 text-xs text-destructive">{p.error}</p>}
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label="Abrir no Instagram"><ExternalLink className="h-4 w-4" /></a>}
                    <button onClick={() => { setEditingPost(p); setPostOpen(true); }} className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label="Abrir"><Pencil className="h-4 w-4" /></button>
                    {p.status !== "publishing" && (
                      <button
                        onClick={async () => {
                          if (!confirm(p.status === "published" ? "Remover este registro? A postagem continua no Instagram." : "Cancelar esta postagem agendada?")) return;
                          try { await ig.deletePost(p.id); loadPosts(); loadAutos(); } catch (e) { setBanner({ ok: false, text: ig.errMsg(e) }); }
                        }}
                        className="rounded-md p-2 text-muted-foreground hover:text-destructive"
                        aria-label="Excluir"
                      ><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                </div>
                );
              })
            )}
          </TabsContent>

          {/* ── Engajar ── */}
          <TabsContent value="engage" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Ativas", summary?.active, Play],
                  ["Comentários", summary?.comments, MessageCircle],
                  ["Respostas", summary?.replies, Sparkles],
                  ["DMs enviadas", summary?.dms, Send],
                ].map(([label, value, Icon]: any) => (
                  <div key={label} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</div>
                    <div className="mt-1 font-display text-2xl font-bold">{value ?? "–"}</div>
                  </div>
                ))}
              </div>
              <Button onClick={() => requireConnection(() => { setEditingAuto(null); setAutoOpen(true); })}><Plus className="mr-2 h-4 w-4" /> Nova automação</Button>
            </div>

            {connectedProjects.some((p) => (activeFilter === null || p.project_id === activeFilter) && !p.account?.webhook_ok) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>O webhook ainda não foi confirmado para {activeFilter === null ? "alguma conta" : "esta conta"}, então os comentários podem não chegar. Veja a aba <button className="underline" onClick={() => setTab("account")}>Contas</button>.</span>
              </div>
            )}

            {autos === null ? (
              <Loading />
            ) : autos.length === 0 ? (
              <Empty icon={MessageCircle} title="Nenhuma automação" text="Crie uma automação para responder e enviar DM a quem comentar uma palavra-chave no post do cliente." />
            ) : (
              autos.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-card">
                  <div className="flex gap-3 p-3">
                    <Thumb url={a.post_image} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{a.title}</h3>
                        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", a.status === "active" ? "bg-emerald-500/15 text-emerald-500" : "bg-subtle text-muted-foreground")}>{a.status === "active" ? "Ativa" : a.waiting_post ? "Aguardando o post" : "Pausada"}</span>
                        {showProject && <ProjectBadge p={a.project} />}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">{a.keywords.map((k) => <span key={k} className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{k}</span>)}</div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {a.stats.comments} comentários · {a.stats.replies} respostas · {a.stats.dms} DMs
                        {a.waiting_post && typeof a.waiting_post === "object" && ` · publica em ${fmt(a.waiting_post.scheduled_at)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      <button onClick={() => toggleLog(a.id)} className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label="Histórico"><ChevronDown className={cn("h-4 w-4 transition-transform", openLog === a.id && "rotate-180")} /></button>
                      {a.ig_media_id && (
                        <button
                          onClick={async () => { try { await ig.updateAutomation(a.id, { status: a.status === "active" ? "paused" : "active" }); loadAutos(); } catch (e) { setBanner({ ok: false, text: ig.errMsg(e) }); } }}
                          className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label={a.status === "active" ? "Pausar" : "Ativar"}
                        >{a.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
                      )}
                      <button onClick={() => { setEditingAuto(a); setAutoOpen(true); }} className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
                      <button
                        onClick={async () => { if (!confirm("Excluir esta automação e o histórico dela?")) return; try { await ig.deleteAutomation(a.id); loadAutos(); loadPosts(); } catch (e) { setBanner({ ok: false, text: ig.errMsg(e) }); } }}
                        className="rounded-md p-2 text-muted-foreground hover:text-destructive" aria-label="Excluir"
                      ><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  {openLog === a.id && (
                    <div className="max-h-64 space-y-1 overflow-y-auto border-t border-border p-3 text-xs">
                      {!logs[a.id] || logs[a.id].length === 0 ? (
                        <p className="text-muted-foreground">Nenhuma interação ainda.</p>
                      ) : logs[a.id].map((e) => (
                        <div key={e.id} className="flex gap-2">
                          <span className="w-14 shrink-0 font-semibold text-muted-foreground">{e.type === "COMMENT" ? "Comentou" : e.type === "REPLY" ? "Resposta" : "DM"}</span>
                          <span className="min-w-0 flex-1 break-words">{e.username && <strong>@{e.username} </strong>}{e.text}{e.error && <span className="block text-destructive">Erro: {e.error}</span>}</span>
                          <span className="shrink-0 text-muted-foreground">{fmt(e.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </TabsContent>

          {/* ── Contas (uma por projeto) ── */}
          <TabsContent value="account" className="mt-4 space-y-3">
            <MetaConfigCard onChanged={loadAccounts} />
            {socialConfig && (["youtube", "tiktok"] as const).map((pl) => (
              <SocialConfigCard key={pl} platform={pl} config={socialConfig[pl]} onChanged={() => { loadSocialConfig(); loadSocialAccounts(); }} />
            ))}
            {!accounts ? (
              <Loading />
            ) : projects.length === 0 ? (
              <Empty icon={Instagram} title="Você ainda não tem projetos" text="Crie um projeto para o cliente e conecte as contas dele aqui." />
            ) : (
              <>
                {!accounts.configured && !socialAccounts?.configured.youtube && !socialAccounts?.configured.tiktok && (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Configure o app de pelo menos uma rede acima (uma vez só) para liberar o botão <strong>Conectar</strong> de cada cliente.</p>
                )}
                <p className="text-sm text-muted-foreground">Cada projeto usa as próprias contas. No Instagram, entre no Facebook com o login que administra a Página do cliente; no YouTube e TikTok, entre com a conta dona do canal.</p>
                {projects.map((p) => (
                  <div key={p.project_id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      {p.account?.avatar && p.connected ? <img src={p.account.avatar} alt="" className="h-11 w-11 rounded-full object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-subtle"><Instagram className="h-5 w-5 text-muted-foreground" /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: p.project_color || "var(--primary)" }} />{p.project_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.connected && p.account ? <>@{p.account.username} · Página {p.account.page_name}</> : "Nenhuma conta conectada"}
                        </p>
                      </div>
                      {!accounts.configured && !p.connected ? (
                        <span className="text-xs text-muted-foreground">Configure o app do Meta</span>
                      ) : p.connected ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={connecting === p.project_id} onClick={() => connect(p.project_id)}>Reconectar</Button>
                          <Button size="sm" variant="outline" onClick={async () => { if (confirm(`Desconectar @${p.account?.username}? As automações serão pausadas e as postagens agendadas aguardarão a reconexão.`)) setAccounts(await ig.disconnect(p.project_id)); }}><Link2Off className="mr-1.5 h-3.5 w-3.5" /> Desconectar</Button>
                        </div>
                      ) : (
                        <Button size="sm" disabled={connecting === p.project_id} onClick={() => connect(p.project_id)}>
                          {connecting === p.project_id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Instagram className="mr-1.5 h-3.5 w-3.5" />} Conectar
                        </Button>
                      )}
                    </div>
                    {p.connected && p.account && (
                      <div className="space-y-1 text-xs">
                        {p.account.token_error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-destructive">Token expirado ou revogado: {p.account.token_error}. Reconecte.</p>}
                        <p className="flex items-center gap-1.5">{p.account.webhook_ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}Webhook de comentários: {p.account.webhook_ok ? "ativo" : "não confirmado"}</p>
                      </div>
                    )}
                    {/* YouTube / TikTok deste cliente */}
                    {(["youtube", "tiktok"] as const).map((pl) => {
                      const conn = socialProjects.find((s) => s.project_id === p.project_id)?.[pl] ?? null;
                      const Icon = PLATFORM_ICON[pl];
                      const ready = !!socialAccounts?.configured[pl];
                      const key = `${p.project_id}-${pl}`;
                      return (
                        <div key={pl} className="space-y-1 border-t border-border pt-3">
                          <div className="flex flex-wrap items-center gap-3">
                            {conn?.avatar ? <img src={conn.avatar} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle"><Icon className="h-4 w-4 text-muted-foreground" /></span>}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{social.PLATFORM_LABEL[pl]}</p>
                              <p className="truncate text-xs text-muted-foreground">{conn ? conn.username : ready ? "Nenhuma conta conectada" : `Configure o app do ${social.PLATFORM_LABEL[pl]} acima`}</p>
                            </div>
                            {conn ? (
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" disabled={connectingSocial === key} onClick={() => connectSocial(p.project_id, pl)}>Reconectar</Button>
                                <Button size="sm" variant="outline" onClick={async () => { if (confirm(`Desconectar ${social.PLATFORM_LABEL[pl]} de ${p.project_name}? As postagens agendadas aguardarão a reconexão.`)) setSocialAccounts(await social.disconnect(p.project_id, pl)); }}><Link2Off className="mr-1.5 h-3.5 w-3.5" /> Desconectar</Button>
                              </div>
                            ) : (
                              ready && (
                                <Button size="sm" disabled={connectingSocial === key} onClick={() => connectSocial(p.project_id, pl)}>
                                  {connectingSocial === key ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Icon className="mr-1.5 h-3.5 w-3.5" />} Conectar
                                </Button>
                              )
                            )}
                          </div>
                          {conn?.token_error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">Acesso expirado ou revogado: {conn.token_error} Reconecte.</p>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <PostDialog open={postOpen} onOpenChange={setPostOpen} projects={projects} socialProjects={socialProjects} defaultProjectId={activeFilter} post={editingPost} onSaved={() => { reloadAll(); loadAutos(); }} />
      <SocialPostDialog open={socialOpen} onOpenChange={setSocialOpen} post={editingSocial} onSaved={loadSocialPosts} />
      <AutomationDialog open={autoOpen} onOpenChange={setAutoOpen} projects={projects} defaultProjectId={activeFilter} automation={editingAuto} onSaved={loadAutos} />
    </div>
  );
}

function Thumb({ url, count, icon: Icon = Instagram }: { url?: string | null; count?: number; icon?: typeof Instagram }) {
  const video = url && /\.(mp4|mov|avi|wmv|webm|m4v)$/i.test(url.split("?")[0]);
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-subtle">
      {url && !video ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Icon className="m-auto mt-5 h-6 w-6 text-muted-foreground" />}
      {!!count && count > 1 && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{count}</span>}
    </div>
  );
}

function Loading() {
  return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
}

function Empty({ icon: Icon, title, text }: { icon: typeof Instagram; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
