import { useState, useEffect } from "react";
import { UserPlus, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import * as projectService from "@/src/services/project.service";
import { fetchUsers } from "@/src/services/user.service";
import type { ProjectUser, User } from "@/src/types";
import { UserAvatar } from "@/src/components/common/UserAvatar";

interface ManageMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  projectName?: string | null;
  currentMembers?: ProjectUser[];
}

export function ManageMembersModal({ isOpen, onClose, projectId, projectName }: ManageMembersModalProps) {
  const [members, setMembers] = useState<ProjectUser[]>([]);
  const [allUsers, setAllUsers] = useState<Partial<User>[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    projectService.fetchProjectUsers(projectId).then(setMembers).catch(() => setMembers([]));
    fetchUsers().then(setAllUsers).catch(() => setAllUsers([]));
    setSelectedUserId("");
  }, [isOpen, projectId]);

  async function handleAdd() {
    if (!selectedUserId) return;
    setLoading(true);
    try {
      const added = await projectService.addUserToProject(projectId, Number(selectedUserId));
      setMembers([...members, added]);
      setSelectedUserId("");
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao adicionar membro.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(userId?: number) {
    if (!userId) return;
    if (!confirm("Remover este membro do projeto?")) return;
    try {
      await projectService.removeUserFromProject(projectId, userId);
      setMembers(members.filter((m) => m.user_id !== userId));
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao remover membro.");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Membros: {projectName ?? ""}
          </DialogTitle>
          <DialogDescription>Gerencie quem tem acesso a este projeto.</DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="addUser">Adicionar membro</Label>
            <select
              id="addUser"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Selecione um usuário...</option>
              {allUsers
                .filter((u) => !members.some((m) => m.user_id === u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name ?? ""}
                  </option>
                ))}
            </select>
          </div>
          <Button type="button" onClick={handleAdd} disabled={loading || !selectedUserId}>
            <UserPlus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>

        <ScrollArea className="h-64 rounded-md border">
          {members.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum membro além do proprietário.
            </p>
          ) : (
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <UserAvatar user={m.user} className="h-9 w-9" />
                    <div>
                      <p className="text-sm font-medium">{m.user?.first_name} {m.user?.last_name ?? ""}</p>
                      <p className="text-xs text-muted-foreground">@{m.user?.username ?? "user"}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleRemove(m.user_id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
