"""Async render job for one motion graphics item: calls the Remotion sidecar (motion/render.mjs,
a Node subprocess — see backend/config.py::ensure_node) and writes the result into the project's
state. Mirrors backend/media_generation.py's start_job/_run/JOBS/project_jobs shape (a Remotion
render is not instant: headless Chromium captures frame by frame, so it must not block the request).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from backend import motion_graphics, projects
from backend.config import BASE_DIR

MOTION_PROJECT_DIR = BASE_DIR / "motion"
RENDER_SCRIPT = MOTION_PROJECT_DIR / "render.mjs"

JOBS: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


class MotionRenderError(Exception):
    pass


def _node_path() -> str:
    node = shutil.which("node")
    if not node:
        raise MotionRenderError("Node.js não foi encontrado. Instale o Node (nodejs.org) para usar motion graphics.")
    return node


def _set_render_state(pid: str, item_id: str, **fields: Any) -> None:
    def mutate(state: dict) -> None:
        renders = state.setdefault("motion_renders", {})
        renders[item_id] = {**renders.get(item_id, {}), **fields}
    projects.update_state(pid, mutate)


def render_file(item: dict, width: int, height: int, fps: float, edit_dir: Path) -> Path:
    """Renders ONE item to its cached alpha WebM (blocking) and returns the path. Raises MotionRenderError."""
    key = motion_graphics.cache_key(item, width, height, fps)
    out_path = motion_graphics.asset_path(edit_dir, item["id"], key)
    node = _node_path()
    spec = {
        "templateId": item["template_id"],
        "inputProps": item["props"],
        "width": width,
        "height": height,
        "fps": fps,
        "durationInSeconds": item["duration"],
        "outputPath": str(out_path),
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(spec, f)
        spec_path = f.name
    try:
        proc = subprocess.run(
            [node, str(RENDER_SCRIPT), spec_path],
            cwd=str(MOTION_PROJECT_DIR), capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired as exc:
        raise MotionRenderError("O render demorou demais (mais de 10 min) e foi cancelado.") from exc
    finally:
        Path(spec_path).unlink(missing_ok=True)

    if proc.returncode != 0 or not out_path.exists():
        raise MotionRenderError((proc.stdout or "").strip()[-1500:] or (proc.stderr or "").strip()[-1500:] or "Falha desconhecida no render.")
    return out_path


def _run(job: dict[str, Any], pid: str, item: dict, width: int, height: int, fps: float, edit_dir: Path) -> None:
    item_id = item["id"]
    key = motion_graphics.cache_key(item, width, height, fps)
    try:
        job["message"] = "Renderizando no Remotion…"
        _set_render_state(pid, item_id, status="rendering", cache_key=key, error=None)
        out_path = render_file(item, width, height, fps, edit_dir)
        job.update(status="done", progress=100, message="Pronto")
        _set_render_state(pid, item_id, status="done", cache_key=key, asset_file=out_path.name, error=None)
    except Exception as exc:  # never leave a job "rendering" forever
        message = str(exc)
        job.update(status="error", error=message, message=message)
        _set_render_state(pid, item_id, status="error", error=message[:800])
    finally:
        job["finished_at"] = time.time()


def ensure_rendered(pid: str, motion: dict, motion_renders: dict | None, width: int, height: int, fps: float,
                    edit_dir: Path, log: Callable[[str], None]) -> dict:
    """Before the final composition: renders (now, blocking) every item whose cached video is missing or stale, so a motion
    graphic never silently fails to show up just because "Renderizar" was not clicked on it. Returns the updated renders."""
    renders = dict(motion_renders or {})
    for item in motion.get("items") or []:
        key = motion_graphics.cache_key(item, width, height, fps)
        have = renders.get(item["id"]) or {}
        if have.get("status") == "done" and have.get("cache_key") == key and motion_graphics.asset_path(edit_dir, item["id"], key).exists():
            continue
        name = (motion_graphics.MOTION_TEMPLATES.get(item["template_id"]) or {}).get("name", item["template_id"])
        log(f"Renderizando o motion graphic “{name}” (ainda não estava pronto)…")
        try:
            path = render_file(item, width, height, fps, edit_dir)
        except Exception as exc:
            log(f"Aviso: o motion graphic “{name}” não pôde ser renderizado e foi ignorado: {str(exc)[:300]}")
            continue
        renders[item["id"]] = {"status": "done", "cache_key": key, "asset_file": path.name, "error": None}
        try:
            _set_render_state(pid, item["id"], status="done", cache_key=key, asset_file=path.name, error=None)
        except Exception:
            pass
    return renders


def start_job(pid: str, item: dict, width: int, height: int, fps: float, edit_dir: Path) -> dict[str, Any]:
    if item["template_id"] not in motion_graphics.MOTION_TEMPLATES:
        raise MotionRenderError("Template de motion graphic desconhecido.")
    job = {
        "id": uuid.uuid4().hex[:10], "project_id": pid, "item_id": item["id"], "status": "running",
        "progress": 0, "message": "Iniciando…", "error": None, "created_at": time.time(), "finished_at": None,
    }
    with _lock:
        JOBS[job["id"]] = job
        for jid in [j for j, v in JOBS.items() if v["finished_at"] and time.time() - v["finished_at"] > 3600]:
            JOBS.pop(jid, None)
    _set_render_state(pid, item["id"], status="queued", error=None)
    threading.Thread(target=_run, args=(job, pid, item, width, height, fps, edit_dir), daemon=True).start()
    return job


def job_status(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = JOBS.get(job_id)
        return dict(job) if job else None


def project_jobs(pid: str) -> list[dict[str, Any]]:
    with _lock:
        return [dict(j) for j in JOBS.values() if j["project_id"] == pid]
