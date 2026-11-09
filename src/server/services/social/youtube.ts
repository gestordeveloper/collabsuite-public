/** YouTube Data API v3 + OAuth do Google. Envio em partes (upload resumível). */
import { PlatformError } from "./errors";
import { readRange, type MediaFile } from "./media";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const CHUNK = 8 * 1024 * 1024; // múltiplo de 256 KiB, exigência do upload resumível

export function authUrl(clientId: string, redirect: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // para receber o refresh_token
    prompt: "consent select_account", // força o refresh_token e deixa escolher a conta/canal
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const code = json.error;
    const msg = json.error_description || code || `HTTP ${res.status}`;
    throw new PlatformError(code === "invalid_grant" ? "O acesso ao YouTube expirou ou foi revogado. Reconecte o canal." : `Google: ${msg}`, false);
  }
  return json;
}

export const exchangeCode = (clientId: string, clientSecret: string, redirect: string, code: string) =>
  tokenRequest({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code", code });

export const refreshToken = (clientId: string, clientSecret: string, refresh: string) =>
  tokenRequest({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refresh });

export async function revoke(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

function explain(status: number, json: any): PlatformError {
  const reason: string = json?.error?.errors?.[0]?.reason || json?.error?.status || "";
  const raw: string = json?.error?.message || `HTTP ${status}`;
  const known: Record<string, string> = {
    quotaExceeded: "A cota diária da API do YouTube acabou (cada envio custa 1.600 de 10.000 pontos por dia). Tente amanhã ou peça aumento de cota no Google Cloud.",
    dailyLimitExceeded: "A cota diária da API do YouTube acabou. Tente amanhã ou peça aumento de cota no Google Cloud.",
    uploadLimitExceeded: "O canal atingiu o limite de envios do YouTube por hoje.",
    youtubeSignupRequired: "A conta do Google não tem um canal do YouTube. Crie o canal e reconecte.",
    forbidden: "O YouTube recusou o envio (permissão). Reconecte o canal e aceite todas as permissões.",
    authError: "O acesso ao YouTube expirou. Reconecte o canal.",
    invalidTitle: "Título inválido para o YouTube (máx. 100 caracteres, sem < ou >).",
    invalidDescription: "Descrição inválida para o YouTube.",
    invalidTags: "Tags inválidas para o YouTube.",
    mediaBodyRequired: "O arquivo de vídeo está vazio.",
  };
  const transient = status >= 500 || status === 429;
  return new PlatformError(known[reason] ?? `YouTube: ${raw}`, transient && !known[reason]);
}

async function api<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw explain(res.status, json);
  return json;
}

export async function getChannel(accessToken: string): Promise<{ id: string; title: string; avatar: string | null }> {
  const json = await api<any>(accessToken, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
  const ch = json.items?.[0];
  if (!ch) throw new PlatformError("Essa conta do Google não tem um canal do YouTube. Crie o canal (youtube.com) ou escolha outra conta/canal.", false);
  const s = ch.snippet ?? {};
  return { id: ch.id, title: s.customUrl ? `${s.title} (${s.customUrl})` : s.title, avatar: s.thumbnails?.default?.url ?? null };
}

export interface YoutubeUpload {
  accessToken: string;
  file: MediaFile;
  title: string;
  description: string;
  tags: string[];
  privacy: "public" | "unlisted" | "private";
  categoryId: string;
  madeForKids: boolean;
}

export async function uploadVideo(o: YoutubeUpload): Promise<{ id: string }> {
  const auth = { Authorization: `Bearer ${o.accessToken}` };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(o.file.size), "X-Upload-Content-Type": o.file.mime },
    body: JSON.stringify({
      snippet: { title: o.title, description: o.description, tags: o.tags, categoryId: o.categoryId },
      status: { privacyStatus: o.privacy, selfDeclaredMadeForKids: o.madeForKids, embeddable: true },
    }),
  });
  if (!init.ok) throw explain(init.status, await init.json().catch(() => ({})));
  const session = init.headers.get("location");
  if (!session) throw new PlatformError("O YouTube não devolveu o endereço de envio.");

  const total = o.file.size;
  let offset = 0;
  let failures = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total) - 1;
    const body = await readRange(o.file.path, offset, end);
    let res: Response | null = null;
    try {
      res = await fetch(session, { method: "PUT", headers: { "Content-Length": String(body.length), "Content-Range": `bytes ${offset}-${end}/${total}`, "Content-Type": o.file.mime }, body });
    } catch {
      /* queda de rede: cai no ramo de retomada abaixo */
    }
    if (res && (res.status === 200 || res.status === 201)) {
      const json: any = await res.json().catch(() => ({}));
      if (!json.id) throw new PlatformError("O YouTube concluiu o envio mas não devolveu o id do vídeo.");
      return { id: json.id };
    }
    if (res?.status === 308) {
      const m = /bytes=0-(\d+)/.exec(res.headers.get("range") || "");
      offset = m ? Number(m[1]) + 1 : end + 1;
      failures = 0;
      continue;
    }
    if (res && res.status < 500 && res.status !== 429) throw explain(res.status, await res.json().catch(() => ({})));
    // 5xx / rede: pergunta ao YouTube até onde ele recebeu e continua dali.
    if (++failures > 5) throw new PlatformError("O envio do vídeo ao YouTube foi interrompido várias vezes. Tente novamente.");
    await new Promise((r) => setTimeout(r, 1500 * failures));
    try {
      const probe = await fetch(session, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${total}` } });
      if (probe.status === 200 || probe.status === 201) {
        const json: any = await probe.json().catch(() => ({}));
        if (json.id) return { id: json.id };
      }
      const m = /bytes=0-(\d+)/.exec(probe.headers.get("range") || "");
      offset = m ? Number(m[1]) + 1 : 0;
    } catch {
      /* tenta de novo no próximo ciclo */
    }
  }
  throw new PlatformError("Envio ao YouTube terminou sem confirmação.");
}
