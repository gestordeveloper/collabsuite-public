"""Groq, OpenAI and OpenRouter: all three speak the OpenAI chat-completions format."""
from __future__ import annotations

import json
import re
import time

import requests

from backend.llm_anthropic import LLMError

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _headers(provider: str, api_key: str) -> dict:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if provider == "openrouter":
        headers["X-Title"] = "StudioX"
    return headers


def _error_for(provider_name: str, status: int, body: str) -> LLMError:
    detail = ""
    try:
        err = json.loads(body).get("error")
        detail = err.get("message") if isinstance(err, dict) else str(err or "")
    except (ValueError, AttributeError):
        detail = body[:160]
    if status in (401, 403):
        return LLMError(f"Chave do {provider_name} recusada (inválida, revogada ou sem permissão).", "auth")
    if status == 404:
        return LLMError(f"Modelo ou endereço não encontrado no {provider_name}. {detail}".strip(), "bad_request")
    if status == 429:
        return LLMError(f"Limite de uso do {provider_name} atingido. {detail}".strip(), "rate")
    if status >= 500:
        return LLMError(f"O {provider_name} está com problemas (erro {status}).", "server")
    return LLMError(f"O {provider_name} recusou o pedido (erro {status}). {detail}".strip(), "bad_request")


def parse_json_text(text: str) -> dict:
    """The model's text as JSON: tolerates code fences and prose around the object."""
    text = _FENCE_RE.sub("", (text or "").strip())
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except ValueError:
                pass
    raise LLMError("O modelo devolveu uma resposta que não é JSON válido.", "parse")


def complete_json(provider: str, provider_name: str, base_url: str, api_key: str, model: str,
                  system: str, user: str, timeout: float = 180.0) -> dict:
    url = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
    }
    attempts = 0
    while True:
        attempts += 1
        try:
            resp = requests.post(url, headers=_headers(provider, api_key), json=payload, timeout=timeout)
        except requests.RequestException as exc:
            if attempts <= 2:
                time.sleep(2 * attempts)
                continue
            raise LLMError(f"Sem conexão com o {provider_name}.", "network") from exc

        if resp.status_code == 200:
            try:
                content = resp.json()["choices"][0]["message"]["content"]
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                raise LLMError(f"Resposta inesperada do {provider_name}.", "parse") from exc
            return parse_json_text(content)

        # Some models/routes do not support JSON mode: retry once without it (the prompt asks for JSON anyway)
        if resp.status_code in (400, 422) and "response_format" in payload:
            payload.pop("response_format")
            continue
        if (resp.status_code == 429 or resp.status_code >= 500) and attempts <= 3:
            try:
                wait = min(30.0, float(resp.headers.get("retry-after", 2 * attempts)))
            except ValueError:
                wait = 2.0 * attempts
            time.sleep(wait)
            continue
        raise _error_for(provider_name, resp.status_code, resp.text)


def list_models(provider: str, provider_name: str, base_url: str, api_key: str) -> list[str]:
    try:
        resp = requests.get(f"{base_url.rstrip('/')}/models", headers=_headers(provider, api_key), timeout=25)
    except requests.RequestException as exc:
        raise LLMError(f"Sem conexão com o {provider_name}.", "network") from exc
    if resp.status_code != 200:
        raise _error_for(provider_name, resp.status_code, resp.text)
    try:
        ids = sorted({m["id"] for m in resp.json().get("data", []) if m.get("id")})
    except (ValueError, TypeError, AttributeError) as exc:
        raise LLMError(f"Resposta inesperada do {provider_name}.", "parse") from exc
    return ids


def check_key(provider: str, provider_name: str, base_url: str, api_key: str) -> None:
    """Validates the key with a free call. OpenRouter lists models without auth, so it has its own probe."""
    if provider == "openrouter":
        for path in ("/key", "/auth/key"):
            resp = requests.get(f"{base_url.rstrip('/')}{path}", headers=_headers(provider, api_key), timeout=25)
            if resp.status_code == 200:
                return
            if resp.status_code in (401, 403):
                raise _error_for(provider_name, resp.status_code, resp.text)
        raise LLMError("Não consegui validar a chave no OpenRouter.", "bad_request")
    list_models(provider, provider_name, base_url, api_key)
