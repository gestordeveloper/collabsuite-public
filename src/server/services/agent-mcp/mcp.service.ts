import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentMcpServer } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt, decrypt } from "../../lib/encryption";
import type { ToolDefinition } from "../../lib/ai-providers/types";

const LIST_TOOLS_TIMEOUT_MS = 10_000;
const CALL_TOOL_TIMEOUT_MS = 30_000;

export interface McpServerInput {
  name: string;
  type?: "url" | "stdio";
  url?: string | null;
  authorization_token?: string | null;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

/** Visão segura para o front: tokens e variáveis de ambiente nunca saem do servidor. */
function toSafe(s: AgentMcpServer) {
  let args: string[] = [];
  try {
    args = s.args ? JSON.parse(s.args) : [];
  } catch {
    /* ignora */
  }
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    url: s.url,
    command: s.command,
    args,
    enabled: s.enabled,
    has_token: !!s.auth_token,
    has_env: !!s.env,
  };
}

export async function listMcpServers(agentId: number) {
  const rows = await prisma.agentMcpServer.findMany({ where: { agent_id: agentId }, orderBy: { id: "asc" } });
  return rows.map(toSafe);
}

function validate(data: McpServerInput, canUseStdio: boolean) {
  if (!data.name?.trim()) throw new HttpError("O campo 'name' é obrigatório.");
  if ((data.type ?? "url") === "url") {
    if (!data.url?.trim()) throw new HttpError("O campo 'url' é obrigatório para servidores do tipo URL.");
    if (!/^https?:\/\//i.test(data.url)) throw new HttpError("A URL do servidor MCP deve começar com http:// ou https://.");
  } else {
    // stdio executa um comando no servidor da aplicação: restrito a administradores.
    if (!canUseStdio) throw new HttpError("Somente administradores podem cadastrar servidores MCP do tipo stdio.", 403);
    if (!data.command?.trim()) throw new HttpError("O campo 'command' é obrigatório para servidores stdio.");
  }
}

export async function createMcpServer(agentId: number, data: McpServerInput, canUseStdio: boolean) {
  validate(data, canUseStdio);
  const dup = await prisma.agentMcpServer.findFirst({ where: { agent_id: agentId, name: data.name.trim() } });
  if (dup) throw new HttpError(`Servidor MCP '${data.name}' já existe.`);
  const type = data.type ?? "url";
  const row = await prisma.agentMcpServer.create({
    data: {
      agent_id: agentId,
      name: data.name.trim(),
      type,
      enabled: data.enabled ?? true,
      url: type === "url" ? data.url!.trim() : null,
      auth_token: type === "url" && data.authorization_token ? encrypt(data.authorization_token) : null,
      command: type === "stdio" ? data.command!.trim() : null,
      args: type === "stdio" ? JSON.stringify(data.args ?? []) : null,
      env: type === "stdio" && data.env && Object.keys(data.env).length ? encrypt(JSON.stringify(data.env)) : null,
    },
  });
  return toSafe(row);
}

export async function updateMcpServer(agentId: number, id: number, data: Partial<McpServerInput>, canUseStdio: boolean) {
  const row = await prisma.agentMcpServer.findFirst({ where: { id, agent_id: agentId } });
  if (!row) throw new HttpError("Servidor MCP não encontrado.", 404);
  if (row.type === "stdio" && !canUseStdio) throw new HttpError("Somente administradores podem alterar servidores MCP do tipo stdio.", 403);
  const updated = await prisma.agentMcpServer.update({
    where: { id },
    data: {
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.url !== undefined && row.type === "url" ? { url: data.url } : {}),
      ...(data.authorization_token !== undefined && row.type === "url"
        ? { auth_token: data.authorization_token ? encrypt(data.authorization_token) : null }
        : {}),
      ...(data.command !== undefined && row.type === "stdio" ? { command: data.command } : {}),
      ...(data.args !== undefined && row.type === "stdio" ? { args: JSON.stringify(data.args) } : {}),
    },
  });
  return toSafe(updated);
}

export async function deleteMcpServer(agentId: number, id: number) {
  const row = await prisma.agentMcpServer.findFirst({ where: { id, agent_id: agentId } });
  if (!row) throw new HttpError("Servidor MCP não encontrado.", 404);
  await prisma.agentMcpServer.delete({ where: { id } });
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Timeout: ${what}`)), ms))]);

async function connect(server: AgentMcpServer): Promise<Client> {
  const client = new Client({ name: "collabsuite-agent", version: "1.0.0" });
  if (server.type === "url") {
    const headers: Record<string, string> = {};
    if (server.auth_token) headers.Authorization = decrypt(server.auth_token);
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url as string), { requestInit: { headers } }));
  } else {
    const env = server.env ? (JSON.parse(decrypt(server.env)) as Record<string, string>) : {};
    await client.connect(
      new StdioClientTransport({
        command: server.command as string,
        args: server.args ? JSON.parse(server.args) : [],
        env: { ...(process.env as Record<string, string>), ...env },
      })
    );
  }
  return client;
}

const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

export interface McpToolset {
  definitions: ToolDefinition[];
  /** Retorna null quando a ferramenta não pertence ao MCP. */
  execute(name: string, args: Record<string, unknown>): Promise<string | null>;
  close(): Promise<void>;
}

/** Abre uma sessão por servidor habilitado UMA vez por turno do agente e a reaproveita em todas as
 *  chamadas de ferramenta (o modelo de referência reabre a sessão a cada chamada). Falha de um servidor
 *  não derruba o atendimento: ele só fica sem as ferramentas daquele servidor. */
export async function openMcpToolset(agentId: number): Promise<McpToolset | null> {
  const servers = await prisma.agentMcpServer.findMany({ where: { agent_id: agentId, enabled: true } });
  if (!servers.length) return null;

  const definitions: ToolDefinition[] = [];
  const routes = new Map<string, { client: Client; original: string }>();
  const clients: Client[] = [];

  for (const server of servers) {
    try {
      const client = await withTimeout(connect(server), LIST_TOOLS_TIMEOUT_MS, `conectar ao MCP '${server.name}'`);
      clients.push(client);
      const { tools } = await withTimeout(client.listTools(), LIST_TOOLS_TIMEOUT_MS, `listar tools de '${server.name}'`);
      for (const t of tools) {
        const name = sanitize(t.name);
        if (routes.has(name)) continue; // primeira definição vence, como no modelo de referência
        routes.set(name, { client, original: t.name });
        definitions.push({
          name,
          description: t.description || "",
          parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
        });
      }
    } catch (err: any) {
      console.warn(`[agent-mcp] Falha no servidor MCP '${server.name}':`, err?.message || err);
    }
  }

  if (!clients.length) return null;
  return {
    definitions,
    async execute(name, args) {
      const route = routes.get(name);
      if (!route) return null;
      try {
        const result: any = await withTimeout(
          route.client.callTool({ name: route.original, arguments: args }),
          CALL_TOOL_TIMEOUT_MS,
          `executar '${name}'`
        );
        const parts: string[] = [];
        for (const item of result.content ?? []) {
          if (item.type === "text") parts.push(item.text);
          else if (item.mimeType) parts.push(`[dado binário: ${item.mimeType}]`);
        }
        return parts.join("\n") || "(sem resultado)";
      } catch (err: any) {
        console.warn(`[agent-mcp] Erro ao executar '${name}':`, err?.message || err);
        return `Erro ao executar a ferramenta '${name}'`;
      }
    },
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}

/** Teste do painel: conecta e devolve as ferramentas expostas pelo servidor. */
export async function testMcpServer(agentId: number, id: number) {
  const row = await prisma.agentMcpServer.findFirst({ where: { id, agent_id: agentId } });
  if (!row) throw new HttpError("Servidor MCP não encontrado.", 404);
  let client: Client | null = null;
  try {
    client = await withTimeout(connect(row), LIST_TOOLS_TIMEOUT_MS, "conexão");
    const { tools } = await withTimeout(client.listTools(), LIST_TOOLS_TIMEOUT_MS, "listagem de tools");
    return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description || "" })) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 300), tools: [] };
  } finally {
    await client?.close().catch(() => {});
  }
}
