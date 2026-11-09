"""Settings API: the credentials the app uses: the AI providers (Groq, OpenAI, OpenRouter, Anthropic) and the
transcription service (ElevenLabs Scribe).

Keys are write-only over HTTP: they are saved and used by the server, and the API only ever reports
"configured or not" and a masked tail. Changing them is restricted to requests that come from the
machine running the server (the app listens on the network, and these keys spend real money).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend import credentials, llm, review_service, transcriber
from backend.config import get_elevenlabs_api_key, has_whisper_available

router = APIRouter(prefix="/api/settings")

_KEY_RE = re.compile(r"^[A-Za-z0-9_\-\.=:]{8,300}$")
_PREFIX = {"groq": "gsk_", "openai": "sk-", "openrouter": "sk-or-", "anthropic": "sk-ant-"}


def _is_local(request: Request) -> bool:
    client = request.client.host if request.client else ""
    server = (request.scope.get("server") or ("", 0))[0]
    return client in ("127.0.0.1", "::1", "localhost") or (bool(client) and client == server)


def _require_local(request: Request) -> None:
    if not _is_local(request):
        raise HTTPException(status_code=403, detail="As chaves só podem ser alteradas no computador onde o StudioX está rodando.")


def _provider(provider: str) -> str:
    if not credentials.is_provider(provider):
        raise HTTPException(status_code=404, detail="Provedor desconhecido")
    return provider


def _clean_key(provider: str, raw: str) -> tuple[str, str | None]:
    key = (raw or "").strip().strip('"').strip("'")
    if not _KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Chave inválida: use só a chave, sem espaços, aspas ou quebras de linha.")
    warning = None
    prefix = _PREFIX.get(provider)
    if prefix and not key.startswith(prefix):
        others = [n for n, pre in _PREFIX.items() if key.startswith(pre) and n != provider and pre != "sk-"]
        if others:
            warning = f"Essa chave parece ser do {credentials.PROVIDERS[others[0]]['name']}, não do {credentials.PROVIDERS[provider]['name']}."
    return key, warning


@router.get("/ai")
def get_ai_settings(request: Request):
    local = _is_local(request)
    data = credentials.status()
    if not local:
        for p in data["providers"] + data["services"]:
            p["masked"] = ""
    data["local"] = local
    data["transcription"] = {"elevenlabs": bool(get_elevenlabs_api_key()), "groq": bool(credentials.get_key("groq")),
                             "whisper": has_whisper_available()}
    return data


class ProviderBody(BaseModel):
    api_key: str | None = None   # None / empty keeps the saved key
    model: str | None = None     # None keeps the saved model; "" goes back to the provider's default


@router.put("/ai/{provider}")
def save_provider(provider: str, body: ProviderBody, request: Request):
    _require_local(request)
    _provider(provider)
    warning = None
    key = None
    if body.api_key and body.api_key.strip():
        key, warning = _clean_key(provider, body.api_key)
    credentials.set_credentials(provider, api_key=key, model=body.model)
    return {"saved": True, "warning": warning, "status": next(p for p in credentials.status()["providers"] if p["id"] == provider)}


@router.delete("/ai/{provider}/key")
def delete_provider_key(provider: str, request: Request):
    _require_local(request)
    credentials.delete_key(_provider(provider))
    return {"deleted": True}


class TestBody(BaseModel):
    api_key: str | None = None   # test a key before saving it


@router.post("/ai/{provider}/test")
def test_provider(provider: str, body: TestBody, request: Request):
    _require_local(request)
    _provider(provider)
    key = None
    if body.api_key and body.api_key.strip():
        key, _warning = _clean_key(provider, body.api_key)
    return llm.test_connection(provider, key)


@router.get("/ai/{provider}/models")
def provider_models(provider: str, request: Request):
    _require_local(request)
    _provider(provider)
    try:
        return {"models": llm.list_models(provider)}
    except llm.LLMError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ----------------------------------------------------------------------------
# Other services (ElevenLabs): same rules as the AI keys (write-only, local machine only)
# ----------------------------------------------------------------------------
def _service(service: str) -> str:
    if not credentials.is_service(service):
        raise HTTPException(status_code=404, detail="Serviço desconhecido")
    return service


def _clean_service_key(service: str, raw: str) -> tuple[str, str | None]:
    key = (raw or "").strip().strip('"').strip("'")
    if not _KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Chave inválida: use só a chave, sem espaços, aspas ou quebras de linha.")
    others = [n for n, pre in _PREFIX.items() if key.startswith(pre)]
    warning = f"Essa chave parece ser do {credentials.PROVIDERS[others[0]]['name']}, não do {credentials.SERVICES[service]['name']}." if others else None
    return key, warning


def _service_status(service: str) -> dict:
    return next(x for x in credentials.status()["services"] if x["id"] == service)


class ServiceBody(BaseModel):
    api_key: str | None = None


@router.put("/services/{service}")
def save_service(service: str, body: ServiceBody, request: Request):
    _require_local(request)
    _service(service)
    if not (body.api_key and body.api_key.strip()):
        raise HTTPException(status_code=400, detail="Cole a chave para salvar.")
    key, warning = _clean_service_key(service, body.api_key)
    credentials.set_service_key(service, key)
    return {"saved": True, "warning": warning, "status": _service_status(service)}


@router.delete("/services/{service}/key")
def delete_service_key(service: str, request: Request):
    _require_local(request)
    credentials.delete_service_key(_service(service))
    return {"deleted": True, "status": _service_status(service)}


@router.post("/services/{service}/import-env")
def import_service_env(service: str, request: Request):
    """Moves the key that sits in the .env file into the encrypted store, without it ever reaching the browser."""
    _require_local(request)
    _service(service)
    if not credentials.import_service_key_from_dotenv(service):
        raise HTTPException(status_code=400, detail="Não encontrei a chave em nenhum arquivo .env.")
    return {"saved": True, "status": _service_status(service)}


@router.post("/services/{service}/test")
def test_service(service: str, body: ServiceBody, request: Request):
    _require_local(request)
    _service(service)
    key = None
    if body.api_key and body.api_key.strip():
        key, _warning = _clean_service_key(service, body.api_key)
    key = key or credentials.get_service_key(service)
    if not key:
        return {"ok": False, "message": "Cole a chave (ou salve-a) antes de testar."}
    return transcriber.check_elevenlabs_key(key)


@router.get("/review")
def get_review_settings():
    """The standing instructions added to every review, and the base prompt they are added to (read-only)."""
    return {"instructions": review_service.get_instructions(), "max_chars": review_service.MAX_INSTRUCTIONS,
            "prompt": review_service.prompt_preview()}


class ReviewBody(BaseModel):
    instructions: str = ""


@router.put("/review")
def save_review_settings(body: ReviewBody):
    return {"saved": True, "instructions": review_service.set_instructions(body.instructions)}


class DefaultBody(BaseModel):
    provider: str


@router.post("/ai-default")
def set_default(body: DefaultBody, request: Request):
    _require_local(request)
    _provider(body.provider)
    if not credentials.get_key(body.provider):
        raise HTTPException(status_code=400, detail="Salve a chave deste provedor antes de torná-lo o padrão.")
    credentials.set_default_provider(body.provider)
    return {"default_provider": body.provider}
