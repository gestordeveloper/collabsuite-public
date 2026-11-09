/**
 * Cliente mínimo da API REST do GitHub. As URLs-base vêm do ambiente para permitir um GitHub simulado
 * nos testes (GITHUB_API_URL / GITHUB_WEB_URL); em produção ficam nos valores oficiais.
 */
import { HttpError } from "../../lib/httpError";

// Status para "conta do GitHub não conectada / token revogado". NÃO pode ser 401: o app trata 401 como "sessão da CollabSuite
// expirou" e desloga a pessoa (interceptor do axios). 424 = a dependência externa (GitHub) falhou.
export const GITHUB_AUTH_STATUS = 424;

/** O GitHub recusou o token (401). É o único erro que justifica renovar o token e tentar de novo. */
export class GithubAuthError extends HttpError {}

const strip = (u: string) => u.replace(/\/+$/, "");
export const apiBase = () => strip(process.env.GITHUB_API_URL || "https://api.github.com");
export const webBase = () => strip(process.env.GITHUB_WEB_URL || "https://github.com");

export interface GhOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Devolve o corpo como texto (ex.: logs de jobs). */
  text?: boolean;
}

export interface GhResult<T> {
  data: T;
  /** Há próxima página (cabeçalho Link rel="next"). */
  hasNext: boolean;
}

/** Erro "amigável": a mensagem do GitHub quando existe, com o status HTTP correspondente. */
function toError(status: number, payload: any, rateLimited: boolean): HttpError {
  const detail = payload?.errors?.[0]?.message || payload?.errors?.[0]?.code;
  const base = payload?.message || "Erro na API do GitHub";
  if (status === 401) return new GithubAuthError("O acesso ao GitHub foi revogado ou expirou. Reconecte sua conta do GitHub.", GITHUB_AUTH_STATUS);
  if (rateLimited) return new HttpError("Limite de requisições do GitHub atingido. Tente novamente em alguns minutos.", 429);
  if (status === 403) return new HttpError(`Sem permissão no GitHub: ${base}`, 403);
  if (status === 404) return new HttpError("Não encontrado no GitHub (ou sem permissão de acesso).", 404);
  if (status === 409) return new HttpError(`Conflito no GitHub: ${base}`, 409);
  if (status === 422) return new HttpError(`O GitHub recusou os dados: ${base}${detail ? ` (${detail})` : ""}`, 422);
  return new HttpError(`GitHub: ${base}`, status >= 500 ? 502 : status);
}

export async function gh<T = any>(token: string, method: string, path: string, opts: GhOptions = {}): Promise<GhResult<T>> {
  const url = new URL(`${apiBase()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "CollabSuite",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    throw new HttpError(`Não foi possível falar com o GitHub (${err?.name === "TimeoutError" ? "tempo esgotado" : "rede"}).`, 502);
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const rateLimited = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
    throw toError(res.status, payload, rateLimited);
  }

  const hasNext = /rel="next"/.test(res.headers.get("link") ?? "");
  if (res.status === 204) return { data: null as T, hasNext };
  if (opts.text) return { data: (await res.text()) as T, hasNext };
  return { data: (await res.json().catch(() => null)) as T, hasNext };
}
