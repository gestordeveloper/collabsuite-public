import { useCallback, useEffect, useState } from "react";
import { Plug, Trash2, Zap } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { Textarea } from "@/src/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { useAuthStore } from "@/src/store/auth.store";
import {
  createMcpServer,
  deleteMcpServer,
  errorMessage,
  fetchMcpServers,
  testMcpServer,
  updateMcpServer,
  type McpServer,
} from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  onNotify: (msg: string) => void;
}

const parseEnv = (text: string) =>
  Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );

export function McpTab({ agentId, onNotify }: Props) {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin" || s.user?.role === "super_admin");
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<Record<number, string>>({});
  const [type, setType] = useState<"url" | "stdio">("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");

  const load = useCallback(() => fetchMcpServers(agentId).then(setServers).catch((e) => onNotify(errorMessage(e))), [agentId, onNotify]);
  useEffect(() => void load(), [load]);

  async function add() {
    try {
      await createMcpServer(agentId, {
        name,
        type,
        ...(type === "url"
          ? { url, authorization_token: token || undefined }
          : { command, args: args.split(/\s+/).filter(Boolean), env: parseEnv(env) }),
      });
      setName("");
      setUrl("");
      setToken("");
      setCommand("");
      setArgs("");
      setEnv("");
      await load();
      onNotify("Servidor MCP adicionado.");
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  async function test(s: McpServer) {
    setTools((t) => ({ ...t, [s.id]: "Testando…" }));
    try {
      const r = await testMcpServer(agentId, s.id);
      setTools((t) => ({ ...t, [s.id]: r.ok ? (r.tools.length ? r.tools.map((x) => x.name).join(", ") : "Conectado, sem ferramentas.") : `Falhou: ${r.error}` }));
    } catch (err) {
      setTools((t) => ({ ...t, [s.id]: errorMessage(err) }));
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h3 className="font-display text-lg font-semibold">Servidores MCP configurados</h3>
        <p className="text-xs text-muted-foreground">As ferramentas dos servidores habilitados ficam disponíveis para este agente em cada conversa.</p>
        {servers.length === 0 && <p className="text-sm text-muted-foreground">Nenhum servidor configurado.</p>}
        {servers.map((s) => (
          <div key={s.id} className="space-y-1 rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.name} <span className="text-xs font-normal text-muted-foreground">({s.type})</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{s.type === "url" ? s.url : `${s.command} ${s.args.join(" ")}`}</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => test(s)}>
                <Zap className="h-3.5 w-3.5" /> Testar
              </Button>
              <Switch
                checked={s.enabled}
                onCheckedChange={(enabled) =>
                  updateMcpServer(agentId, s.id, { enabled })
                    .then(load)
                    .catch((e) => onNotify(errorMessage(e)))
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() =>
                  deleteMcpServer(agentId, s.id)
                    .then(load)
                    .catch((e) => onNotify(errorMessage(e)))
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {tools[s.id] && <p className="break-words pl-7 text-xs text-muted-foreground">{tools[s.id]}</p>}
          </div>
        ))}
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-display text-lg font-semibold">Adicionar servidor MCP</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: agenda" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as "url" | "stdio")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="url">URL (HTTP)</SelectItem>
                <SelectItem value="stdio" disabled={!isAdmin}>
                  Comando local (stdio){isAdmin ? "" : " — só admin"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {type === "url" ? (
          <>
            <div className="space-y-1.5">
              <Label>URL do servidor</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meu-mcp.exemplo.com/mcp" />
            </div>
            <div className="space-y-1.5">
              <Label>Authorization (opcional)</Label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer xxxxx" />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Comando</Label>
              <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </div>
            <div className="space-y-1.5">
              <Label>Argumentos (separados por espaço)</Label>
              <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /dados" />
            </div>
            <div className="space-y-1.5">
              <Label>Variáveis de ambiente (CHAVE=valor, uma por linha)</Label>
              <Textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} />
            </div>
          </>
        )}
        <Button onClick={add}>Adicionar</Button>
      </Card>
    </div>
  );
}
