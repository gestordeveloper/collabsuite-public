import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Switch } from "@/src/components/ui/switch";
import * as projectService from "@/src/services/project.service";
import { useTaskStore } from "@/src/store/task.store";
import type { Project } from "@/src/types";

interface EditProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
}

const PRESET_COLORS = ["#EC1889", "#9B7BFF", "#4C9BFF", "#2DD4BF", "#F7B32B", "#2BD47D", "#FF5A5F", "#8A8A94"];

export function EditProjectModal({ isOpen, onClose, project }: EditProjectModalProps) {
  const updateProjectInState = useTaskStore((s) => s.updateProjectInState);
  const [form, setForm] = useState({ name: "", content: "", color: "#EC1889", favorite: false, is_default_project: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name,
        content: project.content ?? "",
        color: project.color ?? "#EC1889",
        favorite: !!project.favorite,
        is_default_project: !!project.is_default_project,
      });
    }
  }, [project]);

  if (!project) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !form.name.trim()) return;
    setLoading(true);
    try {
      const updated = await projectService.updateProject(project.id, {
        name: form.name.trim(),
        content: form.content,
        color: form.color,
        favorite: form.favorite,
        is_default_project: form.is_default_project,
      });
      updateProjectInState(updated);
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao atualizar projeto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Projeto</DialogTitle>
          <DialogDescription>Atualize as informações do projeto.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="editName">Nome do Projeto *</Label>
            <Input id="editName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editContent">Descrição</Label>
            <Textarea id="editContent" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-background ${form.color === c ? "ring-foreground" : "ring-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-8 w-8 cursor-pointer rounded-md border" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="favorite">Projeto Favorito</Label>
              <p className="text-xs text-muted-foreground">Destaque o projeto no dashboard.</p>
            </div>
            <Switch id="favorite" checked={form.favorite} onCheckedChange={(c) => setForm({ ...form, favorite: c })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="is_default_project">Projeto Padrão</Label>
              <p className="text-xs text-muted-foreground">Define este projeto como o inicial da plataforma.</p>
            </div>
            <Switch id="is_default_project" checked={form.is_default_project} onCheckedChange={(c) => setForm({ ...form, is_default_project: c })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
