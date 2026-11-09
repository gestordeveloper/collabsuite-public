import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { PROVIDER_LABELS, PROVIDER_MODELS, AVAILABLE_TOOLS, AGENT_AVATAR_COLORS, AGENT_AVATAR_EMOJIS } from "@/src/lib/ai-providers";
import type { AiProvider } from "@/src/services/ai-credential.service";
import type { Agent, AgentPayload } from "@/src/services/agent.service";

interface AgentFormModalProps {
  open: boolean;
  agent: Agent | null;
  onClose: () => void;
  onSubmit: (payload: AgentPayload) => Promise<void>;
}

const EMPTY_FORM: AgentPayload = {
  name: "",
  description: "",
  avatar_emoji: AGENT_AVATAR_EMOJIS[0],
  avatar_color: AGENT_AVATAR_COLORS[0],
  provider: "groq",
  model: PROVIDER_MODELS.groq[0].id,
  system_prompt: "",
  temperature: 0.7,
  max_tokens: 2048,
  allowed_tools: [],
};

export function AgentFormModal({ open, agent, onClose, onSubmit }: AgentFormModalProps) {
  const [form, setForm] = useState<AgentPayload>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(
        agent
          ? {
              name: agent.name,
              description: agent.description || "",
              avatar_emoji: agent.avatar_emoji || AGENT_AVATAR_EMOJIS[0],
              avatar_color: agent.avatar_color || AGENT_AVATAR_COLORS[0],
              provider: agent.provider,
              model: agent.model,
              system_prompt: agent.system_prompt,
              temperature: agent.temperature ?? 0.7,
              max_tokens: agent.max_tokens ?? 2048,
              allowed_tools: agent.allowed_tools || [],
            }
          : EMPTY_FORM
      );
      setError(null);
    }
  }, [open, agent]);

  function handleProviderChange(provider: string) {
    const models = PROVIDER_MODELS[provider as AiProvider];
    setForm((f) => ({ ...f, provider: provider as AiProvider, model: models[0].id }));
  }

  function toggleTool(name: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      allowed_tools: checked ? [...(f.allowed_tools || []), name] : (f.allowed_tools || []).filter((t) => t !== name),
    }));
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.system_prompt.trim()) {
      setError("Nome e prompt de sistema são obrigatórios.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível salvar o agente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agent ? "Editar agente" : "Novo agente"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl"
              style={{ backgroundColor: `${form.avatar_color}22`, color: form.avatar_color }}
            >
              {form.avatar_emoji}
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap gap-1">
                {AGENT_AVATAR_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, avatar_emoji: emoji }))}
                    className={`h-7 w-7 rounded-md text-sm hover:bg-accent ${form.avatar_emoji === emoji ? "bg-accent ring-1 ring-primary" : ""}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AGENT_AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, avatar_color: color }))}
                    className={`h-5 w-5 rounded-full ring-2 ring-offset-1 ring-offset-background ${
                      form.avatar_color === color ? "ring-foreground" : "ring-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Redator de propostas" />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Input
              value={form.description || ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Para que serve este agente"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Provedor</Label>
              <Select value={form.provider} onValueChange={handleProviderChange}>
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
              <Select value={form.model} onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_MODELS[form.provider].map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Prompt de sistema</Label>
            <Textarea
              value={form.system_prompt}
              onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              placeholder="Você é um assistente especializado em..."
              rows={5}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Temperatura</Label>
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(e) => setForm((f) => ({ ...f, temperature: parseFloat(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Máx. de tokens</Label>
              <Input
                type="number"
                min={1}
                max={32000}
                value={form.max_tokens}
                onChange={(e) => setForm((f) => ({ ...f, max_tokens: parseInt(e.target.value) }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Ferramentas permitidas</Label>
            <div className="space-y-2 rounded-lg border p-3">
              {AVAILABLE_TOOLS.map((tool) => (
                <label key={tool.name} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={(form.allowed_tools || []).includes(tool.name)}
                    onCheckedChange={(checked) => toggleTool(tool.name, !!checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{tool.label}</span>
                    <span className="block text-xs text-muted-foreground">{tool.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
