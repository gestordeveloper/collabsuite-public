"""Claude through the official Anthropic SDK (structured JSON output)."""
from __future__ import annotations

import json
from typing import Any

# Models that take `thinking: {"type": "adaptive"}`; Haiku 4.5 and older need budget_tokens instead.
_ADAPTIVE_PREFIXES = (
    "claude-opus-5", "claude-sonnet-5", "claude-fable", "claude-mythos",
    "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
)
# Models whose safety classifiers can decline a request: the API re-runs it on a fallback model
_FALLBACK_PREFIXES = ("claude-opus-5", "claude-fable-5-1")


class LLMError(RuntimeError):
    """A provider failure with a user-facing message. `kind` drives retries and the fallback."""

    def __init__(self, message: str, kind: str = "error"):
        super().__init__(message)
        self.kind = kind  # auth | rate | network | bad_request | server | refusal | parse | error


def _client(api_key: str, base_url: str | None):
    try:
        import anthropic
    except ImportError as exc:
        raise LLMError("O pacote 'anthropic' não está instalado no Python do servidor. Rode: pip install anthropic", "bad_request") from exc
    return anthropic, anthropic.Anthropic(api_key=api_key, base_url=base_url or None, timeout=180.0, max_retries=2)


def _translate(anthropic: Any, exc: Exception, model: str = "") -> LLMError:
    if isinstance(exc, anthropic.AuthenticationError):
        return LLMError("Chave da Anthropic recusada (inválida ou revogada).", "auth")
    if isinstance(exc, anthropic.PermissionDeniedError):
        return LLMError("A chave da Anthropic não tem permissão para isso.", "auth")
    if isinstance(exc, anthropic.NotFoundError):
        return LLMError(f"Modelo não encontrado na Anthropic: {model or '?'}.", "bad_request")
    if isinstance(exc, anthropic.RateLimitError):
        return LLMError("Limite de uso da Anthropic atingido. Tente de novo em instantes.", "rate")
    if isinstance(exc, anthropic.BadRequestError):
        return LLMError(f"A Anthropic recusou o pedido: {getattr(exc, 'message', exc)}", "bad_request")
    if isinstance(exc, anthropic.APIConnectionError):
        return LLMError("Sem conexão com a Anthropic.", "network")
    if isinstance(exc, anthropic.APIStatusError):
        return LLMError(f"Erro {exc.status_code} da Anthropic.", "server")
    return LLMError(str(exc))


def complete_json(api_key: str, model: str, system: str, user: str, schema: dict, base_url: str | None = None) -> dict:
    anthropic, client = _client(api_key, base_url)
    kwargs: dict[str, Any] = dict(
        model=model,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": schema}},
    )
    if model.startswith(_ADAPTIVE_PREFIXES):
        kwargs["thinking"] = {"type": "adaptive"}
    try:
        if model.startswith(_FALLBACK_PREFIXES):
            response = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        else:
            response = client.messages.create(**kwargs)
    except Exception as exc:
        raise _translate(anthropic, exc, model) from exc

    if response.stop_reason == "refusal":
        raise LLMError("A Anthropic recusou analisar esta transcrição.", "refusal")
    if response.stop_reason == "max_tokens":
        raise LLMError("A resposta da Anthropic foi cortada (limite de tokens).", "parse")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except ValueError as exc:
        raise LLMError("A Anthropic devolveu uma resposta que não é JSON válido.", "parse") from exc


def list_models(api_key: str, base_url: str | None = None) -> list[str]:
    anthropic, client = _client(api_key, base_url)
    try:
        return [m.id for m in client.models.list(limit=100)]
    except Exception as exc:
        raise _translate(anthropic, exc) from exc
