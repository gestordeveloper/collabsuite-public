"""API of the face tracker (backend/face_track.py): run the analysis of a project's video, read the camera path for the
preview, and list the faces at one moment so the person to follow can be picked on the picture."""
from __future__ import annotations

import json
import threading

from fastapi import APIRouter, HTTPException

from backend import face_track
from backend.config import PROJECTS_DIR

router = APIRouter(prefix="/api/projects/{project_id}/track")

_JOBS: dict[str, dict] = {}       # project id -> {"status": running|done|error, "progress": 0..1, "error": str}
_LOCK = threading.Lock()
_CACHE: dict[str, tuple[float, dict]] = {}   # project id -> (file mtime, raw data): the faces file can be a few MB


def _project(project_id: str):
    project_dir = PROJECTS_DIR / project_id
    info_path = project_dir / "project_info.json"
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    return project_dir, json.loads(info_path.read_text(encoding="utf-8"))


def _data(project_dir):
    path = project_dir / face_track.TRACK_FILE
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    hit = _CACHE.get(project_dir.name)
    if hit and hit[0] == mtime:
        return hit[1]
    data = face_track.load(project_dir)
    if data:
        _CACHE[project_dir.name] = (mtime, data)
    return data


def _status(project_id: str, data: dict | None) -> dict:
    job = _JOBS.get(project_id) or {}
    return {"available": face_track.is_available(),
            "status": job.get("status") or ("done" if data else "none"),
            "progress": job.get("progress", 1.0 if data else 0.0),
            "error": job.get("error", ""),
            "analyzed": bool(data),
            "faces_found": len(data["faces"]) if data else 0}


@router.post("/analyze")
def analyze(project_id: str):
    project_dir, info = _project(project_id)
    if not face_track.is_available():
        raise HTTPException(status_code=503, detail="O rastreador de rosto não está disponível nesta instalação.")
    video = project_dir / info["source_name"]
    if not video.exists():
        raise HTTPException(status_code=404, detail="O vídeo do projeto não foi encontrado.")
    with _LOCK:
        if (_JOBS.get(project_id) or {}).get("status") == "running":
            return _status(project_id, _data(project_dir))
        _JOBS[project_id] = {"status": "running", "progress": 0.0, "error": ""}

    def work() -> None:
        job = _JOBS[project_id]
        try:
            data = face_track.analyze(video, lambda p: job.__setitem__("progress", p))
            face_track.save(project_dir, data)
            _CACHE.pop(project_id, None)
            job.update(status="done", progress=1.0)
        except Exception as exc:  # the editor shows the message; it must never take the server down
            job.update(status="error", error=str(exc))

    threading.Thread(target=work, daemon=True).start()
    return _status(project_id, None)


@router.get("")
def get_track(project_id: str, smooth: float = 0.5, seed_t: float | None = None, seed_x: float | None = None,
              seed_y: float | None = None):
    """The state of the analysis and, when there is one, the smoothed camera path for the chosen person."""
    project_dir, _ = _project(project_id)
    data = _data(project_dir)
    out = _status(project_id, data)
    out["path"] = None
    if data:
        seed = {"t": seed_t, "x": seed_x, "y": seed_y} if None not in (seed_t, seed_x, seed_y) else None
        out["path"] = face_track.build_path(data, min(1.0, max(0.0, smooth)), seed)
        out["duration"] = data.get("duration")
    return out


@router.get("/faces")
def faces(project_id: str, t: float):
    """Faces seen around source time t: [[cx, cy, h, score], ...] (fractions of the frame)."""
    project_dir, _ = _project(project_id)
    data = _data(project_dir)
    return {"faces": face_track.faces_near(data, t) if data else []}
