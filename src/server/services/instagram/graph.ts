/** Chamadas à Graph API do Meta (publicar, responder comentário, DM, listar mídia). Sem estado. */
import { publicUrlSync, type MetaConfig } from "./config.service";

export const FB_API_VERSION = "v21.0";
const FB = `https://graph.facebook.com/${FB_API_VERSION}`;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GraphError extends Error {
  constructor(message: string, public code?: number, public subcode?: number) {
    super(message);
  }
}

function fail(prefix: string, err: any): never {
  throw new GraphError(`${prefix}: ${err?.message ?? "erro desconhecido"}`, err?.code, err?.error_subcode);
}

async function graph(method: "GET" | "POST", path: string, params: Record<string, string>, prefix: string): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${FB}/${path}${method === "GET" ? `?${qs}` : ""}`, {
    method,
    ...(method === "POST" ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs } : {}),
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.error) fail(prefix, data.error);
  if (!res.ok) throw new GraphError(`${prefix}: HTTP ${res.status}`);
  return data;
}

export const cleanToken = (t: string) => t.trim().replace(/^["']+|["']+$/g, "");

/** URL pública de uma mídia: caminhos relativos (/uploads/x) viram absolutos com APP_URL. */
export function absoluteMediaUrl(url: string): string {
  const clean = url.split("?")[0];
  if (/^https?:\/\//i.test(clean)) return url;
  const base = publicUrlSync();
  return `${base}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

/** O Instagram baixa a mídia pela internet: localhost / IP privado nunca funciona. */
export function assertPublicMediaUrl(url: string): void {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new GraphError("URL de mídia inválida. Defina APP_URL (endereço público do app) no .env ou use o armazenamento S3.");
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) || host.endsWith(".local")) {
    throw new GraphError(
      `O Instagram não consegue baixar mídias de "${host}". Publique o app em um endereço público (APP_URL) ou configure o S3 (AWS_S3_*) para hospedar as imagens.`
    );
  }
}

const isVideoUrl = (url: string) => /\.(mp4|mov|avi|wmv)$/i.test(url.split("?")[0]);

export async function publishMedia(opts: { token: string; igUserId: string; caption: string; mediaUrls: string[] }): Promise<{ id: string; permalink: string | null }> {
  const token = cleanToken(opts.token);
  const igId = opts.igUserId.trim();
  const urls = opts.mediaUrls.map(absoluteMediaUrl);
  urls.forEach(assertPublicMediaUrl);

  let containerId: string;
  if (urls.length === 1) {
    const url = urls[0];
    const params: Record<string, string> = { access_token: token, caption: opts.caption };
    if (isVideoUrl(url)) Object.assign(params, { video_url: url, media_type: "REELS", share_to_feed: "true" });
    else Object.assign(params, { image_url: url, media_type: "IMAGE" });
    containerId = (await graph("POST", `${igId}/media`, params, "Falha ao criar a mídia")).id;
  } else {
    const children: string[] = [];
    for (const url of urls) {
      const params: Record<string, string> = { access_token: token, is_carousel_item: "true" };
      if (isVideoUrl(url)) Object.assign(params, { video_url: url, media_type: "VIDEO" });
      else Object.assign(params, { image_url: url, media_type: "IMAGE" });
      children.push((await graph("POST", `${igId}/media`, params, "Falha ao criar item do carrossel")).id);
    }
    containerId = (
      await graph("POST", `${igId}/media`, { access_token: token, caption: opts.caption, media_type: "CAROUSEL", children: children.join(",") }, "Falha ao criar o carrossel")
    ).id;
  }

  // O container (principalmente vídeo/Reels) leva um tempo para ficar pronto.
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await delay(attempt <= 3 ? 5000 : 10000);
    const st = await graph("GET", containerId, { fields: "status_code,status", access_token: token }, "Falha ao consultar o processamento");
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new GraphError(`O Instagram rejeitou o processamento da mídia: ${st.status ?? st.status_code}`);
    if (attempt === maxAttempts) throw new GraphError("Tempo limite de processamento da mídia excedido.");
  }

  const published = await graph("POST", `${igId}/media_publish`, { access_token: token, creation_id: containerId }, "Falha ao publicar");
  let permalink: string | null = null;
  try {
    permalink = (await graph("GET", published.id, { fields: "permalink", access_token: token }, "permalink")).permalink ?? null;
  } catch {
    /* o link é só um extra */
  }
  return { id: published.id, permalink };
}

export async function listMedia(token: string, igUserId: string, limit = 30) {
  const data = await graph(
    "GET",
    `${igUserId}/media`,
    { fields: "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink", limit: String(limit), access_token: cleanToken(token) },
    "Falha ao listar as postagens"
  );
  return (data.data ?? []) as Array<{ id: string; caption?: string; media_type: string; media_url?: string; thumbnail_url?: string; timestamp: string; permalink?: string }>;
}

/** Resposta pública a um comentário. */
export async function replyToComment(token: string, commentId: string, username: string, text: string): Promise<void> {
  await graph("POST", `${commentId}/replies`, { access_token: cleanToken(token), message: username ? `@${username} ${text}` : text }, "Falha ao responder o comentário");
}

async function sendMessage(token: string, recipient: Record<string, string>, message: unknown, prefix: string) {
  const res = await fetch(`${FB}/me/messages?access_token=${encodeURIComponent(cleanToken(token))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, message }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.error) fail(prefix, data.error);
  if (!res.ok) throw new GraphError(`${prefix}: HTTP ${res.status}`);
}

/** DM privada vinculada a um comentário (private reply). Botão com link quando há CTA. */
export async function sendCommentDm(token: string, commentId: string, text: string, cta?: { title: string; url: string } | null): Promise<void> {
  const message = cta
    ? { attachment: { type: "template", payload: { template_type: "button", text, buttons: [{ type: "web_url", url: cta.url, title: cta.title, webview_height_ratio: "full" }] } } }
    : { text };
  await sendMessage(token, { comment_id: commentId }, message, "Falha ao enviar a DM");
}

export async function getProfile(token: string, igUserId: string) {
  return graph("GET", igUserId, { fields: "username,name,profile_picture_url", access_token: cleanToken(token) }, "Falha ao ler o perfil") as Promise<{ username?: string; name?: string; profile_picture_url?: string }>;
}

// ─── OAuth / conexão ────────────────────────────────────────────────────────────

export const OAUTH_SCOPES = [
  "email",
  "public_profile",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "instagram_manage_messages",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
];

export function oauthDialogUrl(appId: string, redirectUri: string, state: string): string {
  return `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPES.join(","))}&state=${state}&response_type=code`;
}

export async function exchangeCode(appId: string, appSecret: string, redirectUri: string, code: string): Promise<string> {
  const short = await graph("GET", "oauth/access_token", { client_id: appId, redirect_uri: redirectUri, client_secret: appSecret, code }, "Falha ao trocar o código");
  return exchangeLongLived(appId, appSecret, short.access_token);
}

/** Token de usuário de ~60 dias (também usado para renovar). */
export async function exchangeLongLived(appId: string, appSecret: string, token: string): Promise<string> {
  const long = await graph("GET", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token }, "Falha ao obter o token de longa duração");
  return long.access_token as string;
}

export interface IgAccountOption {
  instagramId: string;
  username: string;
  avatar: string;
  pageName: string;
  pageToken: string;
}

export async function listInstagramAccounts(userToken: string): Promise<IgAccountOption[]> {
  const fields = "name,access_token,instagram_business_account{id,username,name,profile_picture_url}";
  const pages = await graph("GET", "me/accounts", { fields, limit: "100", access_token: userToken }, "Falha ao listar as páginas");
  let all: any[] = pages.data ?? [];
  if (all.length === 0) {
    const biz = await graph("GET", "me/businesses", { fields: `owned_pages{${fields}}`, limit: "50", access_token: userToken }, "Falha ao listar os negócios").catch(() => ({ data: [] }));
    for (const b of biz.data ?? []) all = all.concat(b.owned_pages?.data ?? []);
  }
  return all
    .filter((p) => p.instagram_business_account)
    .map((p) => ({
      instagramId: p.instagram_business_account.id as string,
      username: (p.instagram_business_account.username as string) || "",
      avatar: (p.instagram_business_account.profile_picture_url as string) || "",
      pageName: p.name as string,
      pageToken: p.access_token as string,
    }));
}

export async function checkTokenValid(token: string): Promise<string | null> {
  try {
    await graph("GET", "me", { fields: "id", access_token: cleanToken(token) }, "token");
    return null;
  } catch (e: any) {
    return e.message as string;
  }
}

/** Assina o app (nível de app) e a conta (nível de conta) para receber comentários/mensagens. Idempotente. */
export async function setupWebhooks(cfg: MetaConfig, igUserId: string, pageToken: string): Promise<boolean> {
  const { appId, appSecret, appUrl, verifyToken } = cfg;
  if (!appId || !appSecret || !appUrl) return false;
  const fields = "comments,messages,messaging_postbacks";
  let ok = true;
  try {
    await graph("POST", `${appId}/subscriptions`, { object: "instagram", callback_url: `${appUrl}/api/instagram/webhook`, verify_token: verifyToken, fields, access_token: `${appId}|${appSecret}` }, "subscriptions");
  } catch (e: any) {
    console.warn("[instagram] assinatura do app falhou:", e.message);
    ok = false;
  }
  try {
    await graph("POST", `${igUserId}/subscribed_apps`, { subscribed_fields: fields, access_token: pageToken }, "subscribed_apps");
  } catch (e: any) {
    console.warn(`[instagram] assinatura da conta ${igUserId} falhou:`, e.message);
    ok = false;
  }
  return ok;
}
