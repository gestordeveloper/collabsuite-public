import { Check, CheckCheck, FileText, MapPin, Reply, StickyNote, Trash2, Ban } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { accentFromString } from "@/src/lib/design";
import type { TicketMessage } from "@/src/services/ticket.service";
import { clockTime } from "./helpers";

interface Props {
  message: TicketMessage;
  /** Conversa em grupo: mostra o nome de quem escreveu. */
  isGroup: boolean;
  onReply: (m: TicketMessage) => void;
  onDelete: (m: TicketMessage) => void;
  onOpenImage: (url: string) => void;
}

const MEDIA_LABEL: Record<string, string> = { image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha" };

function Ack({ ack }: { ack: number }) {
  if (ack <= 0) return <Check className="h-3 w-3 opacity-40" />;
  if (ack === 1) return <Check className="h-3 w-3 opacity-70" />;
  if (ack === 2) return <CheckCheck className="h-3 w-3 opacity-70" />;
  return <CheckCheck className="h-3 w-3 text-sky-500" />;
}

function Media({ message, onOpenImage }: { message: TicketMessage; onOpenImage: (url: string) => void }) {
  const url = message.media_url;
  if (!url) {
    return message.media_type && MEDIA_LABEL[message.media_type] ? (
      <p className="text-xs italic opacity-70">{MEDIA_LABEL[message.media_type]} indisponível</p>
    ) : null;
  }
  switch (message.media_type) {
    case "image":
    case "sticker":
      return (
        <button type="button" onClick={() => onOpenImage(url)} className="block overflow-hidden rounded-lg">
          <img src={url} alt="" loading="lazy" className={cn("max-h-72 rounded-lg object-cover", message.media_type === "sticker" ? "h-32 w-32 bg-transparent object-contain" : "w-full")} />
        </button>
      );
    case "video":
      return <video src={url} controls preload="metadata" className="max-h-72 w-full rounded-lg" />;
    case "audio":
      return <audio src={url} controls preload="metadata" className="h-10 w-60 max-w-full" />;
    default:
      return (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2 text-sm hover:bg-black/15">
          <FileText className="h-5 w-5 shrink-0" />
          <span className="truncate">{message.media_name || "Documento"}</span>
        </a>
      );
  }
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all">
        {part}
      </a>
    ) : (
      part
    )
  );
}

export function MessageBubble({ message, isGroup, onReply, onDelete, onOpenImage }: Props) {
  const mine = message.from_me;
  const internal = message.is_internal;
  const senderName = internal || mine ? message.sender?.first_name : isGroup ? message.contact?.name : null;
  const isLocation = message.media_type === "location";

  return (
    <div className={cn("group flex w-full", mine || internal ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[82%] items-start gap-1 sm:max-w-[70%]", mine || internal ? "flex-row-reverse" : "flex-row")}>
        <div
          className={cn(
            "min-w-0 rounded-2xl px-3 py-2 text-sm shadow-sm",
            internal
              ? "border border-warning/40 bg-warning/10 text-foreground"
              : mine
                ? "rounded-br-md bg-primary/90 text-primary-foreground"
                : "rounded-bl-md bg-card text-card-foreground border"
          )}
        >
          {internal && (
            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-warning">
              <StickyNote className="h-3 w-3" /> Nota interna
            </p>
          )}
          {senderName && !internal && (
            <p className="mb-0.5 text-[11px] font-semibold" style={mine ? undefined : { color: accentFromString(senderName) }}>
              {senderName}
            </p>
          )}
          {internal && senderName && <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{senderName}</p>}

          {message.quoted && (
            <div className={cn("mb-1.5 rounded-lg border-l-4 px-2 py-1 text-xs", mine ? "border-white/60 bg-black/15" : "border-primary/60 bg-secondary")}>
              <p className="line-clamp-2 opacity-80">{message.quoted.body || (message.quoted.media_type && MEDIA_LABEL[message.quoted.media_type]) || "Mensagem"}</p>
            </div>
          )}

          {message.is_deleted ? (
            <p className="flex items-center gap-1.5 text-xs italic opacity-70">
              <Ban className="h-3.5 w-3.5" /> Mensagem apagada
            </p>
          ) : (
            <>
              <Media message={message} onOpenImage={onOpenImage} />
              {isLocation && message.body ? (
                <a href={message.body} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline underline-offset-2">
                  <MapPin className="h-4 w-4" /> Ver localização
                </a>
              ) : (
                message.body && <p className={cn("whitespace-pre-wrap break-words", message.media_url && "mt-1.5")}>{linkify(message.body)}</p>
              )}
            </>
          )}

          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", mine && !internal ? "text-primary-foreground/70" : "text-subtle")}>
            <span>{clockTime(message.created_at)}</span>
            {mine && !internal && <Ack ack={message.ack} />}
          </div>

          {message.reactions.length > 0 && (
            <div className="-mb-4 mt-1 flex gap-1">
              {message.reactions.map((r, i) => (
                <span key={i} className="rounded-full border bg-card px-1.5 py-0.5 text-xs shadow-sm">
                  {r.emoji}
                </span>
              ))}
            </div>
          )}
        </div>

        {!message.is_deleted && (
          <div className="flex shrink-0 flex-col gap-0.5 pt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {!internal && (
              <button type="button" onClick={() => onReply(message)} title="Responder" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Reply className="h-3.5 w-3.5" />
              </button>
            )}
            {(mine || internal) && (
              <button type="button" onClick={() => onDelete(message)} title={internal ? "Excluir nota" : "Apagar para todos"} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
