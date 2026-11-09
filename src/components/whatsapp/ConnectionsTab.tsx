import { useCallback, useEffect, useState } from "react";
import { Plus, QrCode, Smartphone, Unplug, Trash2, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  fetchConnections,
  createConnection,
  connectConnection,
  disconnectConnection,
  deleteConnection,
  renameConnection,
  type WhatsAppConnection,
} from "@/src/services/whatsappConnection.service";
import { useWhatsAppSocket } from "@/src/hooks/useWhatsAppSocket";

const STATUS_LABEL: Record<string, string> = {
  disconnected: "Desconectado",
  pairing: "Pareando…",
  connected: "Conectado",
  error: "Erro",
};

const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "destructive"> = {
  disconnected: "secondary",
  pairing: "warning",
  connected: "success",
  error: "destructive",
};

export function ConnectionsTab() {
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [qrDialogConnectionId, setQrDialogConnectionId] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<WhatsAppConnection | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await fetchConnections();
      setConnections(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fallback for the socket: while any connection is mid-pairing, keep the list fresh via polling.
  useEffect(() => {
    const hasPairing = connections.some((c) => c.status === "pairing");
    if (!hasPairing) return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [connections, load]);

  const handleQr = useCallback((event: { connectionId: number; qrDataUrl: string | null }) => {
    setConnections((prev) =>
      prev.map((c) => (c.id === event.connectionId ? { ...c, status: "pairing", qr_data_url: event.qrDataUrl } : c))
    );
    setQrDialogConnectionId(event.connectionId);
  }, []);

  const handleStatus = useCallback(
    (event: { connectionId: number; status: WhatsAppConnection["status"]; phoneNumber?: string | null }) => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === event.connectionId
            ? {
                ...c,
                status: event.status,
                phone_number: event.phoneNumber !== undefined ? event.phoneNumber || null : c.phone_number,
                qr_data_url: event.status === "connected" ? null : c.qr_data_url,
              }
            : c
        )
      );
      if (event.status === "connected") {
        setQrDialogConnectionId((current) => (current === event.connectionId ? null : current));
      }
    },
    []
  );

  useWhatsAppSocket(handleQr, handleStatus);

  async function handleCreate() {
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      const created = await createConnection(newLabel.trim());
      setConnections((prev) => [created, ...prev]);
      setNewLabel("");
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar conexão.");
    } finally {
      setCreating(false);
    }
  }

  function withBusy(id: number, fn: () => Promise<void>) {
    setBusyIds((prev) => new Set(prev).add(id));
    fn().finally(() => {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  function handleConnect(connection: WhatsAppConnection) {
    withBusy(connection.id, async () => {
      try {
        const updated = await connectConnection(connection.id);
        setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setQrDialogConnectionId(connection.id);
      } catch (err: any) {
        alert(err?.response?.data?.error || "Erro ao iniciar conexão.");
      }
    });
  }

  function handleDisconnect(connection: WhatsAppConnection) {
    withBusy(connection.id, async () => {
      try {
        const updated = await disconnectConnection(connection.id);
        setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      } catch (err: any) {
        alert(err?.response?.data?.error || "Erro ao desconectar.");
      }
    });
  }

  function handleDelete(connection: WhatsAppConnection) {
    if (!confirm(`Excluir a conexão "${connection.label}"? Campanhas associadas também serão excluídas.`)) return;
    withBusy(connection.id, async () => {
      try {
        await deleteConnection(connection.id);
        setConnections((prev) => prev.filter((c) => c.id !== connection.id));
      } catch (err: any) {
        alert(err?.response?.data?.error || "Erro ao excluir conexão.");
      }
    });
  }

  async function handleRenameSave() {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      const updated = await renameConnection(renameTarget.id, renameValue.trim());
      setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setRenameTarget(null);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao renomear conexão.");
    }
  }

  const qrConnection = connections.find((c) => c.id === qrDialogConnectionId) || null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova conexão</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Nome da conexão (ex: WhatsApp Comercial)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button onClick={handleCreate} disabled={creating || !newLabel.trim()} className="shrink-0">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar conexão
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Cada conexão é pessoal — pareie com um número de WhatsApp escaneando o QR Code, assim como você faria no WhatsApp Web.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando conexões…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conexão cadastrada.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {connections.map((connection) => {
            const busy = busyIds.has(connection.id);
            return (
              <Card key={connection.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{connection.label}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {connection.phone_number ? `+${connection.phone_number}` : "Nenhum número pareado"}
                        </p>
                      </div>
                    </div>
                    <Badge variant={STATUS_VARIANT[connection.status] || "secondary"}>
                      {STATUS_LABEL[connection.status] || connection.status}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    {connection.status === "connected" || connection.status === "pairing" ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleDisconnect(connection)}>
                        <Unplug className="h-4 w-4" />
                        Desconectar
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => handleConnect(connection)}>
                        <QrCode className="h-4 w-4" />
                        Conectar
                      </Button>
                    )}
                    {connection.status === "pairing" && connection.qr_data_url && (
                      <Button size="sm" variant="ghost" onClick={() => setQrDialogConnectionId(connection.id)}>
                        Ver QR Code
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenameTarget(connection);
                        setRenameValue(connection.label);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => handleDelete(connection)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!qrConnection} onOpenChange={(open) => !open && setQrDialogConnectionId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Escaneie o QR Code</DialogTitle>
            <DialogDescription>
              No WhatsApp do celular: Configurações → Aparelhos conectados → Conectar um aparelho.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-4">
            {qrConnection?.qr_data_url ? (
              <img src={qrConnection.qr_data_url} alt="QR Code do WhatsApp" className="w-56 h-56 rounded-md border" />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-muted-foreground text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Gerando QR Code…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear conexão</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-connection">Nome</Label>
            <Input
              id="rename-connection"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameSave()}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleRenameSave} disabled={!renameValue.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
