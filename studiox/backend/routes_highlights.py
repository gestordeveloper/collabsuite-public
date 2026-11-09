"""HTTP API for cuts from a long video (see backend/highlight_service.py)."""
from __future__ import annotations

import re
import shutil
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend import highlight_service, highlights, llm, projects
from backend.config import URL_BASE, PROJECTS_DIR
from backend.llm_anthropic import LLMError
from backend.media_processor import generate_thumbnails, probe_display_size, probe_media

router = APIRouter()

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}
SOURCE_THUMBS = 8


def _source_or_404(pid: str) -> dict:
    try:
        return projects.read_info(pid)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado")


@router.get("/api/highlights")
def list_sources():
    """The long videos uploaded for cuts, newest first."""
    return {"videos": [s for s in projects.list_projects() if s.get("kind") == "source"]}


@router.post("/api/highlights/upload")
def upload_source(file: UploadFile = File(...)):
    """Stores a long video as a project that only feeds clips (it is not put in the editing queue)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inválido")
    ext = ("." + file.filename.rsplit(".", 1)[-1].lower()) if "." in file.filename else ""
    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Formato não suportado ({ext or 'sem extensão'}). Use MP4, MOV, MKV, WEBM ou AVI.")
    pid = f"long_{uuid.uuid4().hex[:8]}"
    pdir = PROJECTS_DIR / pid
    pdir.mkdir(parents=True, exist_ok=True)
    source_name = "source_" + re.sub(r"[^\w.\-]", "_", file.filename)
    video = pdir / source_name
    with open(video, "wb") as out:
        shutil.copyfileobj(file.file, out)
    try:
        meta = probe_media(video)
        dw, dh = probe_display_size(video)
        meta.update(display_width=dw, display_height=dh)
        if dw and dh:
            meta["is_portrait"] = dh > dw
        thumbs = generate_thumbnails(video, pdir / "thumbs", count=SOURCE_THUMBS, duration=meta["duration"])
    except Exception as exc:
        shutil.rmtree(pdir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Não consegui ler o vídeo com o FFprobe: {exc}")
    projects.write_info(pid, {
        "id": pid, "source_name": source_name, "meta": meta, "waveform": [], "thumbnails": thumbs,
        "initial_cuts": [], "video_url": f"{URL_BASE}/api/projects/{pid}/video/{source_name}", "analyzed": True,
    })
    highlight_service.init_source(pid)
    return {"project_id": pid, "name": projects.display_name({"source_name": source_name}, {}), "duration": meta.get("duration")}


@router.get("/api/highlights/{project_id}")
def get_source(project_id: str):
    info = _source_or_404(project_id)
    state = projects.read_state(project_id)
    summary = projects.summarize(project_id) or {}
    meta = info.get("meta") or {}
    tr_path = projects.project_dir(project_id) / "edit" / "transcripts" / f"{info['source_name']}.json"
    return {
        "id": project_id, "name": projects.display_name(info, state), "duration": meta.get("duration"),
        "width": meta.get("width"), "height": meta.get("height"), "thumb_url": summary.get("thumb_url"),
        "video_url": info.get("video_url"), "has_transcript": tr_path.exists(),
        "highlights": highlight_service.public_block(state),
    }


class AnalyzeBody(BaseModel):
    mode: str = "viral"               # viral | topics
    min_s: float | None = None
    max_s: float | None = None
    count: int | None = None          # 0 = every good one
    language: str = "pt"
    engine: str = "auto"              # transcription engine (only used when the video has no transcript yet)
    provider: str = ""                # "" = the default AI of Configurações
    model: str = ""
    ai: str = "auto"                  # auto | llm | local
    focus: str = ""
    instructions: str = ""


@router.post("/api/highlights/{project_id}/analyze")
def analyze(project_id: str, body: AnalyzeBody):
    _source_or_404(project_id)
    params = highlights.clean_params(body.model_dump(exclude_none=True))
    if params["ai"] == "llm":       # fail now, not after the transcription of a two-hour video
        try:
            llm.resolve(params["provider"] or None, params["model"] or None)
        except LLMError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    try:
        return {"highlights": highlight_service.start(project_id, params)}
    except highlight_service.Busy:
        raise HTTPException(status_code=409, detail="Este vídeo já está sendo analisado.")


@router.post("/api/highlights/{project_id}/cancel")
def cancel_analysis(project_id: str):
    _source_or_404(project_id)
    if not highlight_service.cancel(project_id):
        raise HTTPException(status_code=409, detail="Este vídeo não está sendo analisado.")
    return {"ok": True}


class ClipItem(BaseModel):
    cand_id: str = ""
    start: float
    end: float
    title: str = ""
    tag: str = ""
    score: int | None = None


class ClipsBody(BaseModel):
    items: list[ClipItem]


@router.post("/api/highlights/{project_id}/clips")
def create_clips(project_id: str, body: ClipsBody):
    """Makes one project per chosen cut. Each waits for its template: the browser draws the headline image and then
    calls /api/queue/{id}/enqueue for it, exactly like a video sent on the queue screen."""
    _source_or_404(project_id)
    if not body.items:
        raise HTTPException(status_code=400, detail="Escolha pelo menos um corte.")
    made = highlight_service.create_clips(project_id, [i.model_dump() for i in body.items])
    if not made:
        raise HTTPException(status_code=400, detail="Nenhum dos cortes tem uma duração válida (entre 3 s e 15 min).")
    return {"clips": made}
