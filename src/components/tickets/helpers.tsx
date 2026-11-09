import { Users } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { accentFromString, softTagStyle } from "@/src/lib/design";
import type { ChatContact, TicketTag, TicketUserBrief } from "@/src/services/ticket.service";

export const CLOSE_REASONS = [
  { value: "suporte", label: "Suporte" },
  { value: "comercial", label: "Comercial" },
  { value: "duvida", label: "Dúvida" },
  { value: "financeiro", label: "Financeiro" },
  { value: "spam", label: "Spam / engano" },
  { value: "outro", label: "Outro" },
];

export const SENTIMENTS = [
  { value: "very_dissatisfied", label: "Muito insatisfeito", emoji: "😡" },
  { value: "dissatisfied", label: "Insatisfeito", emoji: "🙁" },
  { value: "neutral", label: "Neutro", emoji: "😐" },
  { value: "satisfied", label: "Satisfeito", emoji: "🙂" },
  { value: "very_satisfied", label: "Muito satisfeito", emoji: "😍" },
];

export const TICKET_PRIORITIES = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
];

export function personName(u?: { first_name?: string | null; last_name?: string | null } | null): string {
  return `${u?.first_name ?? ""} ${u?.last_name ?? ""}`.trim() || "—";
}

export function formatPhone(number: string | null | undefined): string {
  if (!number) return "";
  const d = number.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    return `+55 (${ddd}) ${rest.length === 9 ? `${rest.slice(0, 5)}-${rest.slice(5)}` : `${rest.slice(0, 4)}-${rest.slice(4)}`}`;
  }
  return `+${d}`;
}

/** "14:32" hoje, "Ontem", ou "12/10" — o formato compacto da lista de conversas. */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (date.getTime() >= startOfToday - 86_400_000) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (startOfDay === startOfToday) return "Hoje";
  if (startOfDay === startOfToday - 86_400_000) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function ContactAvatar({ contact, className }: { contact: Pick<ChatContact, "name" | "profile_pic_url" | "is_group">; className?: string }) {
  if (contact.profile_pic_url) {
    return <img src={contact.profile_pic_url} alt={contact.name} className={cn("h-10 w-10 shrink-0 rounded-full object-cover", className)} loading="lazy" />;
  }
  if (contact.is_group) {
    return (
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground", className)}>
        <Users className="h-1/2 w-1/2" />
      </div>
    );
  }
  const initials = contact.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
  return (
    <div
      className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-[#0B0B0D]", className)}
      style={{ backgroundColor: accentFromString(contact.name) }}
    >
      {initials || "?"}
    </div>
  );
}

export function TagChip({ tag, className }: { tag: Pick<TicketTag, "name" | "color">; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none", className)} style={softTagStyle(tag.color)}>
      {tag.name}
    </span>
  );
}

export function QueueChip({ queue }: { queue: { name: string; color: string } | null }) {
  if (!queue) return <span className="text-[10px] font-medium text-subtle">Sem fila</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: queue.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: queue.color }} />
      {queue.name}
    </span>
  );
}

export function userInitialsName(u?: TicketUserBrief | null) {
  return personName(u);
}
