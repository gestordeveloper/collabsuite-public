"""Motion graphics (Remotion) API: the template catalog, and rendering one item to a cached alpha
video. Creating/editing/deleting items themselves is NOT here — edit.motion travels through the
same autosave PUT /api/projects/{id}/state as music/split (see backend/routes.py, projects.sanitize_edit),
exactly like every other per-project edit block. This router only covers what needs its own
request/response: the catalog, and the async render job (backend/motion_render.py)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

from backend import canvas as canvas_frame, media_processor, motion_graphics, motion_llm, motion_render, motion_track, projects
from backend.config import PROJECTS_DIR

router = APIRouter()


@router.get("/api/motion/templates")
def list_templates():
    return {
        "items": [
            {"id": tid, "name": t["name"], "description": t["description"],
             "default_duration": t["default_duration"], "props": t["props"], "trackable": bool(t.get("trackable"))}
            for tid, t in motion_graphics.MOTION_TEMPLATES.items()
        ],
        "follow": {**motion_track.shared_constants(), "available": motion_track.availability()},
    }


class RenderItemBody(BaseModel):
    item_id: str
    template_id: str
    props: dict[str, Any] = {}
    duration: float = 3.5


def _render_size(pid: str) -> tuple[int, int, float]:
    """The size of the FINAL frame (what compose_final composites onto): the cut video's size, or the aspect-ratio canvas's."""
    info = projects.read_info(pid)
    meta = info.get("meta") or {}
    width, height = media_processor.render_size(int(meta.get("display_width") or 1080), int(meta.get("display_height") or 1920))
    canvas = canvas_frame.sanitize_canvas(((projects.read_state(pid).get("edit") or {}).get("canvas")))
    if canvas_frame.is_active(canvas, width, height):
        width, height = canvas_frame.target_size(canvas, width, height)
    try:
        fps = float(meta.get("fps") or 30.0)
    except (TypeError, ValueError):
        fps = 30.0
    return width, height, fps if 5 <= fps <= 120 else 30.0


@router.post("/api/projects/{project_id}/motion/render")
def render_item(project_id: str, body: RenderItemBody):
    try:
        projects.read_info(project_id)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    if body.template_id not in motion_graphics.MOTION_TEMPLATES:
        raise HTTPException(status_code=400, detail="Template de motion graphic desconhecido.")

    width, height, fps = _render_size(project_id)
    item = {
        "id": body.item_id, "template_id": body.template_id,
        "props": motion_graphics.sanitize_props(body.template_id, body.props),
        "duration": max(0.3, min(60.0, body.duration)),
    }
    edit_dir = projects.project_dir(project_id) / "edit"
    try:
        job = motion_render.start_job(project_id, item, width, height, fps, edit_dir)
    except motion_render.MotionRenderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"job_id": job["id"], "item_id": item["id"], "status": job["status"]}


@router.get("/api/projects/{project_id}/motion/items/{item_id}/render")
def render_status(project_id: str, item_id: str):
    try:
        state = projects.read_state(project_id)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    render = (state.get("motion_renders") or {}).get(item_id)
    if not render:
        return {"status": "none"}
    return render


class SuggestBody(BaseModel):
    template_id: str
    text: str = ""          # what the user typed describing what they want
    scene_text: str = ""    # what is said in the scene at that point (optional context)


@router.post("/api/projects/{project_id}/motion/suggest")
def suggest(project_id: str, body: SuggestBody):
    try:
        projects.read_info(project_id)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    try:
        props = motion_llm.suggest_props(body.template_id, body.text, body.scene_text)
    except motion_llm.MotionLLMError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"props": props}


class PlanBody(BaseModel):
    text: str                 # what the user typed describing what they want
    scene_text: str = ""      # what is said in the scene at that point (optional context)
    template_id: str = ""     # "" = let the AI choose the model too
    provider: str = ""        # "" = the default AI of Configurações
    model: str = ""           # "" = that provider's saved model


@router.post("/api/projects/{project_id}/motion/plan")
def plan(project_id: str, body: PlanBody):
    """From a sentence ("um anel na minha mão escrito 'clique aqui'"), the AI picks the model, fills its fields and says what
    it should follow. Everything is validated again here: the AI never writes anything the editor would not accept."""
    try:
        projects.read_info(project_id)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    try:
        return motion_llm.suggest_item(body.text, body.scene_text, body.template_id or None, body.provider or None, body.model or None)
    except motion_llm.MotionLLMError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --- What a followed item follows (backend/motion_track.py) ------------------------------------------------------------
class TrackBody(BaseModel):
    follow: dict[str, Any]
    ranges: list[list[float]]     # source-time stretches the item is on screen over


def _video_of(project_id: str):
    try:
        info = projects.read_info(project_id)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    video = PROJECTS_DIR / project_id / info["source_name"]
    if not video.exists():
        raise HTTPException(status_code=404, detail="O vídeo do projeto não foi encontrado.")
    return PROJECTS_DIR / project_id, video


def _track_status(project_id: str, item_id: str, data: dict | None, follow: dict | None = None, ranges: list | None = None) -> dict:
    job = motion_track.job_state(project_id, item_id)
    fresh = bool(data and (follow is None or motion_track.same_request(data, follow)) and (not ranges or motion_track.covers(data, ranges)))
    status = job.get("status") or ("done" if fresh else "none")
    if status == "done" and not fresh and job.get("status") == "done":
        status = "none"          # an old job's result no longer matches what is being asked
    return {"status": status, "progress": job.get("progress", 1.0 if fresh else 0.0), "error": job.get("error", ""),
            "analyzed": fresh, "available": motion_track.availability()}


@router.post("/api/projects/{project_id}/motion/items/{item_id}/track/analyze")
def track_analyze(project_id: str, item_id: str, body: TrackBody):
    project_dir, video = _video_of(project_id)
    follow = motion_track.sanitize_follow(body.follow)
    if not motion_track.is_following(follow):
        raise HTTPException(status_code=400, detail="Escolha o que o gráfico deve seguir.")
    avail = motion_track.availability()
    if not avail.get(follow["target"]):
        raise HTTPException(status_code=503, detail="Este tipo de rastreio não está disponível nesta instalação.")
    if follow["target"] == "point" and not follow.get("seed"):
        raise HTTPException(status_code=400, detail="Clique no vídeo, no ponto que o gráfico deve seguir.")
    ranges = motion_track.merge_ranges(body.ranges, motion_track.MAX_SPAN_S)
    if not ranges:
        raise HTTPException(status_code=400, detail="O item não está sobre nenhum trecho do vídeo.")
    data = motion_track.load(project_dir, item_id)
    if data and motion_track.same_request(data, follow) and motion_track.covers(data, ranges):
        return _track_status(project_id, item_id, data, follow, ranges)
    motion_track.start_job(project_dir, item_id, video, follow, ranges)
    return _track_status(project_id, item_id, None)


@router.get("/api/projects/{project_id}/motion/items/{item_id}/track")
def track_get(project_id: str, item_id: str, part: str = "", smooth: float = 0.4):
    project_dir, _ = _video_of(project_id)
    data = motion_track.load(project_dir, item_id)
    out = _track_status(project_id, item_id, data)
    out["path"] = None
    if data:
        part = part if part in (data.get("x") or {}) else (data.get("parts") or [""])[0]
        out["target"] = data.get("target")
        out["seed"] = data.get("seed")
        out["covered"] = data.get("covered")
        out["path"] = motion_track.smoothed(data, part, min(1.0, max(0.0, smooth)))
    return out
