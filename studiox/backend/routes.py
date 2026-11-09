"""HTTP API for saved projects, edit templates and the editing queue."""
from __future__ import annotations

import base64
import copy
import io
import json
import re
import shutil
import threading
import uuid
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend import audio_timeline, edit_templates, highlight_service, llm, projects, queue_service, review_service
from backend.config import URL_BASE, PROJECTS_DIR
from backend.headlines import MAX_IMAGE_BYTES
from backend.media_processor import browser_playable_copy, probe_display_size, probe_media, render_size

router = APIRouter()

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}


def _project_or_404(pid: str) -> dict:
    try:
        return projects.read_info(pid)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")


# ----------------------------------------------------------------------------
# Projects
# ----------------------------------------------------------------------------
@router.get("/api/projects")
def list_projects():
    return {"projects": projects.list_projects()}


class StateBody(BaseModel):
    edit: dict[str, Any] | None = None
    name: str | None = None
    copy_text: str | None = None     # the script the person was reading (drives the AI review)
    strict_copy: bool | None = None  # cut speech that is not in the copy


@router.api_route("/api/projects/{project_id}/state", methods=["PUT", "POST"])  # POST: navigator.sendBeacon on tab close
def save_state(project_id: str, body: StateBody):
    _project_or_404(project_id)
    edit = projects.sanitize_edit(body.edit) if body.edit is not None else None

    def mutate(state: dict) -> None:
        if edit is not None:
            # A tab loaded before a feature existed (music, LUT, zoom...) does not send its field: keep what is saved
            # instead of wiping it with the default
            if isinstance(body.edit, dict) and isinstance(state.get("edit"), dict):
                for key in ("music", "lut", "zoom", "transition_scale", "canvas"):
                    if key not in body.edit and state["edit"].get(key) is not None:
                        edit[key] = state["edit"][key]
            state["edit"] = edit
        if body.name is not None:
            state["name"] = body.name.strip()[:120] or None
        if body.copy_text is not None or body.strict_copy is not None:
            cur = state.get("copy") or {}
            state["copy"] = {"text": review_service.clean_copy(body.copy_text) if body.copy_text is not None else cur.get("text", ""),
                             "strict": bool(body.strict_copy) if body.strict_copy is not None else bool(cur.get("strict", True))}
    state = projects.update_state(project_id, mutate)
    return {"saved_at": state["updated_at"]}


@router.get("/api/projects/{project_id}/transcript")
def get_transcript(project_id: str):
    info = _project_or_404(project_id)
    path = projects.project_dir(project_id) / "edit" / "transcripts" / f"{info['source_name']}.json"
    if not path.exists():
        return {"words": [], "engine": None}
    data = audio_timeline.ensure_transcript(path, projects.project_dir(project_id) / info["source_name"])
    if data is None:
        return {"words": [], "engine": None}
    return {"words": data.get("words", []), "engine": data.get("engine")}


class WordsEditBody(BaseModel):
    first: int   # index (in the transcript's words list) of the first word to replace
    last: int    # index of the last one, inclusive
    text: str


@router.put("/api/projects/{project_id}/transcript/words")
def edit_transcript_words(project_id: str, body: WordsEditBody):
    """Fixes the text of a stretch of the transcript: the preview captions and the rendered ones both read it from here."""
    info = _project_or_404(project_id)
    path = projects.project_dir(project_id) / "edit" / "transcripts" / f"{info['source_name']}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Este projeto ainda não tem transcrição")
    audio_timeline.ensure_transcript(path, projects.project_dir(project_id) / info["source_name"])
    try:
        words = audio_timeline.edit_words(path, body.first, body.last, body.text[:500])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Não foi possível salvar a transcrição: {exc}")
    return {"words": words}


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    _project_or_404(project_id)
    q = projects.read_state(project_id).get("queue") or {}
    if q.get("status") == "running":
        raise HTTPException(status_code=409, detail="O vídeo está sendo processado agora. Cancele-o na fila e tente de novo.")
    if highlight_service.is_running(project_id):
        raise HTTPException(status_code=409, detail="Este vídeo está sendo analisado agora. Cancele a análise e tente de novo.")
    try:
        projects.delete_project(project_id)
    except OSError as exc:
        raise HTTPException(status_code=409, detail=f"Não foi possível apagar (arquivo em uso?): {exc}")
    return {"deleted": project_id}


# ----------------------------------------------------------------------------
# Edit templates
# ----------------------------------------------------------------------------
class TemplateBody(BaseModel):
    id: str | None = None
    name: str = "Meu template"
    description: str | None = None   # None keeps the current description when editing
    subtitles: dict[str, Any] | None = None
    headline: dict[str, Any] | None = None
    grade: str | None = None
    grade_adjust: dict[str, Any] | None = None
    transition: str | None = None
    transition_scale: float | None = None   # None keeps the saved value (a client from before LUT / zoom existed)
    lut: dict[str, Any] | None = None
    zoom: dict[str, Any] | None = None
    pipeline: dict[str, Any] | None = None
    make_default: bool = False


@router.get("/api/edit-templates")
def list_edit_templates():
    return edit_templates.list_all()


@router.post("/api/edit-templates")
def save_edit_template(body: TemplateBody):
    tpl = edit_templates.save(body.model_dump(exclude={"id", "make_default"}), template_id=body.id, make_default=body.make_default)
    return tpl


@router.delete("/api/edit-templates/{template_id}")
def delete_edit_template(template_id: str):
    result = edit_templates.delete(template_id)
    if result == "missing":
        raise HTTPException(status_code=404, detail="Template não encontrado")
    if result == "last":
        raise HTTPException(status_code=409, detail="Este é o único template que sobrou e a fila precisa de um. Crie outro antes de excluir este.")
    return {"deleted": template_id}


@router.post("/api/edit-templates/restore-builtins")
def restore_all_builtin_templates():
    return {"restored": edit_templates.restore(None)}


@router.post("/api/edit-templates/{template_id}/restore")
def restore_builtin_template(template_id: str):
    if not template_id.startswith("builtin_"):
        raise HTTPException(status_code=400, detail="Só os templates prontos têm um original para restaurar.")
    return {"restored": edit_templates.restore(template_id)}


@router.post("/api/edit-templates/{template_id}/default")
def default_edit_template(template_id: str):
    if not edit_templates.set_default(template_id):
        raise HTTPException(status_code=404, detail="Template não encontrado")
    return {"default_id": template_id}


# ----------------------------------------------------------------------------
# Queue
# ----------------------------------------------------------------------------
@router.post("/api/queue/upload")
def queue_upload(file: UploadFile = File(...)):
    """Stores the video and creates the project. Heavy analysis happens later, in the worker."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inválido")
    ext = ("." + file.filename.rsplit(".", 1)[-1].lower()) if "." in file.filename else ""
    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Formato não suportado ({ext or 'sem extensão'}). Use MP4, MOV, MKV, WEBM ou AVI.")

    pid = f"proj_{uuid.uuid4().hex[:8]}"
    pdir = PROJECTS_DIR / pid
    pdir.mkdir(parents=True, exist_ok=True)
    source_name = "source_" + re.sub(r"[^\w.\-]", "_", file.filename)
    video = pdir / source_name
    with open(video, "wb") as out:
        shutil.copyfileobj(file.file, out)

    try:
        meta = probe_media(video)
        dw, dh = probe_display_size(video)
    except Exception as exc:
        shutil.rmtree(pdir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Não consegui ler o vídeo com o FFprobe: {exc}")
    meta.update(display_width=dw, display_height=dh)
    if dw and dh:
        meta["is_portrait"] = dh > dw

    threading.Thread(target=browser_playable_copy, args=(video,), daemon=True).start()   # H.264 copy for the preview

    projects.write_info(pid, {
        "id": pid, "source_name": source_name, "meta": meta, "waveform": [], "thumbnails": [],
        "initial_cuts": [], "video_url": f"{URL_BASE}/api/projects/{pid}/video/{source_name}", "analyzed": False,
    })

    def mutate(state: dict) -> None:
        state["queue"] = {"status": "awaiting", "steps": {s: "pending" for s in queue_service.STEPS},
                          "progress": 0, "message": "Enviado, aguardando a configuração", "logs": []}
    projects.update_state(pid, mutate)

    rw, rh = render_size(dw, dh)
    return {"project_id": pid, "name": projects.display_name({"source_name": source_name}, {}),
            "render_width": rw, "render_height": rh, "duration": meta.get("duration")}


class EnqueueBody(BaseModel):
    template_id: str | None = None
    headline_text: str = ""
    headline_tag: str = ""
    headline_image: str | None = None   # PNG (base64) drawn by the browser at the render's frame size
    name: str | None = None
    copy_text: str | None = None        # script of this video; None keeps what is saved
    strict_copy: bool = True


@router.post("/api/queue/{project_id}/enqueue")
def enqueue(project_id: str, body: EnqueueBody):
    _project_or_404(project_id)
    q = projects.read_state(project_id).get("queue")
    if q and q.get("status") not in ("awaiting", None):
        raise HTTPException(status_code=409, detail="Este vídeo já está na fila")
    tpl = edit_templates.get(body.template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template não encontrado")
    pipe = edit_templates.sanitize_pipeline(tpl.get("pipeline"))
    if pipe["ai_review"] == "llm":  # fail now, not after an hour in the queue
        try:
            llm.resolve(pipe["ai_provider"] or None, pipe["ai_model"] or None)
        except llm.LLMError as exc:
            raise HTTPException(status_code=400, detail=f"O template “{tpl['name']}” revisa a transcrição com IA, mas {str(exc)[0].lower() + str(exc)[1:]}")

    png = None
    if body.headline_image:
        raw = body.headline_image.split(",", 1)[-1]
        try:
            png = base64.b64decode(raw, validate=False)
            from PIL import Image
            with Image.open(io.BytesIO(png)) as im:
                im.verify()
        except Exception:
            raise HTTPException(status_code=400, detail="A imagem do headline não é um PNG válido")
        if len(png) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=400, detail="Imagem do headline grande demais")

    queue_service.enqueue(project_id, copy.deepcopy(tpl), body.headline_text, body.headline_tag, png, body.name,
                          copy_text=body.copy_text, strict_copy=body.strict_copy)
    return {"queued": project_id}


@router.get("/api/queue")
def get_queue():
    return queue_service.snapshot()


@router.post("/api/queue/pause")
def pause_queue():
    queue_service.set_paused(True)
    return {"paused": True}


@router.post("/api/queue/resume")
def resume_queue():
    queue_service.set_paused(False)
    return {"paused": False}


@router.post("/api/queue/{project_id}/cancel")
def cancel_item(project_id: str):
    _project_or_404(project_id)
    if not queue_service.cancel(project_id):
        raise HTTPException(status_code=409, detail="Este vídeo não está na fila")
    return {"ok": True}


@router.post("/api/queue/{project_id}/retry")
def retry_item(project_id: str):
    _project_or_404(project_id)
    if not queue_service.retry(project_id):
        raise HTTPException(status_code=409, detail="Só dá para tentar de novo itens com erro ou cancelados")
    return {"ok": True}


@router.post("/api/queue/{project_id}/clear")
def clear_item(project_id: str):
    _project_or_404(project_id)
    if not queue_service.clear(project_id):
        raise HTTPException(status_code=409, detail="Este item ainda está na fila ou em processamento")
    return {"ok": True}
