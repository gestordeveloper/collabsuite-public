import { useState, useEffect } from "react";
import { UserPlus, Trash2, Lock, Globe } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import * as projectService from "@/src/services/project.service";
import * as funnelService from "@/src/services/funnel.service";
import { useTaskStore } from "@/src/store/task.store";
import type { ProjectUser, FunnelUser, Funnel } from "@/src/types";
import { UserAvatar } from "@/src/components/common/UserAvatar";

interface ManageFunnelAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  funnel: Funnel | null;
}

export function ManageFunnelAccessModal({ isOpen, onClose, projectId, funnel }: ManageFunnelAccessModalProps) {
  const [restricted, setRestricted] = useState(false);
  const [projectMembers, setProjectMembers] = useState<ProjectUser[]>([]);
  const [sharedUsers, setSharedUsers] = useState<FunnelUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);

  const funnelId = funnel?.id ?? null;

  useEffect(() => {
    if (!isOpen || !funnelId) return;
    setRestricted(funnel?.visibility === "restricted");
    projectService.fetchProjectUsers(projectId).then(setProjectMembers).catch(() => setProjectMembers([]));
    funnelService.fetchFunnelUsers(funnelId).then(setSharedUsers).catch(() => setSharedUsers([]));
    setSelectedUserId("");
  }, [isOpen, funnelId, projectId, funnel?.visibility]);

  async function refreshAppState() {
    await Promise.all([
      useTaskStore.getState().loadProjects(),
      useTaskStore.getState().loadFunnels(),
    ]);
  }

  async function handleToggleRestricted(checked: boolean) {
    if (!funnelId) return;
    setSavingVisibility(true);
    try {
      await funnelService.updateFunnel(funnelId, { visibility: checked ? "restricted" : "everyone" });
      setRestricted(checked);
      await refreshAppState();
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao alterar a visibilidade do funil.");
    } finally {
      setSavingVisibility(false);
    }
  }

  async function handleAdd() {
    if (!funnelId || !selectedUserId) return;
    setLoading(true);
    try {
      const added = await funnelService.addUserToFunnel(funnelId, Number(selectedUserId));
      setSharedUsers([...sharedUsers, added]);
      setSelectedUserId("");
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao conceder acesso.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(userId?: number) {
    if (!funnelId || !userId) return;
    if (!confirm("Remover o acesso deste usuário a este funil?")) return;
    try {
      await funnelService.removeUserFromFunnel(funnelId, userId);
      setSharedUsers(sharedUsers.filter((m) => m.user_id !== userId));
    } catch (err: any) {
      alert(err.response?.data?.error || "Falha ao remover acesso.");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {restricted ? <Lock className="h-5 w-5" /> : <Globe className="h-5 w-5" />} Acesso: {funnel?.name ?? ""}
          </DialogTitle>
          <DialogDescription>Defina quem pode ver e acessar este funil.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Restringir a pessoas específicas</p>
            <p className="text-xs text-muted-foreground">
              {restricted
                ? "Apenas o dono do projeto e as pessoas selecionadas abaixo veem este funil."
                : "Todos os membros do projeto podem ver este funil."}
            </p>
          </div>
          <Switch checked={restricted} onCheckedChange={handleToggleRestricted} disabled={savingVisibility} />
        </div>

        {restricted && (
          <>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="addFunnelUser">Conceder acesso a</Label>
                <select
                  id="addFunnelUser"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Selecione um membro do projeto...</option>
                  {projectMembers
                    .filter((m) => !sharedUsers.some((s) => s.user_id === m.user_id))
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id ?? ""}>
                        {m.user?.first_name} {m.user?.last_name ?? ""}
                      </option>
                    ))}
                </select>
              </div>
              <Button type="button" onClick={handleAdd} disabled={loading || !selectedUserId}>
                <UserPlus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <ScrollArea className="h-56 rounded-md border">
              {sharedUsers.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Ninguém tem acesso explícito ainda. Apenas o dono do projeto vê este funil.
                </p>
              ) : (
                <ul className="divide-y">
                  {sharedUsers.map((m) => (
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
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
