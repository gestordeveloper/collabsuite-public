"""API of the split-screen media library: upload, list, delete, AI generation (see media_generation.py)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend import media_generation, media_library, projects
from backend.media_generation import GenerationError
from backend.media_library import MediaError

router = APIRouter(prefix="/api/projects/{project_id}/media")


def _project(project_id: str) -> None:
    if not projects.exists(project_id):
        raise HTTPException(status_code=404, detail="Projeto não encontrado")


@router.get("")
def list_media(project_id: str):
    _project(project_id)
    return {
        "media": [media_library.public(m, project_id) for m in media_library.list_media(project_id)],
        "jobs": media_generation.project_jobs(project_id),
        "ai": {"openai": media_generation.is_configured(), "image_models": list(media_generation.IMAGE_MODELS),
               "video_models": list(media_generation.VIDEO_MODELS), "video_seconds": list(media_generation.VIDEO_SECONDS)},
        "limits": {"image_mb": media_library.MAX_IMAGE_BYTES // 1048576, "video_mb": media_library.MAX_VIDEO_BYTES // 1048576},
    }


@router.post("")
def upload_media(project_id: str, file: UploadFile = File(...)):
    _project(project_id)
    name = file.filename or ""
    kind = media_library.kind_of(name)
    if not kind:
        raise HTTPException(status_code=400, detail="Formato não suportado. Use PNG, JPG ou WEBP para imagens e MP4, MOV, WEBM ou MKV para vídeos.")
    ext = "." + name.rsplit(".", 1)[-1].lower()
    tmp = media_library.media_dir(project_id) / f"upload_{uuid.uuid4().hex[:8]}{ext}"
    limit = media_library.MAX_IMAGE_BYTES if kind == "image" else media_library.MAX_VIDEO_BYTES
    written = 0
    try:
        with open(tmp, "wb") as out:
            while chunk := file.file.read(1024 * 1024):
                written += len(chunk)
                if written > limit:
                    raise MediaError(f"Arquivo grande demais (o limite é {limit // 1048576} MB para {'imagens' if kind == 'image' else 'vídeos'}).")
                out.write(chunk)
        item = media_library.add(project_id, tmp, name.rsplit(".", 1)[0] if "." in name else name, kind)
    except MediaError as exc:
        tmp.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc))
    return media_library.public(item, project_id)


class GenerateBody(BaseModel):
    kind: str = "image"          # image | video
    prompt: str = ""
    layout: str = "top"          # where the media goes, to ask for a picture of the right shape
    ratio: float = 0.5
    seconds: str = "4"           # video only
    model: str | None = None     # empty = the default of each kind


@router.post("/generate")
def generate(project_id: str, body: GenerateBody):
    _project(project_id)
    try:
        job = media_generation.start_job(project_id, body.kind, body.prompt, body.layout, body.ratio, body.seconds, body.model)
    except GenerationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return job


@router.get("/jobs/{job_id}")
def job_status(project_id: str, job_id: str):
    job = media_generation.JOBS.get(job_id)
    if not job or job["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Geração não encontrada")
    return job


class SuggestBody(BaseModel):
    kind: str = "image"
    text: str = ""               # what is said in the scene


@router.post("/suggest-prompt")
def suggest(project_id: str, body: SuggestBody):
    _project(project_id)
    try:
        return {"prompt": media_generation.suggest_prompt(body.kind, body.text)}
    except GenerationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{media_id}")
def delete_media(project_id: str, media_id: str):
    _project(project_id)
    if not media_library.remove(project_id, media_id):
        raise HTTPException(status_code=404, detail="Mídia não encontrada")
    return {"deleted": media_id}


@router.get("/{media_id}/file")
def media_file(project_id: str, media_id: str):
    _project(project_id)
    item = media_library.get(project_id, media_id)
    path = media_library.path_of(project_id, item) if item else None
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return FileResponse(path, media_type=media_library.MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"))


@router.get("/{media_id}/thumb")
def media_thumb(project_id: str, media_id: str):
    _project(project_id)
    thumb = media_library.media_dir(project_id) / "thumbs" / f"{media_id}.jpg"
    if not media_id.replace("_", "").isalnum() or not thumb.exists():
        raise HTTPException(status_code=404, detail="Miniatura não encontrada")
    return FileResponse(thumb, media_type="image/jpeg")
