import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Megaphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { AgentFormModal } from "@/src/components/agents/AgentFormModal";
import { CalendarTab } from "@/src/components/agents/manage/CalendarTab";
import { DashboardTab } from "@/src/components/agents/manage/DashboardTab";
import { AgentTab } from "@/src/components/agents/manage/AgentTab";
import { KnowledgeTab } from "@/src/components/agents/manage/KnowledgeTab";
import { McpTab } from "@/src/components/agents/manage/McpTab";
import { RecordingsTab } from "@/src/components/agents/manage/RecordingsTab";
import { SessionsTab } from "@/src/components/agents/manage/SessionsTab";
import { TelegramTab } from "@/src/components/agents/manage/TelegramTab";
import { WhatsAppTab } from "@/src/components/agents/manage/WhatsAppTab";
import { fetchAgent, updateAgent, type Agent, type AgentPayload } from "@/src/services/agent.service";
import { errorMessage, fetchChannelSettings, type ChannelSettings } from "@/src/services/agent-channel.service";

/** Painel do agente (equivalente ao "Painel Admin" do agent-davisantos): uma tela por agente. */
export function AgentManagePage() {
  const { id } = useParams();
  const agentId = Number(id);
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [settings, setSettings] = useState<ChannelSettings | null>(null);
  const [tab, setTab] = useState("agent");
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const loadSettings = useCallback(() => fetchChannelSettings(agentId).then(setSettings).catch((e) => notify(errorMessage(e))), [agentId, notify]);

  useEffect(() => {
    fetchAgent(agentId)
      .then(setAgent)
      .catch(() => navigate("/agentes", { replace: true }));
    loadSettings();
  }, [agentId, navigate, loadSettings]);

  if (!agent) return <p className="p-8 text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 md:p-8">
      <Link to="/agentes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar aos agentes
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl"
          style={{ backgroundColor: `${agent.avatar_color || "#6366f1"}22`, color: agent.avatar_color || "#6366f1" }}
        >
          {agent.avatar_emoji || "🤖"}
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">{agent.name}</h2>
          <p className="text-sm text-muted-foreground">
            {settings?.channel_enabled ? "Atendendo no WhatsApp" : "Atendimento por WhatsApp desligado"}
            {settings?.rag_enabled ? " · RAG ativo" : ""}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="knowledge">Base de Conhecimento</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="calendar">Agenda</TabsTrigger>
          <TabsTrigger value="recordings">Gravações</TabsTrigger>
          <TabsTrigger value="sessions">Sessões</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
          <TabsTrigger value="campaign">Disparo</TabsTrigger>
        </TabsList>
        <TabsContent value="agent" className="mt-6">
          <AgentTab agent={agent} onSaved={setAgent} onEditMore={() => setMoreOpen(true)} onNotify={notify} />
        </TabsContent>
        <TabsContent value="dashboard" className="mt-6">
          <DashboardTab agentId={agentId} onNotify={notify} />
        </TabsContent>
        <TabsContent value="calendar" className="mt-6">
          <CalendarTab agentId={agentId} onNotify={notify} />
        </TabsContent>
        <TabsContent value="recordings" className="mt-6">
          <RecordingsTab agentId={agentId} enabled={!!settings?.recordings_enabled} onEnabledChange={(v) => setSettings((s) => (s ? { ...s, recordings_enabled: v } : s))} onNotify={notify} />
        </TabsContent>
        <TabsContent value="knowledge" className="mt-6">
          <KnowledgeTab agentId={agentId} ragEnabled={!!settings?.rag_enabled} onRagChange={(v) => setSettings((s) => (s ? { ...s, rag_enabled: v } : s))} onNotify={notify} />
        </TabsContent>
        <TabsContent value="mcp" className="mt-6">
          <McpTab agentId={agentId} onNotify={notify} />
        </TabsContent>
        <TabsContent value="sessions" className="mt-6">
          <SessionsTab agentId={agentId} ttlSeconds={settings?.session_ttl_seconds ?? 3600} onTtlChange={(v) => setSettings((s) => (s ? { ...s, session_ttl_seconds: v } : s))} onNotify={notify} />
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-6">
          <WhatsAppTab agentId={agentId} onNotify={notify} onChanged={loadSettings} />
        </TabsContent>
        <TabsContent value="telegram" className="mt-6">
          <TelegramTab agentId={agentId} onNotify={notify} />
        </TabsContent>
        <TabsContent value="campaign" className="mt-6">
          <Card className="space-y-3 p-5">
            <h3 className="font-display text-lg font-semibold">Disparo de mensagens</h3>
            <p className="text-sm text-muted-foreground">
              As campanhas (listas de contatos, template com {"{nome}"}, intervalos e envio em lote) ficam no módulo WhatsApp e usam qualquer
              conexão sua — inclusive a deste agente. Quando o contato responder a um disparo feito pelo número do agente, ele continua a conversa.
            </p>
            <Button asChild className="gap-2">
              <Link to="/whatsapp">
                <Megaphone className="h-4 w-4" /> Abrir campanhas do WhatsApp
              </Link>
            </Button>
          </Card>
        </TabsContent>
      </Tabs>

      <AgentFormModal
        open={moreOpen}
        agent={agent}
        onClose={() => setMoreOpen(false)}
        onSubmit={async (payload: AgentPayload) => setAgent(await updateAgent(agent.id, payload))}
      />

      {notice && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-card px-4 py-2 text-sm shadow-lg">{notice}</div>}
    </div>
  );
}
