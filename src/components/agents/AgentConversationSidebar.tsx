import { MoreHorizontal, Pencil, SquarePen, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/src/components/ui/dropdown-menu";
import type { ConversationSummary } from "@/src/services/agent-conversation.service";

interface AgentConversationSidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: number | null;
  disabled: boolean;
  onNew: () => void;
  onSelect: (id: number) => void;
  onRename: (id: number, currentTitle: string) => void;
  onDelete: (id: number) => void;
}

export function AgentConversationSidebar({
  conversations,
  activeConversationId,
  disabled,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: AgentConversationSidebarProps) {
  return (
    <div className={`hidden w-64 shrink-0 flex-col border-r md:flex ${disabled ? "pointer-events-none opacity-60" : ""}`}>
      <div className="p-2">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:bg-accent/60"
        >
          <SquarePen className="h-4 w-4 text-muted-foreground" /> Nova conversa
        </button>
      </div>
      <p className="px-4 pb-1 pt-2 text-xs font-medium text-muted-foreground">Recentes</p>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">Nenhuma conversa salva ainda.</p>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                c.id === activeConversationId ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <p className="min-w-0 flex-1 truncate">{c.title || "Nova conversa"}</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => onRename(c.id, c.title || "")}>
                    <Pencil className="h-4 w-4" /> Renomear
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(c.id)}>
                    <Trash2 className="h-4 w-4" /> Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
