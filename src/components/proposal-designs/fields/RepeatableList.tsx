import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/src/components/ui/button";

interface Props<T> {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  makeItem: () => T;
  renderItem: (item: T, index: number, update: (patch: Partial<T>) => void) => React.ReactNode;
  itemTitle?: (item: T, index: number) => string;
  addLabel?: string;
  minItems?: number;
}

export function RepeatableList<T>({
  label, items, onChange, makeItem, renderItem, itemTitle, addLabel = "Adicionar", minItems = 0,
}: Props<T>) {
  const list = items || [];

  function update(idx: number, patch: Partial<T>) {
    const next = [...list];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{label}</span>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onChange([...list, makeItem()])}>
          <Plus className="h-3 w-3" /> {addLabel}
        </Button>
      </div>
      <div className="space-y-3">
        {list.map((item, idx) => (
          <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground truncate">
                {itemTitle ? itemTitle(item, idx) : `Item ${idx + 1}`}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => move(idx, 1)} disabled={idx === list.length - 1} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  disabled={list.length <= minItems}
                  className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {renderItem(item, idx, (patch) => update(idx, patch))}
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nenhum item adicionado.</p>
        )}
      </div>
    </div>
  );
}
