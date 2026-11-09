import { MoreVertical, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/src/components/ui/dropdown-menu";
import { PROVIDER_LABELS } from "@/src/lib/ai-providers";
import type { Agent } from "@/src/services/agent.service";

interface AgentCardProps {
  agent: Agent;
  selected?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onManage?: () => void;
  onDelete: () => void;
}

export function AgentCard({ agent, selected, onOpen, onEdit, onManage, onDelete }: AgentCardProps) {
  return (
    <Card
      className={`group cursor-pointer p-3 transition-all hover:shadow-md hover:border-primary/40 ${
        selected ? "border-primary ring-1 ring-primary" : ""
      }`}
      onClick={onOpen}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
          style={{ backgroundColor: `${agent.avatar_color || "#6366f1"}22`, color: agent.avatar_color || "#6366f1" }}
        >
          {agent.avatar_emoji || "🤖"}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {PROVIDER_LABELS[agent.provider]} · {agent.model}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => e.stopPropagation()}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Editar
            </DropdownMenuItem>
            {onManage && (
              <DropdownMenuItem onClick={onManage}>
                <SlidersHorizontal className="h-4 w-4" /> WhatsApp, conhecimento e MCP
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {agent.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>}
    </Card>
  );
}
