/** Configuração do cliente ssh2 e teste de conexão (sem abrir shell). */
import * as ssh2Namespace from "ssh2";
import type { ConnectConfig, ClientChannel } from "ssh2";
import { HttpError } from "../../lib/httpError";
import { decrypt } from "../../lib/encryption";

// O ssh2 é CommonJS: no modo ESM (tsx/dev) só o `default` traz tudo; no bundle (esbuild) o namespace já basta.
const ssh2: typeof ssh2Namespace = (ssh2Namespace as any).default ?? ssh2Namespace;
export const Client = ssh2.Client;
export const utils = ssh2.utils;
export type { ClientChannel };

export interface StoredConnection {
  host: string;
  port: number;
  username: string;
  auth_type: string;
  secret: string;
  passphrase: string | null;
  host_fingerprint: string | null;
}

/** "SHA256:…" (mesmo formato do `ssh-keygen -l`), a partir do hash hex que o ssh2 entrega. */
export const fingerprintFromHex = (hex: string) => `SHA256:${Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "")}`;

const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const IPV6_RE = /^[0-9a-fA-F:]+(%[A-Za-z0-9]+)?$/;

/** Valida o endereço e aplica as travas de rede (lista permitida opcional e metadata de nuvem sempre bloqueada). */
export function assertHostAllowed(rawHost: string): string {
  const host = rawHost.trim().replace(/^\[|\]$/g, "");
  if (!host || !(HOST_RE.test(host) || (host.includes(":") && IPV6_RE.test(host)))) throw new HttpError("Endereço do servidor inválido (use um nome de host ou IP).");
  if (/^169\.254\./.test(host) || host === "0.0.0.0" || host.toLowerCase().startsWith("fe80:")) throw new HttpError("Esse endereço não é permitido para conexões SSH.");
  const allowed = (process.env.SSH_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0) {
    const h = host.toLowerCase();
    const ok = allowed.some((a) => (a.startsWith("*.") ? h.endsWith(a.slice(1)) : a === h));
    if (!ok) throw new HttpError("Este servidor não está na lista de hosts permitidos pelo administrador (SSH_ALLOWED_HOSTS).");
  }
  return host;
}

/** Confere se o texto é uma chave privada utilizável (e se a passphrase, quando exigida, foi informada). */
export function assertValidPrivateKey(key: string, passphrase?: string | null): string {
  const normalized = key.replace(/\r\n/g, "\n").trim() + "\n";
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(normalized)) throw new HttpError("Cole a chave PRIVADA completa (começa com -----BEGIN … PRIVATE KEY-----).");
  const parsed = utils.parseKey(normalized, passphrase || undefined);
  const err = parsed instanceof Error ? parsed : Array.isArray(parsed) ? parsed.find((p) => p instanceof Error) : null;
  if (err) {
    const msg = String(err.message);
    if (/passphrase/i.test(msg)) throw new HttpError(passphrase ? "A senha (passphrase) da chave está incorreta." : "Esta chave é protegida por senha: informe a passphrase.");
    throw new HttpError("Não foi possível ler a chave privada (formato não suportado ou corrompido).");
  }
  return normalized;
}

export function buildConfig(conn: StoredConnection, verifier: (fingerprint: string) => boolean): ConnectConfig {
  const base: ConnectConfig = {
    host: conn.host,
    port: conn.port,
    username: conn.username,
    readyTimeout: 15_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 4,
    hostHash: "sha256",
    // O ssh2 só chama o verificador de forma síncrona (hash em hex); a decisão fica a cargo de quem chama.
    hostVerifier: ((hash: string) => verifier(fingerprintFromHex(hash))) as any,
  };
  if (conn.auth_type === "key") {
    return { ...base, privateKey: decrypt(conn.secret), passphrase: conn.passphrase ? decrypt(conn.passphrase) : undefined };
  }
  // tryKeyboard cobre servidores que expõem a senha via "keyboard-interactive".
  return { ...base, password: decrypt(conn.secret), tryKeyboard: true };
}

/** Traduz erros crus do ssh2/Node para mensagens úteis (sem vazar detalhes internos). */
export function friendlyError(err: any): { code: string; message: string } {
  const msg = String(err?.message ?? err ?? "");
  if (err?.code === "ECONNREFUSED") return { code: "refused", message: "Conexão recusada: o servidor não está aceitando SSH nesse endereço/porta." };
  if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") return { code: "dns", message: "Não foi possível encontrar o servidor (verifique o endereço)." };
  if (err?.code === "ETIMEDOUT" || err?.code === "EHOSTUNREACH" || err?.code === "ENETUNREACH" || /timed out/i.test(msg)) return { code: "timeout", message: "Tempo esgotado: o servidor não respondeu (firewall ou endereço incorreto?)." };
  if (/authentication methods failed|all configured authentication/i.test(msg)) return { code: "auth_failed", message: "Falha na autenticação: usuário, senha ou chave não foram aceitos pelo servidor." };
  if (/handshake failed|no matching/i.test(msg)) return { code: "handshake", message: "O servidor recusou a negociação de segurança (algoritmos incompatíveis)." };
  if (err?.code === "ECONNRESET") return { code: "reset", message: "A conexão foi encerrada pelo servidor." };
  return { code: "error", message: "Não foi possível conectar ao servidor." };
}

export interface ProbeResult {
  ok: boolean;
  fingerprint: string | null;
  code?: string;
  message?: string;
}

/** Conecta, autentica e desconecta, devolvendo a impressão digital do servidor. Não aceita nem fixa nada sozinho. */
export function probe(conn: StoredConnection): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let fingerprint: string | null = null;
    let settled = false;
    const client = new Client();
    const done = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      client.end();
      resolve(r);
    };
    let config: ConnectConfig;
    try {
      config = buildConfig(conn, (fp) => { fingerprint = fp; return true; });
    } catch {
      return resolve({ ok: false, fingerprint: null, code: "secret", message: "Não foi possível ler as credenciais salvas. Cadastre-as novamente." });
    }
    client.on("keyboard-interactive", (_n, _i, _l, _p, finish) => finish([config.password ?? ""]));
    client.on("ready", () => done({ ok: true, fingerprint }));
    client.on("error", (err) => done({ ok: false, fingerprint, ...friendlyError(err) }));
    client.on("close", () => done({ ok: false, fingerprint, code: "closed", message: "A conexão foi encerrada antes de concluir." }));
    try {
      client.connect(config);
    } catch (err) {
      done({ ok: false, fingerprint: null, ...friendlyError(err) });
    }
  });
}
