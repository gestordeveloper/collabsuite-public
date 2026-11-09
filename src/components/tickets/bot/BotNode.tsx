import { useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/src/lib/utils";
import { hexA } from "@/src/lib/design";
import { NODE_META, summarize, type NodeType } from "./nodeMeta";

export type BotNodeData = Record<string, any> & { __isStart?: boolean };
export type BotFlowNode = Node<BotNodeData, NodeType>;

const handleClass = "!h-3 !w-3 !border-2 !border-background";

export function BotNode({ id, type, data, selected }: NodeProps<BotFlowNode>) {
  const meta = NODE_META[type as NodeType];
  const updateInternals = useUpdateNodeInternals();
  const options: { id: string; label: string }[] = type === "menu" ? data.options || [] : [];
  const optionKey = options.map((o) => o.id).join("|");

  // Os pontos de saída do menu mudam com as opções: o React Flow precisa recalcular as posições.
  useEffect(() => {
    updateInternals(id);
  }, [id, optionKey, updateInternals]);

  if (!meta) return null;
  const Icon = meta.icon;

  const outputs: { id?: string; label?: string; color?: string }[] =
    type === "menu"
      ? options.map((o) => ({ id: o.id, label: o.label }))
      : type === "condition"
        ? [{ id: "true", label: "Sim", color: "#2BD47D" }, { id: "false", label: "Não", color: "#FF5C5C" }]
        : type === "http_request"
          ? [{ id: "success", label: "Sucesso", color: "#2BD47D" }, { id: "error", label: "Erro", color: "#FF5C5C" }]
          : meta.terminal
            ? []
            : [{}];

  return (
    <div className={cn("w-60 rounded-xl border bg-card text-card-foreground shadow-md transition-shadow", selected && "ring-2 ring-primary")}>
      <Handle type="target" position={Position.Top} className={cn(handleClass, "!bg-subtle")} />
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ backgroundColor: hexA(meta.color, 0.12) }}>
        <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
        <span className="flex-1 truncate text-xs font-semibold">{meta.label}</span>
        {data.__isStart && <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">Início</span>}
      </div>
      <p className="line-clamp-3 px-3 py-2 text-xs text-muted-foreground">{summarize(type as NodeType, data)}</p>

      {outputs.length > 0 && outputs[0].id && (
        <div className="flex border-t">
          {outputs.map((o, i) => (
            <div key={o.id} className="relative flex-1 truncate px-2 pb-3 pt-1.5 text-center text-[10px] font-medium text-muted-foreground" style={i > 0 ? { borderLeft: "1px solid hsl(var(--border))" } : undefined}>
              {o.label}
              <Handle type="source" id={o.id} position={Position.Bottom} style={{ left: "50%", backgroundColor: o.color ?? "#EC1889" }} className={handleClass} />
            </div>
          ))}
        </div>
      )}
      {outputs.length === 1 && !outputs[0].id && <Handle type="source" position={Position.Bottom} className={cn(handleClass, "!bg-primary")} />}
    </div>
  );
}

export const botNodeTypes = Object.fromEntries(Object.keys(NODE_META).map((t) => [t, BotNode])) as Record<NodeType, typeof BotNode>;
