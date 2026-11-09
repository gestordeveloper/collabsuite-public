import { Loader2 } from "lucide-react";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { cn } from "@/src/lib/utils";
import type { TiktokCreatorInfo, TiktokOptions, YoutubeOptions } from "@/src/services/social.service";

export const defaultYoutube = (): YoutubeOptions => ({ privacy: "public", tags: [], category_id: "22", made_for_kids: false });
export const defaultTiktok = (): TiktokOptions => ({ mode: "direct", privacy_level: "SELF_ONLY", disable_comment: false, disable_duet: false, disable_stitch: false });

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Público",
  MUTUAL_FOLLOW_FRIENDS: "Amigos (seguidores mútuos)",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Só eu (privado)",
};

const selectCls = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-60";

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex items-center justify-between gap-3 text-sm", disabled && "opacity-50")}>
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

export function YoutubeFields({ value, onChange, disabled, short }: { value: YoutubeOptions; onChange: (v: YoutubeOptions) => void; disabled?: boolean; short?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Visibilidade</Label>
        <select className={selectCls} disabled={disabled} value={value.privacy} onChange={(e) => onChange({ ...value, privacy: e.target.value as YoutubeOptions["privacy"] })}>
          <option value="public">Público</option>
          <option value="unlisted">Não listado</option>
          <option value="private">Privado</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Tags (separe por vírgula)</Label>
        <Input disabled={disabled} value={value.tags.join(", ")} onChange={(e) => onChange({ ...value, tags: e.target.value.split(",").map((t) => t.trimStart()) })} placeholder="marketing, dicas" />
      </div>
      <div className="sm:col-span-2">
        <Toggle label="Conteúdo feito para crianças (exigência do YouTube)" checked={value.made_for_kids} onChange={(v) => onChange({ ...value, made_for_kids: v })} disabled={disabled} />
      </div>
      {short && <p className="text-xs text-muted-foreground sm:col-span-2">Shorts: vídeo vertical (9:16) de até 3 minutos. A hashtag #Shorts é adicionada à descrição automaticamente.</p>}
    </div>
  );
}

export function TiktokFields({ value, onChange, creator, loading, creatorError, disabled }: {
  value: TiktokOptions;
  onChange: (v: TiktokOptions) => void;
  creator: TiktokCreatorInfo | null;
  loading?: boolean;
  creatorError?: string | null;
  disabled?: boolean;
}) {
  const options = creator?.privacy_level_options?.length ? creator.privacy_level_options : ["SELF_ONLY"];
  const privacy = options.includes(value.privacy_level) ? value.privacy_level : options[0];
  const draft = value.mode === "draft";
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Como enviar</Label>
          <select className={selectCls} disabled={disabled} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as TiktokOptions["mode"] })}>
            <option value="direct">Publicar direto</option>
            <option value="draft">Enviar para o rascunho (finalizo no app)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">Privacidade {loading && <Loader2 className="h-3 w-3 animate-spin" />}</Label>
          <select className={selectCls} disabled={disabled || draft} value={privacy} onChange={(e) => onChange({ ...value, privacy_level: e.target.value })}>
            {options.map((o) => <option key={o} value={o}>{PRIVACY_LABEL[o] ?? o}</option>)}
          </select>
        </div>
      </div>
      {!draft && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Toggle label="Bloquear comentários" checked={value.disable_comment || !!creator?.comment_disabled} onChange={(v) => onChange({ ...value, disable_comment: v })} disabled={disabled || creator?.comment_disabled} />
          <Toggle label="Bloquear dueto" checked={value.disable_duet || !!creator?.duet_disabled} onChange={(v) => onChange({ ...value, disable_duet: v })} disabled={disabled || creator?.duet_disabled} />
          <Toggle label="Bloquear stitch" checked={value.disable_stitch || !!creator?.stitch_disabled} onChange={(v) => onChange({ ...value, disable_stitch: v })} disabled={disabled || creator?.stitch_disabled} />
        </div>
      )}
      {creatorError && <p className="text-xs text-amber-500">{creatorError}</p>}
      {!creatorError && options.length === 1 && options[0] === "SELF_ONLY" && !draft && (
        <p className="text-xs text-muted-foreground">Esta conta só pode publicar como privado por enquanto (app do TikTok sem auditoria ou conta privada).</p>
      )}
      {creator && <p className="text-xs text-muted-foreground">Duração máxima nesta conta: {Math.round(creator.max_video_post_duration_sec / 60)} min.</p>}
    </div>
  );
}
