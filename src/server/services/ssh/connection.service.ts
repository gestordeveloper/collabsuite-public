/** Acessos SSH de um projeto: CRUD (segredos criptografados), teste e fixação da impressão digital do servidor. */
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";
import { encrypt } from "../../lib/encryption";
import { assertSshAccess, type Actor } from "./access";
import { assertHostAllowed, assertValidPrivateKey, probe, type StoredConnection } from "./client";

export interface ConnectionInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  auth_type?: string;
  /** Chave privada ou senha. Na edição, vazio = manter o que já está salvo. */
  secret?: string;
  passphrase?: string | null;
  record_sessions?: boolean;
  /** Remove a impressão digital confirmada (servidor reinstalado): será preciso testar e confirmar de novo. */
  reset_fingerprint?: boolean;
}

type Row = Awaited<ReturnType<typeof prisma.sshConnection.findFirstOrThrow>>;

/** Nunca devolve `secret`/`passphrase`: o navegador só sabe que existem. */
function toView(c: Row) {
  return {
    id: c.id,
    project_id: c.project_id,
    name: c.name,
    host: c.host,
    port: c.port,
    username: c.username,
    auth_type: c.auth_type as "key" | "password",
    has_secret: !!c.secret,
    has_passphrase: !!c.passphrase,
    host_fingerprint: c.host_fingerprint,
    record_sessions: c.record_sessions,
    last_used_at: c.last_used_at?.toISOString() ?? null,
    created_at: c.created_at.toISOString(),
  };
}

async function find(actor: Actor, projectId: number, id: number): Promise<Row> {
  await assertSshAccess(actor, projectId);
  const row = await prisma.sshConnection.findFirst({ where: { id, project_id: projectId } });
  if (!row) throw new HttpError("Acesso SSH não encontrado.", 404);
  return row;
}

function cleanName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name) throw new HttpError("Dê um nome ao acesso (ex.: Produção).");
  return name.slice(0, 120);
}
function cleanUser(v: unknown): string {
  const u = typeof v === "string" ? v.trim() : "";
  if (!/^[A-Za-z0-9._][A-Za-z0-9._@-]{0,98}$/.test(u)) throw new HttpError("Usuário SSH inválido.");
  return u;
}
function cleanPort(v: unknown): number {
  const p = v === undefined || v === null || v === "" ? 22 : Number(v);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new HttpError("Porta inválida (1 a 65535).");
  return p;
}

export async function listConnections(actor: Actor, projectId: number) {
  await assertSshAccess(actor, projectId);
  const rows = await prisma.sshConnection.findMany({ where: { project_id: projectId }, orderBy: { name: "asc" } });
  return rows.map(toView);
}

export async function createConnection(actor: Actor, projectId: number, input: ConnectionInput) {
  await assertSshAccess(actor, projectId);
  const auth_type = input.auth_type === "key" ? "key" : input.auth_type === "password" ? "password" : null;
  if (!auth_type) throw new HttpError("Escolha o tipo de autenticação: chave privada ou senha.");
  const secretRaw = (input.secret ?? "").toString();
  if (!secretRaw.trim()) throw new HttpError(auth_type === "key" ? "Cole a chave privada." : "Informe a senha.");
  if (secretRaw.length > 20_000) throw new HttpError("Segredo grande demais.");
  const passphrase = auth_type === "key" ? input.passphrase?.toString() || null : null;
  const secret = auth_type === "key" ? assertValidPrivateKey(secretRaw, passphrase) : secretRaw;

  const row = await prisma.sshConnection.create({
    data: {
      project_id: projectId,
      name: cleanName(input.name),
      host: assertHostAllowed(String(input.host ?? "")),
      port: cleanPort(input.port),
      username: cleanUser(input.username),
      auth_type,
      secret: encrypt(secret),
      passphrase: passphrase ? encrypt(passphrase) : null,
      record_sessions: input.record_sessions !== false,
      created_by: actor.id,
    },
  });
  return toView(row);
}

export async function updateConnection(actor: Actor, projectId: number, id: number, input: ConnectionInput) {
  const current = await find(actor, projectId, id);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = cleanName(input.name);
  if (input.username !== undefined) data.username = cleanUser(input.username);
  if (input.record_sessions !== undefined) data.record_sessions = !!input.record_sessions;
  if (input.reset_fingerprint === true) data.host_fingerprint = null;

  const host = input.host !== undefined ? assertHostAllowed(String(input.host)) : current.host;
  const port = input.port !== undefined ? cleanPort(input.port) : current.port;
  if (host !== current.host || port !== current.port) {
    // Outro endereço = outro servidor: a impressão digital confirmada antes não vale mais.
    data.host = host;
    data.port = port;
    data.host_fingerprint = null;
  }

  const auth_type = input.auth_type === undefined ? current.auth_type : input.auth_type === "key" || input.auth_type === "password" ? input.auth_type : null;
  if (!auth_type) throw new HttpError("Tipo de autenticação inválido.");
  const newSecret = (input.secret ?? "").toString();
  if (auth_type !== current.auth_type && !newSecret.trim()) throw new HttpError("Ao trocar o tipo de autenticação, informe a nova credencial.");
  if (auth_type !== current.auth_type) data.auth_type = auth_type;

  if (newSecret.trim()) {
    if (newSecret.length > 20_000) throw new HttpError("Segredo grande demais.");
    const passphrase = auth_type === "key" ? input.passphrase?.toString() || null : null;
    data.secret = encrypt(auth_type === "key" ? assertValidPrivateKey(newSecret, passphrase) : newSecret);
    data.passphrase = passphrase ? encrypt(passphrase) : null;
  } else if (input.passphrase !== undefined && auth_type === "key") {
    data.passphrase = input.passphrase ? encrypt(input.passphrase.toString()) : null;
  }

  const row = await prisma.sshConnection.update({ where: { id }, data });
  return toView(row);
}

export async function deleteConnection(actor: Actor, projectId: number, id: number) {
  await find(actor, projectId, id);
  await prisma.sshConnection.delete({ where: { id } });
  return { ok: true };
}

/** Testa credenciais e mostra a impressão digital que o servidor apresentou. */
export async function testConnection(actor: Actor, projectId: number, id: number) {
  const c = await find(actor, projectId, id);
  const result = await probe(c as StoredConnection);
  return {
    ok: result.ok,
    code: result.code ?? null,
    message: result.message ?? null,
    fingerprint: result.fingerprint,
    pinned: !!c.host_fingerprint,
    matches: c.host_fingerprint && result.fingerprint ? c.host_fingerprint === result.fingerprint : null,
  };
}

/**
 * Fixa a impressão digital. Faz uma NOVA sondagem e só aceita se ela autenticar e bater com o valor que a pessoa viu:
 * assim não dá para "confiar às cegas" num valor que o navegador mandou.
 */
export async function trustFingerprint(actor: Actor, projectId: number, id: number, fingerprint: string) {
  const c = await find(actor, projectId, id);
  const result = await probe(c as StoredConnection);
  if (!result.ok || !result.fingerprint) throw new HttpError(result.message || "Não foi possível conectar para confirmar o servidor.");
  if (result.fingerprint !== fingerprint) throw new HttpError("A impressão digital mudou durante a confirmação. Teste a conexão de novo e confira o valor.", 409);
  const row = await prisma.sshConnection.update({ where: { id }, data: { host_fingerprint: result.fingerprint } });
  return toView(row);
}
