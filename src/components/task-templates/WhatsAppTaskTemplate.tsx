import { useState, useEffect, useCallback } from "react";
import {
  MessageCircle, Users, Hash, Phone, Image as ImageIcon, Video, Music, FileText as FileIcon,
  Send, Clock, X, Loader2, AlertTriangle, CheckCircle2, RotateCcw, Upload,
} from "lucide-react";
import type { Task } from "@/src/types";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { useTaskStore } from "@/src/store/task.store";
import * as taskService from "@/src/services/task.service";
import * as attachmentService from "@/src/services/attachment.service";
import * as connectionService from "@/src/services/whatsappConnection.service";
import * as contactService from "@/src/services/whatsappContact.service";
import * as campaignService from "@/src/services/whatsappCampaign.service";
import type { WhatsAppConnection, WhatsAppGroupSummary } from "@/src/services/whatsappConnection.service";
import type { WhatsAppContactList } from "@/src/services/whatsappContact.service";
import type { WhatsAppCampaign, WhatsAppMediaType } from "@/src/services/whatsappCampaign.service";
import { toBrazilInputValue, fromBrazilInputValue, formatBrazilDateTime } from "@/src/lib/brazilTime";

interface Props {
  task: Task;
}

type TargetType = "group" | "list" | "number";

const MEDIA_OPTIONS: { type: WhatsAppMediaType; label: string; icon: React.ElementType; accept: string }[] = [
  { type: "image", label: "Imagem", icon: ImageIcon, accept: "image/*" },
  { type: "video", label: "Vídeo", icon: Video, accept: "video/*" },
  { type: "audio", label: "Áudio", icon: Music, accept: "audio/*" },
  { type: "document", label: "PDF", icon: FileIcon, accept: "application/pdf" },
];

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Programada",
  sending: "Enviando",
  paused: "Pausada",
  done: "Concluída",
  failed: "Falhou",
};

export function WhatsAppTaskTemplate({ task }: Props) {
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);

  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<WhatsAppCampaign | null>(null);
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [lists, setLists] = useState<WhatsAppContactList[]>([]);
  const [groups, setGroups] = useState<WhatsAppGroupSummary[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  const [connectionId, setConnectionId] = useState<number | "">("");
  const [targetType, setTargetType] = useState<TargetType>("number");
  const [groupJid, setGroupJid] = useState("");
  const [listId, setListId] = useState<number | "">("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [mediaType, setMediaType] = useState<WhatsAppMediaType | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFilename, setMediaFilename] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const [scheduleValue, setScheduleValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocked = !!campaign && campaign.status !== "draft";

  const loadEverything = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [existing, conns, contactLists] = await Promise.all([
        campaignService.fetchCampaignForTask(task.id),
        connectionService.fetchConnections(),
        contactService.fetchLists(),
      ]);
      setConnections(conns);
      setLists(contactLists);
      setCampaign(existing);

      if (existing) {
        setConnectionId(existing.connection_id);
        setMessage(existing.message);
        setMediaType(existing.media_type);
        setMediaUrl(existing.media_url);
        setMediaFilename(existing.media_filename);
        setScheduleValue(toBrazilInputValue(existing.scheduled_at));
        if (existing.group_jid) {
          setTargetType("group");
          setGroupJid(existing.group_jid);
        } else if (existing.list_id) {
          setTargetType("list");
          setListId(existing.list_id);
        } else {
          setTargetType("number");
          const recipients = await campaignService.fetchCampaignRecipients(existing.id);
          setPhone(recipients[0]?.phone || "");
        }
      } else if (conns.length > 0) {
        setConnectionId(conns[0].id);
      }
    } catch (err) {
      console.error("Failed to load WhatsApp task data", err);
      setError("Não foi possível carregar os dados do WhatsApp.");
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => {
    loadEverything();
  }, [loadEverything]);

  useEffect(() => {
    if (targetType !== "group" || !connectionId) return;
    setLoadingGroups(true);
    connectionService.fetchGroups(Number(connectionId))
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoadingGroups(false));
  }, [targetType, connectionId]);

  async function handleMediaSelect(type: WhatsAppMediaType, file: File) {
    setUploadingMedia(true);
    setError(null);
    try {
      const { url } = await attachmentService.uploadFile(file);
      setMediaType(type);
      setMediaUrl(url);
      setMediaFilename(file.name);
    } catch (err) {
      console.error("Media upload failed", err);
      setError("Falha ao enviar o arquivo de mídia.");
    } finally {
      setUploadingMedia(false);
    }
  }

  function removeMedia() {
    setMediaType(null);
    setMediaUrl(null);
    setMediaFilename(null);
  }

  function buildPayload(): campaignService.CampaignPayload | null {
    if (!connectionId) {
      setError("Selecione uma conexão do WhatsApp.");
      return null;
    }
    if (targetType === "group" && !groupJid) {
      setError("Selecione um grupo.");
      return null;
    }
    if (targetType === "list" && !listId) {
      setError("Selecione uma lista de contatos.");
      return null;
    }
    if (targetType === "number" && !phone.trim()) {
      setError("Informe o número de telefone.");
      return null;
    }
    if (!mediaType && !message.trim()) {
      setError("Escreva uma mensagem de texto ou anexe uma mídia.");
      return null;
    }
    setError(null);
    return {
      connection_id: Number(connectionId),
      name: task.title || `WhatsApp — tarefa ${task.id}`,
      message: message.trim(),
      group_jid: targetType === "group" ? groupJid : null,
      list_id: targetType === "list" ? Number(listId) : null,
      recipients: targetType === "number" ? [{ phone: phone.trim() }] : undefined,
      media_url: mediaUrl,
      media_type: mediaType,
      media_filename: mediaFilename,
    };
  }

  async function handleSave(): Promise<WhatsAppCampaign | null> {
    const payload = buildPayload();
    if (!payload) return null;
    setSaving(true);
    try {
      const saved = await campaignService.upsertCampaignForTask(task.id, payload);
      setCampaign(saved);
      return saved;
    } catch (err: any) {
      setError(err?.response?.data?.error || "Falha ao salvar a mensagem.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSchedule() {
    if (!scheduleValue) {
      setError("Escolha a data e hora do envio.");
      return;
    }
    setScheduling(true);
    setError(null);
    try {
      const saved = await handleSave();
      if (!saved) return;
      const isoDate = fromBrazilInputValue(scheduleValue);
      const scheduled = await campaignService.scheduleCampaign(saved.id, isoDate);
      setCampaign(scheduled);
      const freshTask = await taskService.fetchTask(task.id);
      updateTaskInState(freshTask);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Falha ao programar o envio.");
    } finally {
      setScheduling(false);
    }
  }

  async function handleUnschedule() {
    if (!campaign) return;
    setScheduling(true);
    setError(null);
    try {
      const back = await campaignService.unscheduleCampaign(campaign.id);
      setCampaign(back);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Falha ao cancelar o agendamento.");
    } finally {
      setScheduling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  const selectedMediaOption = MEDIA_OPTIONS.find((m) => m.type === mediaType);
  const counts = campaign?.recipient_counts;

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-2 md:px-0">
      {campaign && campaign.status !== "draft" && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          <MessageCircle className="h-3 w-3" />
          {STATUS_LABEL[campaign.status] || campaign.status}
        </span>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {connections.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          Você ainda não tem nenhuma conexão de WhatsApp. Vá em <strong>WhatsApp → Conexões</strong> no menu lateral para parear seu número antes de continuar.
        </div>
      )}

      <fieldset disabled={isLocked || saving || scheduling} className="space-y-5 disabled:opacity-60">
        {/* Conexão */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Enviar pela conexão</Label>
          <select
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value ? Number(e.target.value) : "")}
            className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm focus:outline-none"
          >
            <option value="">Selecione...</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} {c.status === "connected" ? `— ${c.phone_number || "conectado"}` : `(${c.status})`}
              </option>
            ))}
          </select>
        </div>

        {/* Destino */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Destino</Label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "number" as TargetType, label: "Número", icon: Phone },
              { id: "list" as TargetType, label: "Contatos", icon: Users },
              { id: "group" as TargetType, label: "Grupo", icon: Hash },
            ].map((opt) => {
              const Icon = opt.icon;
              const active = targetType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTargetType(opt.id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                    active ? "border-primary bg-primary/5 text-primary" : "border-input hover:bg-accent"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {opt.label}
                </button>
              );
            })}
          </div>

          {targetType === "number" && (
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex: 5511999999999"
              className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm focus:outline-none"
            />
          )}

          {targetType === "list" && (
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value ? Number(e.target.value) : "")}
              className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm focus:outline-none"
            >
              <option value="">Selecione uma lista...</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l._count ? `(${l._count.contacts} contatos)` : ""}
                </option>
              ))}
            </select>
          )}

          {targetType === "group" && (
            <select
              value={groupJid}
              onChange={(e) => setGroupJid(e.target.value)}
              disabled={loadingGroups || !connectionId}
              className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm focus:outline-none disabled:opacity-60"
            >
              <option value="">{loadingGroups ? "Carregando grupos..." : "Selecione um grupo..."}</option>
              {groups.map((g) => (
                <option key={g.jid} value={g.jid}>
                  {g.subject} ({g.participantCount})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Mídia */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Anexo (opcional)</Label>
          {mediaUrl && selectedMediaOption ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
              <selectedMediaOption.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate text-xs">{mediaFilename || selectedMediaOption.label}</span>
              <button type="button" onClick={removeMedia} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {MEDIA_OPTIONS.map((opt) => (
                <label
                  key={opt.type}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed py-2.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <opt.icon className="h-4 w-4" />}
                  {opt.label}
                  <input
                    type="file"
                    accept={opt.accept}
                    className="hidden"
                    disabled={uploadingMedia}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleMediaSelect(opt.type, file);
                      e.target.value = "";
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Mensagem */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">
            {mediaType && mediaType !== "audio" ? "Legenda (opcional)" : mediaType === "audio" ? "Mensagem (não aparece junto do áudio)" : "Mensagem"}
          </Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder={targetType === "list" ? "Use {{nome}} para personalizar com o nome de cada contato..." : "Escreva a mensagem..."}
          />
        </div>

        {/* Salvar rascunho */}
        {!isLocked && (
          <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Salvar rascunho
          </Button>
        )}
      </fieldset>

      {/* Programação */}
      <div className="space-y-2 border-t pt-4">
        <Label className="text-xs font-semibold flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Programar envio</Label>
        {isLocked ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <Send className="h-3.5 w-3.5 text-primary" />
              {campaign?.scheduled_at ? formatBrazilDateTime(campaign.scheduled_at) : "Assim que possível"}
            </span>
            {campaign && (campaign.status === "scheduled" || campaign.status === "paused") && (
              <Button type="button" variant="ghost" size="sm" onClick={handleUnschedule} disabled={scheduling} className="ml-auto h-7 gap-1.5 text-xs">
                <RotateCcw className="h-3 w-3" /> Cancelar agendamento
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={scheduleValue}
              onChange={(e) => setScheduleValue(e.target.value)}
              className="h-9 rounded-md border border-input bg-surface px-3 text-sm focus:outline-none"
            />
            <Button type="button" size="sm" onClick={handleSchedule} disabled={scheduling || saving} className="gap-1.5">
              {scheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Programar
            </Button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          A tarefa aparece na agenda no horário programado. O envio respeita o limite de ritmo configurado na conexão para reduzir o risco de bloqueio.
        </p>
      </div>

      {/* Progresso de envio */}
      {counts && campaign && campaign.status !== "draft" && (
        <div className="space-y-2 border-t pt-4">
          <Label className="text-xs font-semibold">Progresso</Label>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1"><Clock className="h-3 w-3" /> {counts.pending} pendente(s)</span>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-1"><CheckCircle2 className="h-3 w-3" /> {counts.sent} enviada(s)</span>
            {counts.failed > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2.5 py-1"><AlertTriangle className="h-3 w-3" /> {counts.failed} falhou(aram)</span>
            )}
            {counts.skipped > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">{counts.skipped} ignorada(s) (opt-out)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
