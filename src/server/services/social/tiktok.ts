/** TikTok Content Posting API (v2) + Login Kit. Envio por FILE_UPLOAD em partes, então não exige domínio verificado. */
import { PlatformError } from "./errors";
import { readRange, type MediaFile } from "./media";

const API = "https://open.tiktokapis.com";
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const SCOPES = ["user.info.basic", "video.publish", "video.upload"];
const MAX_SINGLE = 64 * 1024 * 1024;
const MULTI_CHUNK = 32 * 1024 * 1024;

export function authUrl(clientKey: string, redirect: string, state: string): string {
  const q = new URLSearchParams({ client_key: clientKey, scope: SCOPES.join(","), response_type: "code", redirect_uri: redirect, state });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  open_id: string;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const code = json.error;
    throw new PlatformError(code === "invalid_grant" ? "O acesso ao TikTok expirou ou foi revogado. Reconecte a conta." : `TikTok: ${json.error_description || code || `HTTP ${res.status}`}`, false);
  }
  return json;
}

export const exchangeCode = (key: string, secret: string, redirect: string, code: string) =>
  tokenRequest({ client_key: key, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: redirect });

export const refreshToken = (key: string, secret: string, refresh: string) =>
  tokenRequest({ client_key: key, client_secret: secret, grant_type: "refresh_token", refresh_token: refresh });

export async function revoke(key: string, secret: string, token: string): Promise<void> {
  await fetch(`${API}/v2/oauth/revoke/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: key, client_secret: secret, token }),
  }).catch(() => {});
}

const FRIENDLY: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts: "O app do TikTok ainda não foi aprovado na auditoria: só consegue postar em modo privado (\"Só eu\"), com a conta em modo privado. Escolha o modo Rascunho ou conclua a auditoria no TikTok for Developers.",
  spam_risk_too_many_posts: "O TikTok bloqueou por excesso de postagens hoje nessa conta. Tente amanhã.",
  spam_risk_user_banned_from_posting: "O TikTok impediu esta conta de postar.",
  reached_active_user_cap: "O app do TikTok atingiu o limite diário de usuários ativos (comum em apps não auditados).",
  access_token_invalid: "O acesso ao TikTok expirou. Reconecte a conta.",
  scope_not_authorized: "A conta conectada não autorizou a publicação. Reconecte e aceite todas as permissões.",
  scope_permission_missed: "O app do TikTok não tem o produto \"Content Posting API\" liberado (escopo video.publish/video.upload).",
  privacy_level_option_mismatch: "A privacidade escolhida não está disponível para esta conta do TikTok.",
  duration_check_failed: "A duração do vídeo não é permitida para esta conta do TikTok.",
  file_format_check_failed: "O TikTok não aceitou o formato do vídeo (use MP4 H.264 ou MOV).",
  picture_size_check_failed: "O TikTok não aceitou a resolução do vídeo.",
  invalid_file_upload: "O TikTok recusou o arquivo enviado.",
};
const NON_RETRYABLE = new Set(Object.keys(FRIENDLY));

async function call<T>(accessToken: string, path: string, body?: unknown, method: "POST" | "GET" = "POST"): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  const code: string = json?.error?.code || (res.ok ? "ok" : `http_${res.status}`);
  if (code !== "ok") {
    throw new PlatformError(FRIENDLY[code] ?? `TikTok: ${json?.error?.message || code}`, !NON_RETRYABLE.has(code) && (res.status >= 500 || res.status === 429));
  }
  return json.data as T;
}

export async function getUser(accessToken: string): Promise<{ open_id: string; display_name: string; avatar_url: string | null }> {
  const d = await call<any>(accessToken, "/v2/user/info/?fields=open_id,display_name,avatar_url", undefined, "GET");
  return { open_id: d.user?.open_id, display_name: d.user?.display_name || "TikTok", avatar_url: d.user?.avatar_url ?? null };
}

export interface CreatorInfo {
  nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export async function creatorInfo(accessToken: string): Promise<CreatorInfo> {
  const d = await call<any>(accessToken, "/v2/post/publish/creator_info/query/");
  return {
    nickname: d.creator_nickname || d.creator_username || "",
    privacy_level_options: d.privacy_level_options ?? ["SELF_ONLY"],
    comment_disabled: !!d.comment_disabled,
    duet_disabled: !!d.duet_disabled,
    stitch_disabled: !!d.stitch_disabled,
    max_video_post_duration_sec: d.max_video_post_duration_sec ?? 600,
  };
}

export interface TiktokPost {
  accessToken: string;
  file: MediaFile;
  /** Legenda (com #hashtags). */
  title: string;
  mode: "direct" | "draft";
  privacy: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
}

/** Envia o vídeo e devolve o publish_id; use `waitForPublish` para saber o resultado. */
export async function publishVideo(o: TiktokPost): Promise<string> {
  const size = o.file.size;
  const chunkSize = size <= MAX_SINGLE ? size : MULTI_CHUNK;
  const totalChunks = Math.max(1, Math.floor(size / chunkSize));
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks };

  const init =
    o.mode === "draft"
      ? await call<any>(o.accessToken, "/v2/post/publish/inbox/video/init/", { source_info })
      : await call<any>(o.accessToken, "/v2/post/publish/video/init/", {
          post_info: { title: o.title, privacy_level: o.privacy, disable_comment: o.disableComment, disable_duet: o.disableDuet, disable_stitch: o.disableStitch },
          source_info,
        });
  if (!init?.upload_url || !init?.publish_id) throw new PlatformError("O TikTok não devolveu o endereço de envio.");

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1; // a última parte absorve o resto
    const body = await readRange(o.file.path, start, end);
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(init.upload_url, {
          method: "PUT",
          headers: { "Content-Type": o.file.mime === "video/webm" ? "video/webm" : o.file.mime, "Content-Length": String(body.length), "Content-Range": `bytes ${start}-${end}/${size}` },
          body,
        });
        if (res.status === 201 || res.status === 206 || res.status === 200) break;
        if (res.status < 500 && res.status !== 429) throw new PlatformError(`O TikTok recusou o envio do vídeo (HTTP ${res.status}).`, false);
        throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        if (e instanceof PlatformError) throw e;
        if (++attempt >= 3) throw new PlatformError("O envio do vídeo ao TikTok falhou várias vezes. Tente novamente.");
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  return init.publish_id as string;
}

export interface PublishOutcome {
  state: "complete" | "inbox" | "processing";
  postId: string | null;
}

/** Consulta o status algumas vezes; se o TikTok ainda estiver processando, devolve "processing". */
export async function waitForPublish(accessToken: string, publishId: string, maxMs = 60_000): Promise<PublishOutcome> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const d = await call<any>(accessToken, "/v2/post/publish/status/fetch/", { publish_id: publishId });
    const st: string = d.status;
    if (st === "PUBLISH_COMPLETE") return { state: "complete", postId: d.publicaly_available_post_id?.[0] ? String(d.publicaly_available_post_id[0]) : null };
    if (st === "SEND_TO_USER_INBOX") return { state: "inbox", postId: null };
    if (st === "FAILED") throw new PlatformError(FRIENDLY[d.fail_reason] ?? `O TikTok recusou a publicação${d.fail_reason ? `: ${d.fail_reason}` : "."}`, false);
    if (Date.now() > deadline) return { state: "processing", postId: null };
    await new Promise((r) => setTimeout(r, 3000));
  }
}
