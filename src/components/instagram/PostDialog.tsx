import { useEffect, useRef, useState } from "react";
import { Loader2, ImagePlus, X, Film, CalendarClock, Send, MessageCircleReply, Instagram, Youtube, Music2, Clapperboard } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Switch } from "@/src/components/ui/switch";
import { cn } from "@/src/lib/utils";
import { uploadImage, uploadFile } from "@/src/services/upload.service";
import * as ig from "@/src/services/instagram.service";
import * as social from "@/src/services/social.service";
import { YoutubeFields, TiktokFields, defaultYoutube, defaultTiktok } from "@/src/components/social/SocialOptionsFields";
import { ProjectPicker } from "./ProjectPicker";
import { AutomationFields, emptyAutomation, toInput, type AutomationDraft } from "./AutomationFields";

const isVideo = (url: string) => /\.(mp4|mov|avi|wmv)$/i.test(url.split("?")[0]);

/** datetime-local (horário local do navegador) a partir de uma data ISO. */
function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Destination = "instagram" | social.SocialKind;

const DESTINATIONS: { key: Destination; label: string; icon: typeof Instagram }[] = [
  { key: "instagram", label: "Instagram", icon: Instagram },
  { key: "youtube_short", label: "YouTube Shorts", icon: Clapperboard },
  { key: "youtube_video", label: "YouTube", icon: Youtube },
  { key: "tiktok", label: "TikTok", icon: Music2 },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ig.ProjectAccount[];
  /** Canais do YouTube / contas do TikTok conectados por projeto. */
  socialProjects?: social.SocialProject[];
  /** Cliente pré-selecionado ao criar. */
  defaultProjectId?: number | null;
  /** Post existente (editar/ver). Sem ele, cria um novo. */
  post?: ig.InstagramPost | null;
  /** Mídias já prontas (ex.: vindas do estúdio de carrosséis). */
  initialMedia?: string[];
  initialCaption?: string;
  onSaved: () => void;
}

export function PostDialog({ open, onOpenChange, projects, socialProjects = [], defaultProjectId, post, initialMedia, initialCaption, onSaved }: Props) {
  const editing = !!post;
  const locked = !!post && !["scheduled", "failed"].includes(post.status);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<string[]>([]);
  const [mode, setMode] = useState<"schedule" | "now">("schedule");
  const [when, setWhen] = useState(toLocalInput(null));
  const [withAutomation, setWithAutomation] = useState(false);
  const [automation, setAutomation] = useState<AutomationDraft>(emptyAutomation());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [targets, setTargets] = useState<Destination[]>([]);
  const [ytOpts, setYtOpts] = useState(defaultYoutube());
  const [ttOpts, setTtOpts] = useState(defaultTiktok());
  const [creator, setCreator] = useState<social.TiktokCreatorInfo | null>(null);
  const [creatorLoading, setCreatorLoading] = useState(false);
  const [creatorError, setCreatorError] = useState<string | null>(null);

  const available = (pid: number | null): Record<Destination, boolean> => {
    const igp = projects.find((p) => p.project_id === pid);
    const s = socialProjects.find((p) => p.project_id === pid);
    return { instagram: !!igp?.connected, youtube_short: !!s?.youtube, youtube_video: !!s?.youtube, tiktok: !!s?.tiktok };
  };
  const avail = available(projectId);
  // Projetos com qualquer rede conectada entram no seletor.
  const pickerProjects = projects.map((p) => ({ ...p, connected: p.connected || !!socialProjects.find((s) => s.project_id === p.project_id && (s.youtube || s.tiktok)) }));
  const socialKinds = targets.filter((t): t is social.SocialKind => t !== "instagram");
  const wantsIg = targets.includes("instagram");
  const wantsYoutube = socialKinds.some((k) => k !== "tiktok");

  // Trocar de cliente: mantém só as redes que ele tem; sem nenhuma, marca a primeira disponível.
  useEffect(() => {
    if (!open) return setTargets([]);
    if (editing) return;
    const a = available(projectId);
    setTargets((cur) => {
      const kept = cur.filter((t) => a[t]);
      if (kept.length) return kept;
      const first = DESTINATIONS.find((d) => a[d.key]);
      return first ? [first.key] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, projectId, projects, socialProjects]);

  // Opções reais de privacidade da conta do TikTok.
  const needsCreator = open && !editing && !!projectId && targets.includes("tiktok");
  useEffect(() => {
    if (!needsCreator) return;
    let cancelled = false;
    setCreatorLoading(true);
    setCreatorError(null);
    social
      .tiktokCreatorInfo(projectId!)
      .then((c) => {
        if (cancelled) return;
        setCreator(c);
        setTtOpts((o) => ({ ...o, privacy_level: c.privacy_level_options.includes(o.privacy_level) ? o.privacy_level : c.privacy_level_options[0] }));
      })
      .catch((e) => {
        if (!cancelled) {
          setCreator(null);
          setCreatorError(`Não foi possível consultar as opções do TikTok (${ig.errMsg(e)}). Só "Só eu" será usado.`);
        }
      })
      .finally(() => {
        if (!cancelled) setCreatorLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsCreator, projectId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const connected = projects.filter((p) => p.connected);
    setProjectId(post?.project.id ?? (connected.find((p) => p.project_id === defaultProjectId) ?? (connected.length === 1 ? connected[0] : null))?.project_id ?? null);
    setTitle(post?.title ?? "");
    setCaption(post?.caption ?? initialCaption ?? "");
    setMedia(post?.media ?? initialMedia ?? []);
    setMode("schedule");
    setWhen(toLocalInput(post?.scheduled_at));
    setWithAutomation(false);
    setAutomation(emptyAutomation());
    setYtOpts(defaultYoutube());
    setTtOpts(defaultTiktok());
    setCreator(null);
  }, [open, post, initialMedia, initialCaption, projects, defaultProjectId]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        urls.push(f.type.startsWith("video/") ? (await uploadFile(f)).url : await uploadImage(f));
      }
      setMedia((m) => [...m, ...urls].slice(0, 10));
    } catch (e) {
      setError(ig.errMsg(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const move = (i: number, dir: -1 | 1) =>
    setMedia((m) => {
      const j = i + dir;
      if (j < 0 || j >= m.length) return m;
      const next = [...m];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const submit = async () => {
    setError(null);
    if (!editing && !projectId) return setError("Selecione o cliente (projeto) que vai publicar.");
    if (!editing && targets.length === 0) return setError("Escolha ao menos uma rede para publicar.");
    if (media.length === 0) return setError("Adicione ao menos uma imagem ou vídeo.");
    if (!editing && socialKinds.length > 0 && !(media.length === 1 && isVideo(media[0]))) return setError("YouTube e TikTok publicam um único vídeo. Deixe apenas 1 vídeo na mídia (ou desmarque essas redes).");
    if (!editing && wantsYoutube && !title.trim() && !caption.trim()) return setError("O YouTube exige um título: preencha o título (ou a legenda).");
    if (mode === "schedule" && !when) return setError("Escolha a data e a hora da publicação.");
    setSaving(true);
    let igDone = false;
    try {
      const scheduled_at = mode === "schedule" ? new Date(when).toISOString() : null;
      if (editing && post) {
        await ig.updatePost(post.id, { title, caption, media, scheduled_at });
      } else {
        if (wantsIg) {
          await ig.createPost({ project_id: projectId!, title, caption, media, scheduled_at, automation: withAutomation ? toInput(automation) : null });
          igDone = true;
        }
        if (socialKinds.length > 0) {
          await social.createPosts({
            project_id: projectId!,
            title,
            caption,
            media,
            scheduled_at,
            targets: socialKinds.map((kind) => ({ kind, options: kind === "tiktok" ? ttOpts : ytOpts })),
          });
        }
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      if (igDone) {
        // O Instagram já foi criado: tira da seleção para uma nova tentativa não duplicar.
        setTargets((cur) => cur.filter((t) => t !== "instagram"));
        onSaved();
        setError(`O Instagram foi agendado, mas as outras redes falharam: ${ig.errMsg(e)} Corrija e envie de novo (o Instagram não será repetido).`);
      } else {
        setError(ig.errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const publishNow = async () => {
    if (!post) return;
    setSaving(true);
    setError(null);
    try {
      await ig.updatePost(post.id, { title, caption, media });
      await ig.publishPostNow(post.id);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(ig.errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? (locked ? "Postagem" : "Editar postagem") : "Nova postagem"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "A postagem aparece no Calendário; mover o item lá também reagenda a publicação."
              : "Agende ou publique agora. Postagens agendadas aparecem no Calendário da plataforma."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {post?.status === "failed" && post.error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <strong>Falha ao publicar:</strong> {post.error}
            </div>
          )}

          <ProjectPicker projects={editing ? projects : pickerProjects} value={projectId} onChange={setProjectId} disabled={editing} label={editing ? "Cliente (conta do Instagram)" : "Cliente (projeto)"} />

          {!editing && projectId && (
            <div className="space-y-1.5">
              <Label>Publicar em</Label>
              <div className="flex flex-wrap gap-2">
                {DESTINATIONS.map(({ key, label, icon: Icon }) => {
                  const on = targets.includes(key);
                  const ok = avail[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!ok}
                      onClick={() => setTargets((cur) => (cur.includes(key) ? cur.filter((t) => t !== key) : [...cur, key]))}
                      title={ok ? undefined : "Não conectado neste cliente (aba Contas)"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                        !ok && "cursor-not-allowed opacity-40 hover:text-muted-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  );
                })}
              </div>
              {socialKinds.length > 0 && <p className="text-xs text-muted-foreground">YouTube e TikTok recebem um único vídeo. Título e legenda abaixo valem para todas as redes marcadas.</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{socialKinds.length > 0 ? "Vídeo (1 arquivo)" : "Mídia (até 10 — mais de uma vira carrossel)"}</Label>
            <div className="flex flex-wrap gap-2">
              {media.map((url, i) => (
                <div key={url + i} className="group relative h-24 w-24 overflow-hidden rounded-lg border border-border bg-subtle">
                  {isVideo(url) ? (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-6 w-6" /></div>
                  ) : (
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
                  {!locked && (
                    <>
                      <button type="button" onClick={() => setMedia(media.filter((_, k) => k !== i))} className="absolute right-1 top-1 hidden rounded bg-black/70 p-0.5 text-white group-hover:block" aria-label="Remover">
                        <X className="h-3 w-3" />
                      </button>
                      <div className="absolute inset-x-0 bottom-0 hidden justify-between bg-black/60 px-1 text-[11px] text-white group-hover:flex">
                        <button type="button" onClick={() => move(i, -1)} aria-label="Mover para trás">‹</button>
                        <button type="button" onClick={() => move(i, 1)} aria-label="Mover para frente">›</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {!locked && media.length < 10 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  {uploading ? "Enviando…" : "Adicionar"}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*,video/mp4,video/quicktime" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            </div>
            <p className="text-xs text-muted-foreground">Imagens em JPEG funcionam melhor no Instagram. Um vídeo sozinho é publicado como Reels.</p>
          </div>

          <div className="space-y-1.5">
            <Label>{wantsYoutube ? "Título (YouTube e Calendário)" : "Título interno (opcional)"}</Label>
            <Input value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} placeholder={wantsYoutube ? "Título do vídeo no YouTube (máx. 100)" : "Como aparece no Calendário"} maxLength={120} />
          </div>

          <div className="space-y-1.5">
            <Label>{socialKinds.length > 0 ? "Legenda / descrição" : "Legenda"}</Label>
            <Textarea rows={5} value={caption} disabled={locked} onChange={(e) => setCaption(e.target.value)} placeholder="Escreva a legenda, #hashtags e @menções…" maxLength={wantsIg || editing || !wantsYoutube ? 2200 : 5000} />
            <p className="text-right text-xs text-muted-foreground">{caption.length}/{wantsIg || editing || !wantsYoutube ? 2200 : 5000}</p>
          </div>

          {!locked && (
            <div className="space-y-2">
              <Label>Quando publicar</Label>
              <div className="flex flex-wrap items-center gap-2">
                {!editing && (
                  <div className="inline-flex rounded-lg border border-border p-0.5">
                    {([["schedule", "Agendar", CalendarClock], ["now", "Agora", Send]] as const).map(([k, label, Icon]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setMode(k)}
                        className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                      >
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                )}
                {mode === "schedule" && <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-auto" />}
              </div>
            </div>
          )}

          {!editing && wantsYoutube && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Youtube className="h-3.5 w-3.5 text-primary" /> {socialKinds.includes("youtube_short") && socialKinds.includes("youtube_video") ? "YouTube e Shorts" : socialKinds.includes("youtube_short") ? "YouTube Shorts" : "YouTube"}
              </p>
              <YoutubeFields value={ytOpts} onChange={setYtOpts} short={socialKinds.includes("youtube_short")} />
            </div>
          )}
          {!editing && socialKinds.includes("tiktok") && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Music2 className="h-3.5 w-3.5 text-primary" /> TikTok</p>
              <TiktokFields value={ttOpts} onChange={setTtOpts} creator={creator} loading={creatorLoading} creatorError={creatorError} />
            </div>
          )}

          {!editing && wantsIg && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="flex items-center gap-1.5"><MessageCircleReply className="h-3.5 w-3.5 text-primary" /> Automatizar comentários (Engajar)</Label>
                  <p className="text-xs text-muted-foreground">Responde e envia DM para quem comentar a palavra-chave — ativa assim que o post for publicado.</p>
                </div>
                <Switch checked={withAutomation} onCheckedChange={setWithAutomation} />
              </div>
              {withAutomation && <AutomationFields value={automation} onChange={setAutomation} />}
            </div>
          )}

          {post?.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Ver no Instagram</a>
          )}
          {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">{error}</p>}
        </div>

        {!locked && (
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            {editing && <Button variant="outline" onClick={publishNow} disabled={saving}>Publicar agora</Button>}
            <Button onClick={submit} disabled={saving || uploading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Salvar" : mode === "now" ? "Publicar agora" : "Agendar"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
