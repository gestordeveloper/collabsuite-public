import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import * as funnelService from "@/src/services/funnel.service";
import { useTaskStore } from "@/src/store/task.store";

interface NewStageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewStageModal({ isOpen, onClose }: NewStageModalProps) {
  const selectedFunnelId = useTaskStore((s) => s.selectedFunnelId);
  const loadFunnels = useTaskStore((s) => s.loadFunnels);
  const [name, setName] = useState("");

  useEffect(() => {
    if (isOpen) setName("");
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFunnelId || !name.trim()) return;
    try {
      await funnelService.createStage(selectedFunnelId, name.trim());
      await loadFunnels();
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao criar coluna.");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova Coluna</DialogTitle>
          <DialogDescription>Adicione uma nova etapa ao funil.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stageName">Nome da Coluna *</Label>
            <Input id="stageName" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Em Revisão" required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Criar Coluna</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}