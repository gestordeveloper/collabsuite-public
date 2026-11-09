import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Users, Pencil, Trash2 } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { IcpFormModal } from "@/src/components/icps/IcpFormModal";
import * as icpService from "@/src/services/icp.service";
import type { Icp, IcpPayload } from "@/src/services/icp.service";

export function IcpsPage() {
  const navigate = useNavigate();
  const [icps, setIcps] = useState<Icp[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIcp, setEditingIcp] = useState<Icp | null>(null);

  useEffect(() => {
    icpService
      .fetchIcps()
      .then(setIcps)
      .finally(() => setLoading(false));
  }, []);

  function openCreate() {
    setEditingIcp(null);
    setModalOpen(true);
  }

  function openEdit(icp: Icp) {
    setEditingIcp(icp);
    setModalOpen(true);
  }

  async function handleSubmit(payload: IcpPayload) {
    if (editingIcp) {
      const updated = await icpService.updateIcp(editingIcp.id, payload);
      setIcps((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } else {
      const created = await icpService.createIcp(payload);
      setIcps((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    }
  }

  async function handleDelete(icp: Icp) {
    if (!confirm(`Excluir o ICP "${icp.name}"? Essa ação não pode ser desfeita.`)) return;
    await icpService.deleteIcp(icp.id);
    setIcps((prev) => prev.filter((i) => i.id !== icp.id));
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/agentes")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">ICPs (perfis de cliente ideal)</h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Cadastre seus públicos-alvo para os agentes usarem como referência nas conversas.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Novo ICP
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : icps.length === 0 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed bg-card py-20 text-center">
          <Users className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
          <p className="font-medium text-muted-foreground">Nenhum ICP cadastrado ainda.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cadastre um perfil de cliente ideal para os agentes consultarem via a ferramenta "Usar ICPs".
          </p>
          <Button onClick={openCreate} variant="secondary" size="sm" className="mt-4 gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Criar primeiro ICP
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {icps.map((icp) => (
            <Card key={icp.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{icp.name}</h3>
                    {icp.niche && (
                      <Badge variant="secondary" className="mt-0.5 text-[10px]">
                        {icp.niche}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(icp)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(icp)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{icp.description}</p>
            </Card>
          ))}
        </div>
      )}

      <IcpFormModal open={modalOpen} icp={editingIcp} onClose={() => setModalOpen(false)} onSubmit={handleSubmit} />
    </div>
  );
}
