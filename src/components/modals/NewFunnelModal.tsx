import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import * as funnelService from "@/src/services/funnel.service";
import { useTaskStore } from "@/src/store/task.store";

interface NewFunnelModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number | null;
  onCreated?: (funnelId: number) => void;
}

export function NewFunnelModal({ isOpen, onClose, projectId, onCreated }: NewFunnelModalProps) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setPrefix("");
      setRestricted(false);
    }
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !name.trim()) return;
    setLoading(true);
    try {
      const created = await funnelService.createFunnel(projectId, {
        name: name.trim(),
        prefix: prefix || null,
        visibility: restricted ? "restricted" : "everyone",
      });
      useTaskStore.getState().addFunnel(created);
      await useTaskStore.getState().loadProjects();
      onCreated?.(created.id);
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao criar funil.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Novo Funil</DialogTitle>
          <DialogDescription>Crie um novo funil (quadro) dentro deste projeto.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="funnelName">Nome do Funil *</Label>
            <Input id="funnelName" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Funil de Suporte" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="funnelPrefix">Prefixo (Opcional)</Label>
            <Input id="funnelPrefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="Ex: DEV, MKT" maxLength={10} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Restringir a pessoas específicas</p>
              <p className="text-xs text-muted-foreground">Você pode escolher quem tem acesso depois de criar o funil.</p>
            </div>
            <Switch checked={restricted} onCheckedChange={setRestricted} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? "Criando..." : "Criar Funil"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
