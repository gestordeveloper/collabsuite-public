import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useEffect } from "react";
import { ListChecks, Check, X, Plus } from "lucide-react";
import type { TaskChecklist as TaskChecklistType } from "@/src/types";

const isDone = (val: any) => val === true || val === 1;

const TaskChecklistComponent = ({ editor }: NodeViewProps) => {
  const storage = (editor.storage as any).taskChecklist as {
    checklists: TaskChecklistType[];
    onAddChecklist: ((title: string) => Promise<void>) | null;
    onToggleChecklist: ((itemId: number, is_done: boolean) => Promise<void>) | null;
    onDeleteChecklist: ((itemId: number) => Promise<void>) | null;
  };
  const { checklists, onAddChecklist, onToggleChecklist, onDeleteChecklist } = storage;
  const [newItem, setNewItem] = useState("");
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const handleTransaction = () => forceUpdate((x) => x + 1);
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.trim() || !onAddChecklist) return;
    await onAddChecklist(newItem.trim());
    setNewItem("");
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="my-4 select-none rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-emerald-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Checklist</span>
          {checklists.length > 0 && (
            <span className="ml-auto text-[10px] font-medium text-muted-foreground">
              {checklists.filter((i) => isDone(i.is_done)).length}/{checklists.length}
            </span>
          )}
        </div>

        <div className="space-y-1">
          {checklists.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nenhum item ainda.</p>}
          {checklists.map((item: any) => (
            <div key={item.id} className="group flex items-center justify-between rounded-lg px-1 py-1.5 transition-all hover:bg-accent">
              <div className="flex items-center gap-2.5">
                <button
                  disabled={!editor.isEditable}
                  onClick={() => onToggleChecklist?.(item.id, !isDone(item.is_done))}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${isDone(item.is_done) ? "border-emerald-500 bg-emerald-500 text-white" : "border-input hover:border-emerald-500"} ${!editor.isEditable ? "cursor-default" : ""}`}
                >
                  {isDone(item.is_done) && <Check className="h-3 w-3" />}
                </button>
                <span className={`text-sm ${isDone(item.is_done) ? "text-muted-foreground line-through" : ""}`}>{item.title}</span>
              </div>
              {editor.isEditable && (
                <button onClick={() => onDeleteChecklist?.(item.id)} className="p-1 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        {editor.isEditable && (
          <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
            <div className="flex flex-grow items-center gap-2">
              <Plus className="h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Adicionar item..."
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                className="flex-grow border-b border-transparent bg-transparent px-0 py-1 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <button type="submit" className="rounded px-2 py-1 text-xs font-medium text-primary transition-all hover:bg-primary/10">Inserir</button>
          </form>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const TaskChecklistExtension = Node.create({
  name: "taskChecklist",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {};
  },

  addStorage() {
    return {
      checklists: [] as TaskChecklistType[],
      onAddChecklist: null as ((title: string) => Promise<void>) | null,
      onToggleChecklist: null as ((itemId: number, is_done: boolean) => Promise<void>) | null,
      onDeleteChecklist: null as ((itemId: number) => Promise<void>) | null,
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='task-checklist']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "task-checklist", ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskChecklistComponent);
  },
});