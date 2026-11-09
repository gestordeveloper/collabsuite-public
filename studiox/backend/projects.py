"""Saved projects: what is on disk for each video and the editing state that goes with it.

storage/projects/<id>/
    <source video>            the uploaded file
    project_info.json         technical facts (meta, waveform, thumbnails, first cut list)
    project_state.json        the EDITING state, saved by the editor and by the queue
    thumbs/, edit/            filmstrip frames; transcripts, render output

project_state.json
    name        optional custom title
    edit        clips (cuts), grade, transition (+ transition_scale), subtitles{enabled,preset_id,style},
                headline{enabled,preset_id,style,text,tag,start,duration}, grade_adjust, split (split screen),
                music (layers of clips of the shared music library, see backend/music_mix.py),
                lut {id, intensity} (backend/luts.py), zoom {enabled, style, amount, focus} (backend/looks.py),
                canvas {ratio, background, transform} (aspect ratio + scale/position/rotation, backend/canvas.py),
                motion {enabled, items[{id, template_id, scope, clip_id, start, duration, props}]}
                (Remotion motion graphics, backend/motion_graphics.py)
    queue       state of the automatic pipeline (see backend/queue_service.py) or null
    render      {"last": {...}} facts about the last finished render
    motion_renders  {item_id: {status, cache_key, asset_file, error}} SERVER-OWNED render status of
                each edit.motion item (backend/motion_render.py writes this; never trust edit.motion
                itself for the asset path — see backend/motion_graphics.py module docstring)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from backend import headlines as hl
from backend import transitions as tr
from backend.canvas import sanitize_canvas
from backend.config import URL_BASE, PROJECTS_DIR
from backend.face_track import sanitize_track
from backend.fsutil import replace_file
from backend.looks import sanitize_zoom
from backend.luts import sanitize_lut
from backend.motion_graphics import sanitize_motion
from backend.music_mix import sanitize_music
from backend.split_screen import sanitize_split
from backend.subtitles import sanitize_style as sanitize_subtitle_style
from backend.templates import sanitize_grade_adjust

ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
STATE_FILE = "project_state.json"
INFO_FILE = "project_info.json"
MAX_CLIPS = 5000

_lock = threading.RLock()
_summary_cache: dict[str, tuple[tuple[float, float, float], dict]] = {}


class ProjectNotFound(Exception):
    pass


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def project_dir(pid: str) -> Path:
    if not ID_RE.match(pid or ""):
        raise ProjectNotFound(pid)
    return PROJECTS_DIR / pid


def _read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write_json_atomic(path: Path, data: Any) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    replace_file(tmp, path)


def exists(pid: str) -> bool:
    try:
        return (project_dir(pid) / INFO_FILE).exists()
    except ProjectNotFound:
        return False


def read_info(pid: str) -> dict:
    info = _read_json(project_dir(pid) / INFO_FILE)
    if info is None:
        raise ProjectNotFound(pid)
    return info


def write_info(pid: str, info: dict) -> None:
    with _lock:
        _write_json_atomic(project_dir(pid) / INFO_FILE, info)


def read_state(pid: str) -> dict:
    with _lock:
        state = _read_json(project_dir(pid) / STATE_FILE, {})
    if not isinstance(state, dict):
        state = {}
    state.setdefault("version", 1)
    state.setdefault("edit", None)
    state.setdefault("queue", None)
    state.setdefault("render", None)
    state.setdefault("motion_renders", {})
    return state


def update_state(pid: str, mutate: Callable[[dict], None]) -> dict:
    """Read-modify-write under a lock (the editor, the queue worker and the render thread all write)."""
    with _lock:
        state = read_state(pid)
        mutate(state)
        state["updated_at"] = now_iso()
        state.setdefault("created_at", state["updated_at"])
        _write_json_atomic(project_dir(pid) / STATE_FILE, state)
        return state


def display_name(info: dict, state: dict) -> str:
    custom = (state.get("name") or "").strip()
    if custom:
        return custom
    name = info.get("source_name") or info.get("id") or "Vídeo"
    name = re.sub(r"^source_", "", name)
    name = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", name)
    return name.replace("_", " ").strip() or "Vídeo"


# ----------------------------------------------------------------------------
# Editing state (what the editor sends)
# ----------------------------------------------------------------------------
def _f(raw: Any, default: float, lo: float, hi: float) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return default
    if v != v:
        return default
    return min(hi, max(lo, v))


def _s(raw: Any, limit: int, default: str = "") -> str:
    return str(raw).strip()[:limit] if isinstance(raw, (str, int, float)) else default


def _with_preset_defaults(style: Any, preset_id: str) -> Any:
    """A style saved before a field existed (e.g. `reveal`) takes that field from its ready-made style
    instead of the generic default, so older projects pick up what the preset promises."""
    from backend.templates import SUBTITLE_TEMPLATES

    preset = next((t for t in SUBTITLE_TEMPLATES if t["id"] == preset_id), None)
    if not preset or not isinstance(style, dict):
        return style
    return {**{k: v for k, v in preset["style"].items() if k not in style}, **style}


def sanitize_edit(raw: Any) -> dict[str, Any] | None:
    """Whitelists and clamps the editing state before it is stored."""
    if not isinstance(raw, dict):
        return None
    edit: dict[str, Any] = {}

    clips = []
    for c in (raw.get("clips") or [])[:MAX_CLIPS]:
        if not isinstance(c, dict):
            continue
        start = _f(c.get("start"), 0.0, 0.0, 1e6)
        end = _f(c.get("end"), 0.0, 0.0, 1e6)
        if end - start < 0.05:
            continue
        clips.append({"start": round(start, 3), "end": round(end, 3),
                      "beat": _s(c.get("beat"), 80), "source": _s(c.get("source"), 260)})
    edit["clips"] = clips

    edit["grade"] = _s(raw.get("grade"), 60, "warm_cinematic") or "warm_cinematic"
    edit["transition"] = tr.sanitize_id(_s(raw.get("transition"), 60))
    edit["transition_scale"] = tr.sanitize_scale(raw.get("transition_scale", 1.0))
    # the sound every cut plays by default, and the cuts that got a transition / sound of their own (key = tr.cut_key)
    edit["transition_sound"] = tr.sanitize_sound(raw.get("transition_sound")) or {"id": "", "volume": 0.8, "offset": 0.0}
    edit["cut_transitions"] = tr.sanitize_overrides(raw.get("cut_transitions"))
    edit["lut"] = sanitize_lut(raw.get("lut"))
    edit["zoom"] = sanitize_zoom(raw.get("zoom"))
    edit["grade_adjust"] = sanitize_grade_adjust(raw.get("grade_adjust"))
    edit["split"] = sanitize_split(raw.get("split"))
    edit["music"] = sanitize_music(raw.get("music"))
    edit["canvas"] = sanitize_canvas(raw.get("canvas"))
    edit["motion"] = sanitize_motion(raw.get("motion"))
    edit["track"] = sanitize_track(raw.get("track"))

    subs = raw.get("subtitles") if isinstance(raw.get("subtitles"), dict) else {}
    edit["subtitles"] = {
        "enabled": bool(subs.get("enabled", True)),
        "preset_id": _s(subs.get("preset_id"), 60) or None,
        "style": sanitize_subtitle_style(_with_preset_defaults(subs.get("style"), _s(subs.get("preset_id"), 60))),
    }

    head = raw.get("headline") if isinstance(raw.get("headline"), dict) else {}
    edit["headline"] = {
        "enabled": bool(head.get("enabled", True)),
        "preset_id": _s(head.get("preset_id"), 60) or None,
        "style": hl.sanitize_style(head.get("style")),
        "text": str(head.get("text") or "")[:2000],
        "tag": _s(head.get("tag"), 80),
        "start": round(_f(head.get("start"), 0.0, 0.0, 36000.0), 3),
        "duration": round(_f(head.get("duration"), 4.0, 0.5, 60.0), 3),
    }
    return edit


# ----------------------------------------------------------------------------
# Listing
# ----------------------------------------------------------------------------
def final_path(pid: str) -> Path:
    return project_dir(pid) / "edit" / "final.mp4"


def _status(state: dict, has_final: bool) -> str:
    q = state.get("queue") or {}
    qs = q.get("status")
    if qs == "awaiting":
        return "uploading"
    if qs == "queued":
        return "queued"
    if qs == "running":
        return "processing"
    if qs == "error":
        return "error"
    if qs == "cancelled":
        return "cancelled"
    if has_final or (state.get("render") or {}).get("last"):
        return "rendered"
    return "draft"


def _highlights_card(block: Any) -> dict | None:
    if not isinstance(block, dict):
        return None
    return {"status": block.get("status"), "candidates": len(block.get("candidates") or []), "clips": len(block.get("clips") or [])}


def summarize(pid: str) -> dict | None:
    """One card of the project list (cached by file modification time: the info file can be large)."""
    pdir = PROJECTS_DIR / pid
    info_p, state_p = pdir / INFO_FILE, pdir / STATE_FILE
    try:
        i_m = info_p.stat().st_mtime
    except OSError:
        return None
    s_m = state_p.stat().st_mtime if state_p.exists() else 0.0
    final = pdir / "edit" / "final.mp4"
    f_m = final.stat().st_mtime if final.exists() else 0.0
    key = (i_m, s_m, f_m)
    cached = _summary_cache.get(pid)
    if cached and cached[0] == key:
        return cached[1]

    info = _read_json(info_p)
    if not isinstance(info, dict):
        return None
    state = read_state(pid)
    meta = info.get("meta") or {}
    thumbs = info.get("thumbnails") or []
    thumb = None
    if thumbs:
        t = thumbs[min(len(thumbs) - 1, len(thumbs) // 3)]
        thumb = f"{URL_BASE}/api/projects/{pid}/thumbs/{t.get('filename')}"
    has_final = final.exists()
    queue = state.get("queue") or None
    if queue:
        queue = {k: queue.get(k) for k in ("status", "step", "steps", "progress", "message", "template_name", "error", "queued_at")}

    summary = {
        "id": pid,
        "name": display_name(info, state),
        "source_name": info.get("source_name"),
        "duration": meta.get("duration"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "is_portrait": bool(meta.get("is_portrait")),
        "size_mb": meta.get("size_mb"),
        "thumb_url": thumb,
        "created_at": state.get("created_at") or datetime.fromtimestamp(i_m).astimezone().isoformat(timespec="seconds"),
        "updated_at": state.get("updated_at") or datetime.fromtimestamp(max(i_m, s_m)).astimezone().isoformat(timespec="seconds"),
        "status": _status(state, has_final),
        "queue": queue,
        "has_final": has_final,
        "final_at": datetime.fromtimestamp(f_m).astimezone().isoformat(timespec="seconds") if has_final else None,
        "final_size_mb": round(final.stat().st_size / (1024 * 1024), 1) if has_final else None,
        "cuts": len(((state.get("edit") or {}).get("clips")) or info.get("initial_cuts") or []),
        "saved": bool(state.get("edit")),
        "is_demo": pid.startswith("demo_"),
        "kind": "source" if state.get("highlights") is not None else ("clip" if info.get("clip_of") else "video"),
        "clip_of": {k: info["clip_of"].get(k) for k in ("parent", "parent_name", "number", "score")} if info.get("clip_of") else None,
        "highlights": _highlights_card(state.get("highlights")),
    }
    _summary_cache[pid] = (key, summary)
    return summary


def list_projects() -> list[dict]:
    out = []
    if not PROJECTS_DIR.exists():
        return out
    for d in PROJECTS_DIR.iterdir():
        if d.is_dir() and ID_RE.match(d.name):
            s = summarize(d.name)
            if s:
                out.append(s)
    out.sort(key=lambda p: p["updated_at"], reverse=True)
    return out


def delete_project(pid: str) -> None:
    pdir = project_dir(pid)
    if not pdir.exists():
        raise ProjectNotFound(pid)
    shutil.rmtree(pdir)
    _summary_cache.pop(pid, None)


def record_render(pid: str, out_path: Path, is_preview: bool) -> None:
    """Remember the last finished render (called when a render job completes)."""
    try:
        size = round(out_path.stat().st_size / (1024 * 1024), 1)
    except OSError:
        size = None

    def mutate(state: dict) -> None:
        state["render"] = {"last": {
            "file": out_path.name, "mode": "preview" if is_preview else "final",
            "at": now_iso(), "size_mb": size,
        }}
    if exists(pid):
        update_state(pid, mutate)
