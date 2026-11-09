import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { ACCENT_COLORS } from "@/src/lib/design";
import { deleteTag, errorMessage, fetchTags, saveTag, type TicketTag } from "@/src/services/ticket.service";
import { TagChip } from "../helpers";
import { ColorPicker } from "./QueuesTab";

export function TagsTab({ onNotify }: { onNotify: (message: string) => void }) {
  const [tags, setTags] = useState<TicketTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(ACCENT_COLORS[1]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTags(await fetchTags());
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveTag(null, { name: name.trim(), color });
      setName("");
      void load();
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(tag: TicketTag) {
    if (!window.confirm(`Excluir a etiqueta "${tag.name}"? Ela sai de todas as conversas.`)) return;
    try {
      await deleteTag(tag.id);
      void load();
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <p className="max-w-xl text-sm text-muted-foreground">Etiquetas classificam as conversas (ex.: VIP, urgente, orçamento) e podem ser aplicadas manualmente ou pelo bot.</p>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} placeholder="Nome da nova etiqueta" maxLength={60} />
          <Button onClick={add} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}Adicionar
          </Button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      {loading ? (
        <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma etiqueta criada.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full border py-1 pl-1 pr-2">
              <TagChip tag={t} className="px-2.5 py-1 text-xs" />
              <button type="button" onClick={() => remove(t)} aria-label={`Excluir ${t.name}`} className="text-subtle hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
