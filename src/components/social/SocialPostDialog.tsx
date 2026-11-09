import { useEffect, useState } from "react";
import { Loader2, CalendarClock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import * as social from "@/src/services/social.service";
import { YoutubeFields, TiktokFields, defaultYoutube, defaultTiktok } from "./SocialOptionsFields";

function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const errMsg = (e: any) => e?.response?.data?.error || e?.message || "Erro inesperado.";

/** Ver/editar uma postagem de YouTube ou TikTok já criada. */
export function SocialPostDialog({ post, open, onOpenChange, onSaved }: { post: social.SocialPost | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const locked = !!post && !["scheduled", "failed"].includes(post.status);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState(toLocalInput(null));
  const [yt, setYt] = useState(defaultYoutube());
  const [tt, setTt] = useState(defaultTiktok());
  const [creator, setCreator] = useState<social.TiktokCreatorInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !post) return;
    setError(null);
    setTitle(post.title ?? "");
    setCaption(post.caption ?? "");
    setWhen(toLocalInput(post.scheduled_at));
    setYt({ ...defaultYoutube(), ...(post.kind !== "tiktok" ? post.options : {}) } as social.YoutubeOptions);
    setTt({ ...defaultTiktok(), ...(post.kind === "tiktok" ? post.options : {}) } as social.TiktokOptions);
    setCreator(null);
    if (post.kind === "tiktok" && ["scheduled", "failed"].includes(post.status)) social.tiktokCreatorInfo(post.project.id).then(setCreator).catch(() => {});
  }, [open, post]);

  if (!post) return null;
  const isTiktok = post.kind === "tiktok";

  const save = async (andPublish: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await social.updatePost(post.id, { title, caption, scheduled_at: new Date(when).toISOString(), options: isTiktok ? tt : yt });
      if (andPublish) await social.publishPostNow(post.id);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{locked ? "Postagem" : "Editar postagem"} · {social.KIND_LABEL[post.kind]}</DialogTitle>
          <DialogDescription>{post.project.name}{post.project.username ? ` · ${post.project.username}` : ""}. Mover o item no Calendário também reagenda a publicação.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {post.status === "failed" && post.error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><strong>Falha ao publicar:</strong> {post.error}</div>
          )}
          {post.note && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">{post.note}</div>}

          <div className="space-y-1.5">
            <Label>{isTiktok ? "Título interno (opcional)" : "Título (YouTube)"}</Label>
            <Input value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label>{isTiktok ? "Legenda" : "Descrição"}</Label>
            <Textarea rows={5} value={caption} disabled={locked} onChange={(e) => setCaption(e.target.value)} maxLength={isTiktok ? 2200 : 5000} />
          </div>

          {!locked && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Quando publicar</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-auto" />
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-border p-3">
            {isTiktok ? (
              <TiktokFields value={tt} onChange={setTt} creator={creator} disabled={locked} />
            ) : (
              <YoutubeFields value={yt} onChange={setYt} disabled={locked} short={post.kind === "youtube_short"} />
            )}
          </div>

          {post.permalink && <a href={post.permalink} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Abrir no {social.PLATFORM_LABEL[post.platform]}</a>}
          {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">{error}</p>}
        </div>

        {!locked && (
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button variant="outline" onClick={() => save(true)} disabled={saving}>Publicar agora</Button>
            <Button onClick={() => save(false)} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
