import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import * as ig from "@/src/services/instagram.service";
import { ProjectPicker } from "./ProjectPicker";
import { AutomationFields, emptyAutomation, toInput, type AutomationDraft } from "./AutomationFields";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ig.ProjectAccount[];
  defaultProjectId?: number | null;
  automation?: ig.InstagramAutomation | null;
  onSaved: () => void;
}

export function AutomationDialog({ open, onOpenChange, projects, defaultProjectId, automation, onSaved }: Props) {
  const editing = !!automation;
  const [projectId, setProjectId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<AutomationDraft>(emptyAutomation());
  const [media, setMedia] = useState<ig.IgMedia[] | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ig.IgMedia | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPicked(null);
    setTitle(automation?.title ?? "");
    setDraft(
      automation
        ? { keywords: automation.keywords, reply_text: automation.reply_text, ai_reply: automation.ai_reply, dm_text: automation.dm_text, cta_text: automation.cta_text, cta_link: automation.cta_link }
        : emptyAutomation()
    );
    const connected = projects.filter((p) => p.connected);
    setProjectId(automation?.project.id ?? (connected.find((p) => p.project_id === defaultProjectId) ?? (connected.length === 1 ? connected[0] : null))?.project_id ?? null);
  }, [open, automation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Os posts a escolher são os da conta do cliente selecionado.
  useEffect(() => {
    if (!open || automation) return;
    setMedia(null);
    setMediaError(null);
    setPicked(null);
    if (!projectId) return setMedia([]);
    let alive = true;
    ig.listMedia(projectId)
      .then((m) => alive && setMedia(m))
      .catch((e) => {
        if (!alive) return;
        setMedia([]);
        setMediaError(ig.errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [open, automation, projectId]);

  const submit = async () => {
    setError(null);
    if (!editing && !projectId) return setError("Selecione o cliente (projeto).");
    if (!editing && !picked) return setError("Selecione o post que vai disparar a automação.");
    setSaving(true);
    try {
      if (editing && automation) {
        await ig.updateAutomation(automation.id, { title, ...toInput(draft) });
      } else if (picked) {
        await ig.createAutomation({
          title,
          project_id: projectId!,
          ig_media_id: picked.id,
          post_image: picked.thumbnail_url || picked.media_url || null,
          post_caption: picked.caption ?? null,
          status: "active",
          ...toInput(draft),
        });
      }
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
          <DialogTitle>{editing ? "Editar automação" : "Nova automação de comentários"}</DialogTitle>
          <DialogDescription>Escolha o post, as palavras-chave e o que enviar a quem comentar.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} disabled={editing} />

          {!editing && (
            <div className="space-y-1.5">
              <Label>Post do Instagram</Label>
              {!projectId ? (
                <p className="text-sm text-muted-foreground">Selecione o cliente para ver os posts dele.</p>
              ) : media === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando seus posts…</div>
              ) : media.length === 0 ? (
                <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                  {mediaError ?? "Nenhum post encontrado."} Para automatizar um post que ainda vai ser publicado, ative “Automatizar comentários” ao agendá-lo.
                </p>
              ) : (
                <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                  {media.map((m) => {
                    const src = m.thumbnail_url || m.media_url;
                    const on = picked?.id === m.id;
                    return (
                      <button key={m.id} type="button" onClick={() => setPicked(m)} title={m.caption?.slice(0, 120)} className={cn("relative aspect-square overflow-hidden rounded-lg border bg-subtle", on ? "border-primary ring-2 ring-primary" : "border-border")}>
                        {src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />}
                        {on && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" /></span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {picked?.caption && <p className="line-clamp-2 text-xs text-muted-foreground">“{picked.caption}”</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Nome da automação</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Ebook gratuito — post de lançamento" maxLength={120} />
          </div>

          <AutomationFields value={draft} onChange={setDraft} />
          {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "Salvar" : "Criar e ativar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
