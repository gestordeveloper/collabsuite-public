import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pause, Play, Plus, Trash2, Send } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent } from "@/src/components/ui/card";
import { Progress } from "@/src/components/ui/progress";
import { CampaignComposeDialog } from "@/src/components/whatsapp/CampaignComposeDialog";
import {
  fetchCampaigns,
  fetchCampaignRecipients,
  scheduleCampaign,
  pauseCampaign,
  deleteCampaign,
  type WhatsAppCampaign,
  type WhatsAppCampaignRecipient,
} from "@/src/services/whatsappCampaign.service";

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  sending: "Enviando…",
  paused: "Pausada",
  done: "Concluída",
  failed: "Falhou",
};

const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "destructive" | "default"> = {
  draft: "secondary",
  scheduled: "default",
  sending: "warning",
  paused: "secondary",
  done: "success",
  failed: "destructive",
};

export function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchCampaigns();
      setCampaigns(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasActive = campaigns.some((c) => c.status === "sending" || c.status === "scheduled");
    if (!hasActive) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [campaigns, load]);

  async function handlePause(campaign: WhatsAppCampaign) {
    try {
      const updated = await pauseCampaign(campaign.id);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao pausar campanha.");
    }
  }

  async function handleResume(campaign: WhatsAppCampaign) {
    try {
      const updated = await scheduleCampaign(campaign.id, campaign.scheduled_at);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao retomar campanha.");
    }
  }

  async function handleDelete(campaign: WhatsAppCampaign) {
    if (!confirm(`Excluir a campanha "${campaign.name}"?`)) return;
    try {
      await deleteCampaign(campaign.id);
      setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao excluir campanha.");
    }
  }

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) || null;
  if (selectedCampaign) {
    return <CampaignDetail campaign={selectedCampaign} onBack={() => setSelectedCampaignId(null)} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setComposeOpen(true)}>
          <Plus className="h-4 w-4" />
          Nova campanha
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando campanhas…</p>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma campanha cadastrada.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {campaigns.map((campaign) => {
            const counts = campaign.recipient_counts;
            const total = counts.pending + counts.sent + counts.failed + counts.skipped;
            const done = counts.sent + counts.failed + counts.skipped;
            const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <Card key={campaign.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedCampaignId(campaign.id)}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{campaign.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {total} destinatário(s) · {counts.sent} enviado(s) · {counts.failed} falha(s) · {counts.skipped} ignorado(s)
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[campaign.status] || "secondary"}>{STATUS_LABEL[campaign.status] || campaign.status}</Badge>
                  </div>

                  {total > 0 && <Progress value={progressPct} className="mt-3 h-1.5" />}

                  <div className="flex flex-wrap items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                    {(campaign.status === "scheduled" || campaign.status === "sending") && (
                      <Button size="sm" variant="outline" onClick={() => handlePause(campaign)}>
                        <Pause className="h-4 w-4" />
                        Pausar
                      </Button>
                    )}
                    {campaign.status === "paused" && (
                      <Button size="sm" variant="outline" onClick={() => handleResume(campaign)}>
                        <Play className="h-4 w-4" />
                        Retomar
                      </Button>
                    )}
                    {campaign.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => handleResume(campaign)}>
                        <Send className="h-4 w-4" />
                        Agendar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(campaign)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CampaignComposeDialog open={composeOpen} onOpenChange={setComposeOpen} onCreated={load} />
    </div>
  );
}

const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
};

const RECIPIENT_STATUS_VARIANT: Record<string, "secondary" | "success" | "destructive" | "outline"> = {
  pending: "secondary",
  sent: "success",
  failed: "destructive",
  skipped: "outline",
};

function CampaignDetail({ campaign, onBack }: { campaign: WhatsAppCampaign; onBack: () => void }) {
  const [recipients, setRecipients] = useState<WhatsAppCampaignRecipient[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchCampaignRecipients(campaign.id);
      setRecipients(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [campaign.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (campaign.status !== "sending") return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [campaign.status, load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <h3 className="font-semibold text-lg">{campaign.name}</h3>
        <Badge variant={STATUS_VARIANT[campaign.status] || "secondary"}>{STATUS_LABEL[campaign.status] || campaign.status}</Badge>
      </div>

      <Card>
        <CardContent className="pt-6 text-sm whitespace-pre-wrap">{campaign.message}</CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando destinatários…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-muted-foreground">
                <th className="p-3 font-medium">Nome</th>
                <th className="p-3 font-medium">Telefone</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Enviado em</th>
                <th className="p-3 font-medium">Erro</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{r.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3">{r.phone}</td>
                  <td className="p-3">
                    <Badge variant={RECIPIENT_STATUS_VARIANT[r.status] || "secondary"}>{RECIPIENT_STATUS_LABEL[r.status] || r.status}</Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{r.sent_at ? new Date(r.sent_at).toLocaleString("pt-BR") : "—"}</td>
                  <td className="p-3 text-xs text-destructive">{r.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
