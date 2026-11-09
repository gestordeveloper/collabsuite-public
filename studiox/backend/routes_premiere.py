"""API used by the Adobe Premiere panel (premiere-plugin/): process a video on this computer and fetch the result."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend import premiere_service
from backend.version import VERSION

router = APIRouter(prefix="/api/premiere")


class ProcessBody(BaseModel):
    path: str                       # a video file on this computer
    language: str = "pt"
    engine: str = "auto"
    auto_cut: bool = True
    review: str = "auto"            # off | local | llm | auto
    copy_text: str = ""
    strict_copy: bool = True
    fix_words: bool = True
    words_per_cue: int | None = None
    subtitles: dict[str, Any] | None = None


@router.get("/ping")
def ping():
    return {"ok": True, "app": "StudioX", "version": VERSION}


@router.post("/process")
def process(body: ProcessBody):
    try:
        job_id = premiere_service.start(
            body.path, language=body.language, engine=body.engine, auto_cut=body.auto_cut, review=body.review,
            copy=body.copy_text, strict_copy=body.strict_copy, fix_words=body.fix_words,
            subtitles=body.subtitles, words_per_cue=body.words_per_cue)
    except premiere_service.PremiereError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def job_status(job_id: str):
    job = premiere_service.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    return {k: job.get(k) for k in ("id", "status", "step", "progress", "message", "logs", "error", "result")}


@router.get("/jobs/{job_id}/{kind}")
def job_file(job_id: str, kind: str):
    job = premiere_service.get(job_id)
    result = (job or {}).get("result")
    if not result:
        raise HTTPException(status_code=404, detail="Resultado ainda não está pronto")
    path = (result.get("files") or {}).get(kind)
    if kind not in ("xml", "srt") or not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return FileResponse(path, filename=f"studiox_{job_id}.{kind}")
