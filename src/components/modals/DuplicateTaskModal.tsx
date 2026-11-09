import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import * as taskService from "@/src/services/task.service";
import { useTaskStore } from "@/src/store/task.store";
import type { Task } from "@/src/types";
import { useNavigate } from "react-router-dom";

interface DuplicateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
}

export function DuplicateTaskModal({ isOpen, onClose, task }: DuplicateTaskModalProps) {
  const funnels = useTaskStore((s) => s.funnels);
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);
  const navigate = useNavigate();

  const [targetFunnelId, setTargetFunnelId] = useState<number | "">("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && task) {
      setTargetFunnelId(task.funnel_id ?? "");
    }
  }, [isOpen, task]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || targetFunnelId === "") return;

    setIsLoading(true);
    try {
      const targetFunnel = funnels.find((f) => f.id === Number(targetFunnelId));
      const stageId = targetFunnel?.stages[0]?.id;

      const payload = {
        title: `Cópia de ${task.title}`,
        description: task.description,
        content: task.content,
        funnel_id: Number(targetFunnelId),
        stage_id: stageId ?? null,
        priority: task.priority,
        status: task.status ?? "todo",
        template: task.template,
        due_at: task.due_at,
        end_at: task.end_at,
        estimated_time: task.estimated_time,
        story_points: task.story_points,
      };

      const newTask = await taskService.createTask(payload);
      updateTaskInState(newTask);
      onClose();
      navigate(`/task/${newTask.id}`);
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao duplicar tarefa.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicar Tarefa</DialogTitle>
          <DialogDescription>
            Escolha o projeto de destino para a nova cópia.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project">Projeto / Funil de destino</Label>
            <select
              id="project"
              value={targetFunnelId}
              onChange={(e) => setTargetFunnelId(e.target.value === "" ? "" : Number(e.target.value))}
              className="flex h-10 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            >
              <option value="" disabled>Selecione um projeto...</option>
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancelar</Button>
            <Button type="submit" disabled={isLoading || targetFunnelId === ""}>
              {isLoading ? "Duplicando..." : "Duplicar Tarefa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
