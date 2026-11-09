import { useEffect, useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { PROVIDER_LABELS, PROVIDER_MODELS } from "@/src/lib/ai-providers";
import type { AiProvider } from "@/src/services/ai-credential.service";
import { updateAgent, type Agent } from "@/src/services/agent.service";
import { errorMessage } from "@/src/services/agent-channel.service";

/** Prompt-base para atendimento por WhatsApp (o mesmo do agent-davisantos). */
export const WHATSAPP_PROMPT_TEMPLATE = `Você é um assistente virtual de atendimento pelo WhatsApp.
Responda SEMPRE em português brasileiro.
Seja direto, amigável e profissional como um atendente humano.
NUNCA use markdown (sem **, ##, listas com -) — o WhatsApp exibe texto puro.
Use emojis com moderação para humanizar a conversa.
Mensagens curtas e diretas, quebre em linhas para facilitar leitura no celular.
Você tem memória das mensagens anteriores da conversa — use o contexto.
Se o usuário mandar áudio, a mensagem já chega transcrita — responda normalmente.
Se a mensagem começar com "Imagem enviada" ou "Sticker enviado", reaja ao conteúdo.
Nunca invente informações — se não souber algo, diga claramente.
Retorne APENAS o texto da resposta que será enviado ao usuário.`;

interface Props {
  agent: Agent;
  onSaved: (agent: Agent) => void;
  onEditMore: () => void;
  onNotify: (msg: string) => void;
}

export function AgentTab({ agent, onSaved, onEditMore, onNotify }: Props) {
  const [name, setName] = useState(agent.name);
  const [provider, setProvider] = useState<AiProvider>(agent.provider);
  const [model, setModel] = useState(agent.model);
  const [prompt, setPrompt] = useState(agent.system_prompt);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(agent.name);
    setProvider(agent.provider);
    setModel(agent.model);
    setPrompt(agent.system_prompt);
  }, [agent]);

  async function save() {
    if (!name.trim() || !prompt.trim()) return onNotify("Nome e prompt são obrigatórios.");
    setSaving(true);
    try {
      onSaved(await updateAgent(agent.id, { name: name.trim(), provider, model, system_prompt: prompt }));
      onNotify("Agente salvo.");
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h3 className="font-display text-lg font-semibold">Configuração do agente</h3>
      <div className="space-y-1.5">
        <Label>Nome do agente</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Davi Santos" />
        <p className="text-xs text-muted-foreground">No WhatsApp o agente recebe a instrução "Seu nome é …" antes do prompt.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Provedor de IA</Label>
          <Select
            value={provider}
            onValueChange={(p) => {
              setProvider(p as AiProvider);
              setModel(PROVIDER_MODELS[p as AiProvider][0].id);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Modelo</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_MODELS[provider].map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>System prompt</Label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPrompt(WHATSAPP_PROMPT_TEMPLATE)}>
            Usar modelo de WhatsApp
          </Button>
        </div>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={14} className="font-mono text-xs" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        <Button variant="outline" onClick={onEditMore}>
          Avatar, temperatura e ferramentas
        </Button>
      </div>
    </Card>
  );
}
