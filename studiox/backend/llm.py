"""One entry point for every AI provider the user can configure (see backend/credentials.py)."""
from __future__ import annotations

import os

from backend import credentials, llm_anthropic, llm_cli, llm_openai_compat
from backend.llm_anthropic import LLMError

__all__ = ["LLMError", "complete_json", "list_models", "test_connection", "resolve"]


def _base_url(provider: str) -> str:
    # LLM_BASE_URL_<PROVIDER> points a provider at a proxy or a local test server
    return os.environ.get(f"LLM_BASE_URL_{provider.upper()}") or credentials.PROVIDERS[provider]["base_url"]


def resolve(provider: str | None, model: str | None = None) -> tuple[str, str, str]:
    """(provider, model, api_key) to use. Raises LLMError with a clear message when a key is missing."""
    provider = provider or credentials.default_provider()
    if not provider or not credentials.is_provider(provider):
        raise LLMError("Nenhuma IA configurada. Salve uma chave na tela Configurações.", "auth")
    key = credentials.get_key(provider)
    if not key:
        name = credentials.PROVIDERS[provider]["name"]
        if credentials.PROVIDERS[provider]["kind"] == "cli":
            raise LLMError(f"O {name} não foi encontrado neste computador. Instale-o e faça login nele.", "auth")
        raise LLMError(f"A chave do {name} não está configurada. Salve-a na tela Configurações.", "auth")
    return provider, (model or "").strip() or credentials.get_model(provider), key


def complete_json(provider: str | None, system: str, user: str, schema: dict, model: str | None = None) -> dict:
    provider, model, key = resolve(provider, model)
    meta = credentials.PROVIDERS[provider]
    if meta["kind"] == "cli":  # `key` is the path of the installed program
        return llm_cli.complete_json(provider, key, model, system, user, schema)
    if meta["kind"] == "anthropic":
        base = os.environ.get("LLM_BASE_URL_ANTHROPIC") or None
        return llm_anthropic.complete_json(key, model, system, user, schema, base_url=base)
    return llm_openai_compat.complete_json(provider, meta["name"], _base_url(provider), key, model, system, user)


def list_models(provider: str, api_key: str | None = None) -> list[str]:
    if credentials.PROVIDERS[provider]["kind"] == "cli":
        return credentials.MODEL_SUGGESTIONS.get(provider, [])
    key = api_key or credentials.get_key(provider)
    if not key:
        raise LLMError("Salve a chave primeiro para carregar os modelos.", "auth")
    meta = credentials.PROVIDERS[provider]
    if meta["kind"] == "anthropic":
        return llm_anthropic.list_models(key, base_url=os.environ.get("LLM_BASE_URL_ANTHROPIC") or None)
    return llm_openai_compat.list_models(provider, meta["name"], _base_url(provider), key)


def test_connection(provider: str, api_key: str | None = None) -> dict:
    """Checks a key (the typed one, or the saved one) with a free call; never spends tokens."""
    meta = credentials.PROVIDERS[provider]
    if meta["kind"] == "cli":
        exe = credentials.get_key(provider)
        if not exe:
            return {"ok": False, "message": f"{meta['name']} não encontrado neste computador. Instale-o e faça login nele."}
        return llm_cli.test_connection(provider, exe, meta["name"], credentials.get_model(provider))
    key = api_key or credentials.get_key(provider)
    if not key:
        return {"ok": False, "message": "Cole a chave (ou salve-a) antes de testar."}
    try:
        if meta["kind"] == "anthropic":
            models = llm_anthropic.list_models(key, base_url=os.environ.get("LLM_BASE_URL_ANTHROPIC") or None)
        elif provider == "openrouter":  # its /models is public, so the key needs its own probe
            llm_openai_compat.check_key(provider, meta["name"], _base_url(provider), key)
            models = []
        else:
            models = llm_openai_compat.list_models(provider, meta["name"], _base_url(provider), key)
    except LLMError as exc:
        # A rate limit proves the key is valid
        return {"ok": exc.kind == "rate", "message": str(exc)}
    extra = f" {len(models)} modelos disponíveis." if models else ""
    if provider == "groq" and any(m.startswith("whisper") for m in models):
        extra += " Transcrição com Whisper disponível."
    return {"ok": True, "message": f"Conexão com {meta['name']} funcionando.{extra}"}
