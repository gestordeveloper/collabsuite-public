import { useEffect, useState } from "react";
import { KeyRound, Building2, User as UserIcon, Trash2, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Badge } from "@/src/components/ui/badge";
import { useAuthStore } from "@/src/store/auth.store";
import { LocalCliSettings } from "./LocalCliSettings";
import {
  fetchAiCredentialStatus,
  savePersonalAiCredential,
  deletePersonalAiCredential,
  saveCompanyAiCredential,
  deleteCompanyAiCredential,
  type AiCredentialStatus,
  type AiCredentialScopeStatus,
  type AiProvider,
} from "@/src/services/ai-credential.service";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Claude (Anthropic)",
  openrouter: "OpenRouter",
};

const PROVIDER_HINTS: Record<AiProvider, string> = {
  groq: "console.groq.com/keys",
  openai: "platform.openai.com/api-keys",
  anthropic: "console.anthropic.com/settings/keys",
  openrouter: "openrouter.ai/keys",
};

type ScopeKey = "company" | "personal";

function ScopeRow({
  scope,
  provider,
  status,
  editable,
  onSave,
  onDelete,
}: {
  scope: ScopeKey;
  provider: AiProvider;
  status: AiCredentialScopeStatus | null;
  editable: boolean;
  onSave: (apiKey: string, label: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await onSave(apiKey.trim(), label.trim());
      setApiKey("");
      setLabel("");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  }

  const Icon = scope === "company" ? Building2 : UserIcon;
  const scopeLabel = scope === "company" ? "Credencial da empresa" : "Minha credencial pessoal";

  return (
    <div className="rounded-xl border p-3 bg-muted/10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none">{scopeLabel}</p>
            {status?.configured ? (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {status.label || "Sem apelido"} · atualizado em {new Date(status.updated_at).toLocaleDateString("pt-BR")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">Não configurada</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status?.configured && (
            <Badge variant="success" className="gap-1">
              <Check className="h-3 w-3" /> Ativa
            </Badge>
          )}
          {editable && !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={saving}>
              {status?.configured ? "Trocar chave" : "Configurar"}
            </Button>
          )}
          {editable && status?.configured && (
            <Button size="sm" variant="ghost" onClick={handleDelete} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
            </Button>
          )}
        </div>
      </div>

      {editable && editing && (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3">
          <Input
            type="password"
            placeholder={`Cole a API key da ${PROVIDER_LABELS[provider]} (${PROVIDER_HINTS[provider]})`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoFocus
          />
          <Input placeholder="Apelido (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !apiKey.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function IntegrationSettings() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [statuses, setStatuses] = useState<AiCredentialStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchAiCredentialStatus();
      setStatuses(data);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar as credenciais.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border p-4 bg-muted/10">
        <KeyRound className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          Cadastre as chaves de API dos provedores de IA usados pelos seus agentes. Uma chave pessoal sempre tem
          prioridade sobre a chave da empresa quando ambas estiverem configuradas.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!statuses ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <div className="space-y-4">
          {statuses.map((status) => (
            <Card key={status.provider}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{PROVIDER_LABELS[status.provider]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ScopeRow
                  scope="company"
                  provider={status.provider}
                  status={status.company}
                  editable={isAdmin}
                  onSave={async (apiKey, label) => {
                    await saveCompanyAiCredential(status.provider, apiKey, label);
                    await load();
                  }}
                  onDelete={async () => {
                    await deleteCompanyAiCredential(status.provider);
                    await load();
                  }}
                />
                {!isAdmin && !status.company?.configured && (
                  <p className="text-xs text-muted-foreground pl-1">
                    Somente administradores podem configurar a credencial da empresa.
                  </p>
                )}
                <ScopeRow
                  scope="personal"
                  provider={status.provider}
                  status={status.personal}
                  editable
                  onSave={async (apiKey, label) => {
                    await savePersonalAiCredential(status.provider, apiKey, label);
                    await load();
                  }}
                  onDelete={async () => {
                    await deletePersonalAiCredential(status.provider);
                    await load();
                  }}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LocalCliSettings />
    </div>
  );
}
