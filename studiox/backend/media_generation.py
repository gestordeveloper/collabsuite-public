"""Pictures and short clips made by an AI provider for the split screen.

Only OpenAI is wired (its key is already in the Configurações screen): images through /v1/images/generations
and videos through Sora (/v1/videos: create, poll, download). Every call spends money on the user's own
account, so nothing here runs by itself: a job starts only when the editor asks for it, and there is a hard
cap on how many can run at once and per hour.

The text model of the default provider (Groq, OpenAI, OpenRouter or Anthropic) can also write the description
of the picture from what is said in the scene (`suggest_prompt`), which costs a few tokens.
"""
from __future__ import annotations

import base64
import json
import os
import threading
import time
import uuid
from collections import deque
from typing import Any, Callable

import requests

from backend import credentials, llm, media_library, projects
from backend.llm import LLMError
from backend.media_library import MediaError, media_dir
from backend.split_screen import media_aspect

IMAGE_MODELS = ("gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-1")   # tried in this order
VIDEO_MODELS = ("sora-2", "sora-2-pro")
VIDEO_SECONDS = ("4", "8", "12")
MAX_PROMPT = 2000
MAX_RUNNING = 3
MAX_PER_HOUR = 40
VIDEO_TIMEOUT_S = 20 * 60
POLL_S = float(os.environ.get("MEDIA_POLL_S") or 5.0)   # seconds between checks of a video job (tests shorten it)

JOBS: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()
_recent: deque[float] = deque()


class GenerationError(Exception):
    """Something the user can act on (no credit, prompt refused...); the message is shown as is."""


def _base() -> str:
    return llm._base_url("openai").rstrip("/")


def _key() -> str:
    key = credentials.get_key("openai")
    if not key:
        raise GenerationError("Para gerar imagens e vídeos com IA, salve a chave da OpenAI na tela Configurações.")
    return key


def is_configured() -> bool:
    return bool(credentials.get_key("openai"))


def _error(status: int, body: str) -> GenerationError:
    code, detail = "", ""
    try:
        err = json.loads(body).get("error")
        if isinstance(err, dict):
            code, detail = str(err.get("code") or ""), str(err.get("message") or "")
        else:
            detail = str(err or "")
    except (ValueError, AttributeError):
        detail = body[:200]
    low = f"{code} {detail}".lower()
    if status == 401:
        return GenerationError("A OpenAI recusou a chave salva (inválida ou revogada). Confira em Configurações.")
    if "moderation" in low or "content_policy" in low or "safety" in low:
        return GenerationError("A OpenAI recusou esta descrição por política de conteúdo. Reescreva sem pessoas reais, "
                               "marcas, personagens protegidos ou temas sensíveis.")
    if status == 429 and ("quota" in low or "billing" in low or "credit" in low):
        return GenerationError("A conta da OpenAI está sem crédito ou atingiu o limite de gastos.")
    if status == 429:
        return GenerationError("Limite de uso da OpenAI atingido. Espere um pouco e tente de novo.")
    if status == 403:
        return GenerationError(f"Sua conta da OpenAI não tem acesso a este modelo. {detail}".strip())
    if status >= 500:
        return GenerationError(f"A OpenAI está com problemas (erro {status}). Tente de novo em instantes.")
    return GenerationError(f"A OpenAI recusou o pedido (erro {status}). {detail}".strip()[:300])


def _model_missing(status: int, body: str) -> bool:
    low = body.lower()
    return status == 404 or (status in (400, 403) and "model" in low and any(w in low for w in ("not found", "does not exist", "invalid", "unknown")))


# ----------------------------------------------------------------------------
# Pictures and clips
# ----------------------------------------------------------------------------
def image_size_for(aspect: float) -> str:
    return "1536x1024" if aspect >= 1.25 else ("1024x1536" if aspect <= 0.8 else "1024x1024")


def video_size_for(aspect: float) -> str:
    return "1280x720" if aspect >= 1.0 else "720x1280"


def generate_image(prompt: str, size: str, model: str | None = None) -> tuple[bytes, str]:
    headers = {"Authorization": f"Bearer {_key()}", "Content-Type": "application/json"}
    last: GenerationError | None = None
    for m in ([model] if model else list(IMAGE_MODELS)):
        try:
            r = requests.post(f"{_base()}/images/generations", headers=headers, timeout=(20, 240),
                              json={"model": m, "prompt": prompt, "size": size, "n": 1})
        except requests.RequestException as exc:
            raise GenerationError(f"Não consegui falar com a OpenAI: {exc.__class__.__name__}.")
        if r.status_code == 200:
            item = (r.json().get("data") or [{}])[0]
            if item.get("b64_json"):
                return base64.b64decode(item["b64_json"]), m
            if item.get("url"):
                return requests.get(item["url"], timeout=(20, 120)).content, m
            raise GenerationError("A OpenAI respondeu sem imagem.")
        if _model_missing(r.status_code, r.text) and not model:
            last = _error(r.status_code, r.text)
            continue  # this account/version does not know the model: try the next name
        raise _error(r.status_code, r.text)
    raise last or GenerationError("Nenhum modelo de imagem da OpenAI respondeu.")


def generate_video(prompt: str, seconds: str, size: str, model: str | None,
                   on_progress: Callable[[int, str], None]) -> tuple[bytes, str]:
    headers = {"Authorization": f"Bearer {_key()}"}
    model = model or VIDEO_MODELS[0]
    body = {"model": model, "prompt": prompt, "seconds": seconds, "size": size}
    try:
        r = requests.post(f"{_base()}/videos", headers={**headers, "Content-Type": "application/json"}, json=body, timeout=(20, 120))
        if r.status_code in (400, 415) and "content" in r.text.lower() and "type" in r.text.lower():
            r = requests.post(f"{_base()}/videos", headers=headers, data=body, timeout=(20, 120))  # multipart form
    except requests.RequestException as exc:
        raise GenerationError(f"Não consegui falar com a OpenAI: {exc.__class__.__name__}.")
    if r.status_code not in (200, 201):
        raise _error(r.status_code, r.text)
    video_id = r.json().get("id")
    if not video_id:
        raise GenerationError("A OpenAI não devolveu o número do vídeo.")

    on_progress(3, "Na fila da OpenAI…")
    t0 = time.time()
    while True:
        if time.time() - t0 > VIDEO_TIMEOUT_S:
            raise GenerationError("O vídeo demorou mais de 20 minutos e foi abandonado. Tente de novo com uma cena mais simples.")
        time.sleep(POLL_S)
        try:
            s = requests.get(f"{_base()}/videos/{video_id}", headers=headers, timeout=(20, 60))
        except requests.RequestException:
            continue  # a network hiccup while waiting is not a failure
        if s.status_code != 200:
            if s.status_code in (401, 403, 404):
                raise _error(s.status_code, s.text)
            continue
        info = s.json()
        status = info.get("status")
        if status == "failed":
            err = info.get("error") or {}
            msg = err.get("message") if isinstance(err, dict) else str(err)
            raise _error(400, json.dumps({"error": {"code": (err or {}).get("code", "") if isinstance(err, dict) else "", "message": msg or "falhou"}}))
        if status == "completed":
            break
        on_progress(max(3, min(95, int(info.get("progress") or 0))), "Gerando o vídeo…")

    on_progress(96, "Baixando o vídeo…")
    try:
        c = requests.get(f"{_base()}/videos/{video_id}/content", headers=headers, timeout=(20, 300))
    except requests.RequestException as exc:
        raise GenerationError(f"O vídeo foi gerado mas o download falhou: {exc.__class__.__name__}.")
    if c.status_code != 200 or not c.content:
        raise _error(c.status_code, c.text[:300])
    return c.content, model


# ----------------------------------------------------------------------------
# Jobs
# ----------------------------------------------------------------------------
def _reserve() -> None:
    now = time.time()
    with _lock:
        while _recent and now - _recent[0] > 3600:
            _recent.popleft()
        if sum(1 for j in JOBS.values() if j["status"] == "running") >= MAX_RUNNING:
            raise GenerationError(f"Já há {MAX_RUNNING} gerações em andamento. Espere uma terminar.")
        if len(_recent) >= MAX_PER_HOUR:
            raise GenerationError(f"Limite de segurança: no máximo {MAX_PER_HOUR} gerações por hora (cada uma custa na sua conta da OpenAI).")
        _recent.append(now)


def _run(job: dict[str, Any], pid: str, kind: str, prompt: str, size: str, seconds: str, model: str | None, name: str) -> None:
    try:
        media_dir(pid)
        if kind == "image":
            job["message"] = "Gerando a imagem…"
            job["progress"] = 10
            data, used = generate_image(prompt, size, model)
            ext = ".png"
        else:
            def progress(p: int, msg: str) -> None:
                job["progress"], job["message"] = p, msg
            data, used = generate_video(prompt, seconds, size, model, progress)
            ext = ".mp4"
        job["progress"], job["message"] = 98, "Salvando…"
        tmp = media_dir(pid) / f"gen_{job['id']}{ext}"
        tmp.write_bytes(data)
        item = media_library.add(pid, tmp, name, kind, source="ai", prompt=prompt, model=used)
        job.update(status="done", progress=100, message="Pronto", media=media_library.public(item, pid))
    except (GenerationError, MediaError) as exc:
        job.update(status="error", error=str(exc), message=str(exc))
    except Exception as exc:  # never leave a job "running" forever
        job.update(status="error", error=f"Erro inesperado: {exc}", message=f"Erro inesperado: {exc}")
    finally:
        job["finished_at"] = time.time()


def start_job(pid: str, kind: str, prompt: str, layout: str = "top", ratio: float = 0.5, seconds: str = "4",
              model: str | None = None) -> dict[str, Any]:
    if kind not in ("image", "video"):
        raise GenerationError("Tipo de mídia inválido.")
    prompt = (prompt or "").strip()
    if len(prompt) < 3:
        raise GenerationError("Descreva o que você quer ver (pelo menos uma frase curta).")
    prompt = prompt[:MAX_PROMPT]
    if seconds not in VIDEO_SECONDS:
        seconds = "4"
    _key()  # fail now, with the clear message, before a job exists
    info = projects.read_info(pid)
    meta = info.get("meta") or {}
    aspect = media_aspect(int(meta.get("display_width") or 1080), int(meta.get("display_height") or 1920), layout, ratio)
    size = image_size_for(aspect) if kind == "image" else video_size_for(aspect)
    _reserve()
    job = {"id": uuid.uuid4().hex[:10], "project_id": pid, "kind": kind, "status": "running", "progress": 0,
           "message": "Enviando o pedido…", "error": None, "media": None, "created_at": time.time(), "finished_at": None}
    with _lock:
        JOBS[job["id"]] = job
        for jid in [j for j, v in JOBS.items() if v["finished_at"] and time.time() - v["finished_at"] > 3600]:
            JOBS.pop(jid, None)
    label = "IA " + ("imagem" if kind == "image" else "vídeo") + " " + time.strftime("%H:%M")
    threading.Thread(target=_run, args=(job, pid, kind, prompt, size, seconds, (model or "").strip() or None, label), daemon=True).start()
    return job


def project_jobs(pid: str) -> list[dict[str, Any]]:
    with _lock:
        return [dict(j) for j in JOBS.values() if j["project_id"] == pid]


# ----------------------------------------------------------------------------
# Writing the description from what is said
# ----------------------------------------------------------------------------
_SUGGEST_SCHEMA = {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"], "additionalProperties": False}
_SUGGEST_SYSTEM = (
    "Você escreve descrições para gerar {what} que ilustram uma cena de um vídeo curto vertical de redes sociais, "
    "mostrado ao lado de quem fala. Leia a fala e descreva UMA imagem concreta que reforce a ideia (objeto, ambiente ou "
    "ação, não abstrações). Regras: 1 a 3 frases em português; estilo fotográfico realista com boa luz; {motion}"
    "sem texto escrito, sem legendas, sem logotipos ou marcas; sem pessoas reais ou famosas; sem violência. "
    'Responda SOMENTE com JSON: {{"prompt": "..."}}.'
)


def suggest_prompt(kind: str, text: str) -> str:
    text = (text or "").strip()[:2000]
    if not text:
        raise GenerationError("Não há fala nesse trecho para eu me basear. Escreva a descrição você mesmo.")
    what = "uma imagem" if kind == "image" else "um vídeo de poucos segundos"
    motion = "" if kind == "image" else "descreva também o movimento da câmera e da cena; "
    try:
        out = llm.complete_json(None, _SUGGEST_SYSTEM.format(what=what, motion=motion), f"FALA DA CENA:\n{text}", _SUGGEST_SCHEMA)
    except LLMError as exc:
        raise GenerationError(str(exc))
    suggestion = str(out.get("prompt") or "").strip() if isinstance(out, dict) else ""
    if not suggestion:
        raise GenerationError("A IA não sugeriu nenhuma descrição. Tente de novo ou escreva a sua.")
    return suggestion[:MAX_PROMPT]
