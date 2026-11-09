"""API keys of the AI providers (Groq, OpenAI, OpenRouter, Anthropic) and the model chosen for each, plus the keys
of other services the app calls (ElevenLabs Scribe, the transcription): everything the Configurações screen holds.

Keys are stored in storage/credentials.json. On Windows each key is encrypted with DPAPI, i.e. tied
to the Windows user that runs the server: copying or zipping the project folder does not leak them.
On other systems the file only obfuscates the key (base64) and is flagged as such. Keys never leave
the server: the HTTP API only ever reports a masked tail.

A key can also come from the usual environment variable (GROQ_API_KEY, OPENAI_API_KEY,
OPENROUTER_API_KEY, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY); a saved key wins over it. The ElevenLabs key also
used to live in a .env file: that still works as a fallback and can be moved into the store with one click.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import threading
from typing import Any

from backend.config import STORAGE_DIR, read_dotenv_value
from backend.fsutil import replace_file

CREDENTIALS_PATH = STORAGE_DIR / "credentials.json"
_lock = threading.RLock()

PROVIDERS: dict[str, dict[str, Any]] = {
    "groq": {
        "name": "Groq", "kind": "openai", "base_url": "https://api.groq.com/openai/v1",
        "env": "GROQ_API_KEY", "default_model": "llama-3.3-70b-versatile", "key_hint": "gsk_…",
        "keys_url": "https://console.groq.com/keys",
        "note": "Muito rápido e com plano gratuito. Bom para revisar transcrições longas.",
    },
    "openai": {
        "name": "OpenAI", "kind": "openai", "base_url": "https://api.openai.com/v1",
        "env": "OPENAI_API_KEY", "default_model": "gpt-4o-mini", "key_hint": "sk-…",
        "keys_url": "https://platform.openai.com/api-keys",
        "note": "Modelos GPT. Escolha o modelo na lista depois de salvar a chave.",
    },
    "openrouter": {
        "name": "OpenRouter", "kind": "openai", "base_url": "https://openrouter.ai/api/v1",
        "env": "OPENROUTER_API_KEY", "default_model": "openai/gpt-4o-mini", "key_hint": "sk-or-…",
        "keys_url": "https://openrouter.ai/keys",
        "note": "Uma chave para centenas de modelos de vários fabricantes (formato provedor/modelo).",
    },
    "anthropic": {
        "name": "Anthropic (Claude)", "kind": "anthropic", "base_url": "https://api.anthropic.com",
        "env": "ANTHROPIC_API_KEY", "default_model": "claude-opus-5", "key_hint": "sk-ant-…",
        "keys_url": "https://console.anthropic.com/settings/keys",
        "note": "Modelos Claude. Opus 5 é o mais preciso; Sonnet 5 e Haiku 4.5 são mais baratos.",
    },
    # CLIs already installed and logged in on this computer: no key, the subscription of the user pays (llm_cli.py)
    "claude_cli": {
        "name": "Claude Code (CLI)", "kind": "cli", "env": "STUDIOX_CLAUDE_PATH", "default_model": "sonnet",
        "key_hint": "", "keys_url": "https://docs.anthropic.com/en/docs/claude-code",
        "note": "Usa o Claude Code instalado neste computador, com o seu login (assinatura). Sem chave de API; cada chamada leva alguns segundos.",
    },
    "codex_cli": {
        "name": "Codex (CLI)", "kind": "cli", "env": "STUDIOX_CODEX_PATH", "default_model": "",
        "key_hint": "", "keys_url": "https://developers.openai.com/codex/cli",
        "note": "Usa o Codex instalado neste computador, com o seu login (ChatGPT). Sem chave de API; deixe o modelo vazio para usar o da sua conta.",
    },
    "antigravity_cli": {
        "name": "Antigravity (CLI)", "kind": "cli", "env": "STUDIOX_ANTIGRAVITY_PATH", "default_model": "gemini-3.8-flash-medium",
        "key_hint": "", "keys_url": "https://antigravity.google",
        "note": "Usa o Antigravity (agy) instalado neste computador, com o seu login do Google. Dá acesso a modelos Gemini, Claude e GPT-OSS; rode «agy models» para ver os seus.",
    },
    "opencode_cli": {
        "name": "OpenCode (CLI)", "kind": "cli", "env": "STUDIOX_OPENCODE_PATH", "default_model": "opencode/big-pickle",
        "key_hint": "", "keys_url": "https://opencode.ai/docs/cli",
        "note": "Usa o OpenCode instalado neste computador (formato provedor/modelo). O padrão é um modelo gratuito; rode «opencode models» para ver os seus.",
    },
}
# Services that are not language models: they have a key but no model list and no "default" choice.
SERVICES: dict[str, dict[str, Any]] = {
    "elevenlabs": {
        "name": "ElevenLabs Scribe", "env": "ELEVENLABS_API_KEY", "key_hint": "sk_…",
        "keys_url": "https://elevenlabs.io/app/settings/api-keys",
        "note": "Transcrição do áudio (texto palavra por palavra) usada nas legendas e nos cortes. "
                "Sem a chave, o StudioX usa o Whisper deste computador, se estiver instalado.",
    },
}
MODEL_SUGGESTIONS: dict[str, list[str]] = {
    "groq": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    "openai": ["gpt-4o-mini", "gpt-4o"],
    "openrouter": ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"],
    "anthropic": ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    "claude_cli": ["opus", "sonnet", "haiku"],
    "codex_cli": [],
    "antigravity_cli": ["gemini-3.8-flash-low", "gemini-3.8-flash-medium", "gemini-3.8-flash-high",
                        "claude-sonnet-5-5-medium", "claude-opus-5-5-medium", "gpt-oss-120b-medium"],
    "opencode_cli": ["opencode/big-pickle", "opencode/exo-free"],
}


# ----------------------------------------------------------------------------
# Encryption at rest (Windows DPAPI, no extra packages)
# ----------------------------------------------------------------------------
def _dpapi(data: bytes, encrypt: bool) -> bytes:
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    fn = crypt32.CryptProtectData if encrypt else crypt32.CryptUnprotectData
    fn.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR if encrypt else ctypes.c_void_p, ctypes.POINTER(Blob),
                   ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]

    buf = ctypes.create_string_buffer(data, len(data))
    src = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    out = Blob()
    if not fn(ctypes.byref(src), None, None, None, None, 0, ctypes.byref(out)):
        raise OSError("DPAPI recusou a operação")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def _seal(secret: str) -> tuple[str, str]:
    raw = secret.encode("utf-8")
    if sys.platform == "win32":
        try:
            return base64.b64encode(_dpapi(raw, True)).decode(), "dpapi"
        except Exception:
            pass
    return base64.b64encode(raw).decode(), "plain"


def _open(blob: str, scheme: str) -> str | None:
    try:
        raw = base64.b64decode(blob)
        if scheme == "dpapi":
            raw = _dpapi(raw, False)
        return raw.decode("utf-8")
    except Exception:
        return None  # another Windows user / corrupted: treated as "not configured"


# ----------------------------------------------------------------------------
# Storage
# ----------------------------------------------------------------------------
def _load() -> dict:
    try:
        data = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("providers", {})
            data.setdefault("services", {})
            return data
    except (OSError, ValueError):
        pass
    return {"providers": {}, "services": {}, "default_provider": None}


def _save(data: dict) -> None:
    tmp = CREDENTIALS_PATH.with_name(f"{CREDENTIALS_PATH.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    replace_file(tmp, CREDENTIALS_PATH)


def is_provider(provider: str) -> bool:
    return provider in PROVIDERS


def get_key(provider: str) -> str | None:
    """The key to use for `provider`: the saved one, else the environment variable.
    For a CLI provider there is no key: this is the path of the installed program (None when it is not installed)."""
    if PROVIDERS[provider]["kind"] == "cli":
        from backend import llm_cli
        return llm_cli.find_cli(provider)
    with _lock:
        entry = _load()["providers"].get(provider) or {}
    saved = _open(entry["key"], entry.get("scheme", "plain")) if entry.get("key") else None
    return saved or (os.environ.get(PROVIDERS[provider]["env"]) or None)


def key_source(provider: str) -> str | None:
    if PROVIDERS[provider]["kind"] == "cli":
        return "cli" if get_key(provider) else None
    with _lock:
        entry = _load()["providers"].get(provider) or {}
    if entry.get("key") and _open(entry["key"], entry.get("scheme", "plain")):
        return "saved"
    return "env" if os.environ.get(PROVIDERS[provider]["env"]) else None


def get_model(provider: str) -> str:
    with _lock:
        entry = _load()["providers"].get(provider) or {}
    return (entry.get("model") or "").strip() or PROVIDERS[provider]["default_model"]


def set_credentials(provider: str, api_key: str | None = None, model: str | None = None) -> None:
    """Saves the key and/or the model. `api_key=None` keeps the current key."""
    with _lock:
        data = _load()
        entry = data["providers"].setdefault(provider, {})
        if api_key is not None and api_key.strip():
            entry["key"], entry["scheme"] = _seal(api_key.strip())
        if model is not None:
            if model.strip():
                entry["model"] = model.strip()[:120]
            else:
                entry.pop("model", None)
        _save(data)


def delete_key(provider: str) -> None:
    with _lock:
        data = _load()
        entry = data["providers"].get(provider)
        if entry:
            entry.pop("key", None)
            entry.pop("scheme", None)
        if data.get("default_provider") == provider and not os.environ.get(PROVIDERS[provider]["env"]):
            data["default_provider"] = None
        _save(data)


def mask(key: str | None) -> str:
    if not key:
        return ""
    return f"{key[:3]}…{key[-4:]}" if len(key) > 12 else "••••"


def configured_providers() -> list[str]:
    return [p for p in PROVIDERS if get_key(p)]


def default_provider() -> str | None:
    """The provider used when a template does not name one: the chosen default, else the first configured."""
    with _lock:
        chosen = _load().get("default_provider")
    ready = configured_providers()
    if chosen in ready:
        return chosen
    return ready[0] if ready else None


def set_default_provider(provider: str) -> None:
    with _lock:
        data = _load()
        data["default_provider"] = provider
        _save(data)


# ----------------------------------------------------------------------------
# Other services (ElevenLabs)
# ----------------------------------------------------------------------------
def is_service(service: str) -> bool:
    return service in SERVICES


def _saved_service_key(service: str) -> str | None:
    with _lock:
        entry = _load()["services"].get(service) or {}
    return _open(entry["key"], entry.get("scheme", "plain")) if entry.get("key") else None


def get_service_key(service: str) -> str | None:
    """The key to use: the saved one, else a .env file (older setups), else the environment variable."""
    return _saved_service_key(service) or read_dotenv_value(SERVICES[service]["env"]) or os.environ.get(SERVICES[service]["env"]) or None


def service_key_source(service: str) -> str | None:
    """Where get_service_key finds the key: 'saved' | 'dotenv' | 'env' | None."""
    if _saved_service_key(service):
        return "saved"
    env = SERVICES[service]["env"]
    if read_dotenv_value(env):
        return "dotenv"
    return "env" if os.environ.get(env) else None


def set_service_key(service: str, api_key: str) -> None:
    with _lock:
        data = _load()
        entry = data["services"].setdefault(service, {})
        entry["key"], entry["scheme"] = _seal(api_key.strip())
        _save(data)


def delete_service_key(service: str) -> None:
    with _lock:
        data = _load()
        data["services"].pop(service, None)
        _save(data)


def import_service_key_from_dotenv(service: str) -> bool:
    """Moves the key written in a .env file into the encrypted store (the .env file itself is left alone).
    The key never leaves the server. False when no .env file has one."""
    value = read_dotenv_value(SERVICES[service]["env"])
    if not value:
        return False
    set_service_key(service, value)
    return True


def status() -> dict:
    """Everything the settings screen needs. Never contains a key, only its masked tail."""
    default = default_provider()
    items = []
    for pid, meta in PROVIDERS.items():
        key = get_key(pid)
        items.append({
            "id": pid, "name": meta["name"], "kind": meta["kind"], "configured": bool(key),
            "source": key_source(pid), "masked": "" if meta["kind"] == "cli" else mask(key), "model": get_model(pid),
            "default_model": meta["default_model"], "key_hint": meta["key_hint"], "keys_url": meta["keys_url"],
            "env": meta["env"], "note": meta["note"], "models": MODEL_SUGGESTIONS.get(pid, []),
            "path": key if meta["kind"] == "cli" else None,
        })
    services = []
    for sid, meta in SERVICES.items():
        key = get_service_key(sid)
        services.append({
            "id": sid, "name": meta["name"], "configured": bool(key), "source": service_key_source(sid), "masked": mask(key),
            "key_hint": meta["key_hint"], "keys_url": meta["keys_url"], "env": meta["env"], "note": meta["note"],
        })
    encrypted = sys.platform == "win32"
    return {"providers": items, "services": services, "default_provider": default, "encrypted_at_rest": encrypted}
