import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Loader2, Check, X } from "lucide-react";

export interface AgentPipelineNodeData extends Record<string, unknown> {
  agentId: number;
  name: string;
  provider: string;
  avatarEmoji?: string | null;
  avatarColor?: string | null;
  status?: "pending" | "running" | "done" | "error";
}

const handleClass = "!h-3 !w-3 !border-2 !border-white !bg-slate-400 dark:!border-slate-900";

const STATUS_BORDER: Record<string, string> = {
  pending: "border-border",
  running: "border-primary ring-2 ring-primary/30",
  done: "border-emerald-500",
  error: "border-destructive",
};

function AgentPipelineNodeComponent({ data, selected }: NodeProps<Node<AgentPipelineNodeData>>) {
  const status = data.status || "pending";
  return (
    <div
      className={`flex w-56 items-center gap-3 rounded-xl border-2 bg-card p-3 shadow-sm transition-colors ${STATUS_BORDER[status]} ${
        selected ? "ring-2 ring-offset-2 ring-offset-background ring-primary" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
        style={{ backgroundColor: `${data.avatarColor || "#6366f1"}22`, color: data.avatarColor || "#6366f1" }}
      >
        {data.avatarEmoji || "🤖"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{data.name}</p>
        <p className="text-xs text-muted-foreground capitalize">{data.provider}</p>
      </div>
      {status === "running" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
      {status === "done" && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
      {status === "error" && <X className="h-4 w-4 shrink-0 text-destructive" />}
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

export const pipelineNodeTypes = { agent: AgentPipelineNodeComponent };
