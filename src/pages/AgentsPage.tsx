import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Plus, Workflow, Images, Users, ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/src/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/src/components/ui/dropdown-menu";
import { AgentCard } from "@/src/components/agents/AgentCard";
import { AgentFormModal } from "@/src/components/agents/AgentFormModal";
import { AgentChatPlayground } from "@/src/components/agents/AgentChatPlayground";
import * as agentService from "@/src/services/agent.service";
import type { Agent, AgentPayload } from "@/src/services/agent.service";

export function AgentsPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  function load() {
    agentService
      .fetchAgents()
      .then((data) => {
        setAgents(data);
        setSelected((prev) => {
          if (prev) return data.find((a) => a.id === prev.id) || data[0] || null;
          return data[0] || null;
        });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditingAgent(null);
    setModalOpen(true);
  }

  function openEdit(agent: Agent) {
    setEditingAgent(agent);
    setModalOpen(true);
  }

  async function handleSubmit(payload: AgentPayload) {
    if (editingAgent) {
      const updated = await agentService.updateAgent(editingAgent.id, payload);
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setSelected((prev) => (prev?.id === updated.id ? updated : prev));
    } else {
      const created = await agentService.createAgent(payload);
      setAgents((prev) => [created, ...prev]);
      setSelected(created);
      setManageOpen(false);
    }
  }

  async function handleDelete(agent: Agent) {
    if (!confirm(`Excluir o agente "${agent.name}"? Essa ação não pode ser desfeita.`)) return;
    await agentService.deleteAgent(agent.id);
    const remaining = agents.filter((a) => a.id !== agent.id);
    setAgents(remaining);
    setSelected((prev) => (prev?.id === agent.id ? remaining[0] || null : prev));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-4">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="min-w-[180px] justify-between gap-2 text-base font-medium">
              <span className="flex min-w-0 items-center gap-2">
                {selected ? (
                  <>
                    <span className="text-base leading-none">{selected.avatar_emoji || "🤖"}</span>
                    <span className="truncate">{selected.name}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Selecione um agente</span>
                )}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
            {agents.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">Nenhum agente criado ainda.</div>
            ) : (
              agents.map((agent) => (
                <DropdownMenuItem key={agent.id} onClick={() => setSelected(agent)} className="gap-2">
                  <span className="text-base leading-none">{agent.avatar_emoji || "🤖"}</span>
                  <span className="truncate">{agent.name}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={openCreate} className="gap-1.5 text-muted-foreground">
          <Plus className="h-3.5 w-3.5" /> Novo agente
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" onClick={() => navigate("/agentes/icps")} className="gap-1.5 text-muted-foreground">
          <Users className="h-4 w-4" /> ICPs
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("/agentes/galeria")} className="gap-1.5 text-muted-foreground">
          <Images className="h-4 w-4" /> Galeria
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("/agentes/pipelines")} className="gap-1.5 text-muted-foreground">
          <Workflow className="h-4 w-4" /> Pipelines
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setManageOpen(true)} className="gap-1.5 text-muted-foreground">
          <Settings2 className="h-4 w-4" /> Gerenciar
        </Button>
      </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando...</div>
        ) : selected ? (
          <AgentChatPlayground key={selected.id} agent={selected} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-sm text-muted-foreground">
            <Bot className="h-10 w-10 text-muted-foreground/60" />
            <p>Nenhum agente criado ainda.</p>
            <Button onClick={openCreate} variant="secondary" size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Criar primeiro agente
            </Button>
          </div>
        )}
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" /> Gerenciar agentes
            </DialogTitle>
            <DialogDescription>Crie, edite ou exclua seus agentes de IA.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Novo agente
            </Button>
          </div>
          {agents.length === 0 ? (
            <div className="rounded-xl border border-dashed py-16 text-center">
              <Bot className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
              <p className="font-medium text-muted-foreground">Nenhum agente criado ainda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selected?.id === agent.id}
                  onOpen={() => {
                    setSelected(agent);
                    setManageOpen(false);
                  }}
                  onEdit={() => openEdit(agent)}
                  onManage={() => navigate(`/agentes/${agent.id}/gerenciar`)}
                  onDelete={() => handleDelete(agent)}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AgentFormModal open={modalOpen} agent={editingAgent} onClose={() => setModalOpen(false)} onSubmit={handleSubmit} />
    </div>
  );
}
