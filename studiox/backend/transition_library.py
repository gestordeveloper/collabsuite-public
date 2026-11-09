"""The user's own transitions: the ones built from the effects in backend/transitions.py, and the video/image files
imported to be laid over a cut ("overlay" effect).

    storage/transitions/library.json     {"custom": [{id, name, icon, description, fx, ...}], "media": [{id, name, file, ...}]}
    storage/transitions/media/<id>.<ext> the imported files

A custom transition is `{"id": "c_xxxxxxxx", "name", "icon", "description", "fx": [...]}` (+ `kind: "custom"` when sent to
the browser): once saved it behaves like a ready-made one everywhere (templates, projects, the queue, the render).
"""
from __future__ import annotations

import json
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from backend import transitions as tr
from backend.config import URL_BASE, STORAGE_DIR
from backend.fsutil import replace_file

LIB_DIR = STORAGE_DIR / "transitions"
MEDIA_DIR = LIB_DIR / "media"
INDEX = LIB_DIR / "library.json"

MAX_CUSTOM = 80
MAX_MEDIA = 40
MAX_MEDIA_BYTES = 80 * 1024 * 1024
MAX_MEDIA_SECONDS = 10.0
VIDEO_EXT = {".webm", ".mov", ".mp4", ".m4v"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
ID_RE = re.compile(r"^[a-z0-9_]{1,60}$")

_lock = threading.RLock()


class LibraryError(Exception):
    """A problem the user can fix; the message is shown as is."""


def _read() -> dict[str, list[dict[str, Any]]]:
    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    data = data if isinstance(data, dict) else {}
    return {"custom": [i for i in (data.get("custom") or []) if isinstance(i, dict) and ID_RE.match(str(i.get("id", "")))],
            "media": [i for i in (data.get("media") or []) if isinstance(i, dict) and ID_RE.match(str(i.get("id", "")))]}


def _write(data: dict[str, list[dict[str, Any]]]) -> None:
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INDEX.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    replace_file(tmp, INDEX)


# ----------------------------------------------------------------------------
# Custom transitions
# ----------------------------------------------------------------------------
def _public(item: dict[str, Any]) -> dict[str, Any]:
    fx = tr.sanitize_fx_list(item.get("fx"))
    out = {"id": item["id"], "name": item.get("name") or "Minha transição", "icon": item.get("icon") or "🎞️",
           "recommended": False, "kind": "custom", "duration": tr.span_of(fx),
           "description": item.get("description") or "Transição criada por você.", "fx": fx}
    sound = tr.sanitize_sound(item.get("sound"))
    if sound and sound["id"] and sound["id"] != "none":
        out["sound"] = sound
    return out


def list_custom() -> list[dict[str, Any]]:
    with _lock:
        return [_public(i) for i in _read()["custom"]]


def get_custom(transition_id: str) -> dict[str, Any] | None:
    if not isinstance(transition_id, str) or not ID_RE.match(transition_id):
        return None
    with _lock:
        for i in _read()["custom"]:
            if i["id"] == transition_id:
                return _public(i)
    return None


def _clean_text(raw: Any, limit: int, default: str) -> str:
    text = re.sub(r"[\r\n\t]+", " ", str(raw or "")).strip()[:limit]
    return text or default


def save_custom(raw: dict[str, Any], transition_id: str | None = None) -> dict[str, Any]:
    fx = tr.sanitize_fx_list(raw.get("fx"))
    if not fx:
        raise LibraryError("Adicione pelo menos um efeito à transição.")
    # an overlay may only point at a file that is in the library
    with _lock:
        data = _read()
        known = {m["id"] for m in data["media"]}
        fx = [f for f in fx if f["type"] != "overlay" or f["media"] in known]
        if not fx:
            raise LibraryError("O arquivo importado dessa transição não existe mais na biblioteca.")
        sound = tr.sanitize_sound(raw.get("sound"))
        entry = {"name": _clean_text(raw.get("name"), 60, "Minha transição"),
                 "icon": _clean_text(raw.get("icon"), 4, "🎞️"),
                 "description": _clean_text(raw.get("description"), 240, "Transição criada por você."),
                 "fx": fx}
        if sound and sound["id"] and sound["id"] != "none":
            entry["sound"] = sound
        if transition_id:
            for i in data["custom"]:
                if i["id"] == transition_id:
                    i.update(entry)
                    _write(data)
                    return _public(i)
            raise LibraryError("Essa transição não existe mais.")
        if len(data["custom"]) >= MAX_CUSTOM:
            raise LibraryError("Você chegou ao limite de transições próprias: exclua alguma antes de criar outra.")
        item = {"id": f"c_{uuid.uuid4().hex[:8]}", "created": int(time.time()), **entry}
        data["custom"].append(item)
        _write(data)
        return _public(item)


def delete_custom(transition_id: str) -> bool:
    with _lock:
        data = _read()
        keep = [i for i in data["custom"] if i["id"] != transition_id]
        if len(keep) == len(data["custom"]):
            return False
        data["custom"] = keep
        _write(data)
    return True


# ----------------------------------------------------------------------------
# Imported media (overlays)
# ----------------------------------------------------------------------------
def _probe(path: Path) -> dict[str, Any]:
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
           "stream=width,height,pix_fmt,codec_name,duration:stream_tags=alpha_mode:format=duration", "-of", "json", str(path)]
    try:
        data = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout or "{}")
    except ValueError:
        return {}
    st = (data.get("streams") or [{}])[0]
    try:
        duration = float(st.get("duration") or (data.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    pix = str(st.get("pix_fmt") or "")
    alpha = any(k in pix for k in ("yuva", "rgba", "argb", "bgra", "abgr", "gbrap", "ya8", "ya16", "pal8")) or (
        str((st.get("tags") or {}).get("alpha_mode")) == "1")
    return {"width": int(st.get("width") or 0), "height": int(st.get("height") or 0), "duration": duration,
            "alpha": alpha, "codec": st.get("codec_name") or ""}


def _media_public(item: dict[str, Any]) -> dict[str, Any]:
    return {"id": item["id"], "name": item.get("name") or item["id"], "kind": item.get("kind", "video"),
            "duration": item.get("duration", 0.0), "width": item.get("width", 0), "height": item.get("height", 0),
            "alpha": bool(item.get("alpha")), "url": f"{URL_BASE}/api/transitions/media/{item['id']}/file"}


def list_media() -> list[dict[str, Any]]:
    with _lock:
        return [_media_public(i) for i in _read()["media"]]


def media_path(media_id: Any) -> Path | None:
    if not isinstance(media_id, str) or not ID_RE.match(media_id):
        return None
    with _lock:
        for i in _read()["media"]:
            if i["id"] == media_id:
                p = MEDIA_DIR / str(i.get("file", ""))
                return p if p.exists() else None
    return None


def media_info(media_id: Any) -> dict[str, Any] | None:
    with _lock:
        for i in _read()["media"]:
            if i["id"] == media_id:
                return dict(i)
    return None


def add_media(raw: bytes, filename: str) -> dict[str, Any]:
    ext = Path(filename).suffix.lower()
    if ext not in VIDEO_EXT | IMAGE_EXT:
        raise LibraryError("Use um vídeo (WebM, MOV, MP4) ou uma imagem (PNG, JPG, WebP).")
    if not raw:
        raise LibraryError("O arquivo está vazio.")
    if len(raw) > MAX_MEDIA_BYTES:
        raise LibraryError(f"O arquivo passa de {MAX_MEDIA_BYTES // 1048576} MB.")
    with _lock:
        data = _read()
        if len(data["media"]) >= MAX_MEDIA:
            raise LibraryError("A biblioteca de transições importadas está cheia: exclua algum arquivo antes.")
        mid = f"m_{uuid.uuid4().hex[:10]}"
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        dest = MEDIA_DIR / f"{mid}{ext}"
        dest.write_bytes(raw)
        info = _probe(dest)
        if info.get("width", 0) <= 0 or info.get("height", 0) <= 0:
            dest.unlink(missing_ok=True)
            raise LibraryError("Não consegui ler a imagem desse arquivo.")
        is_image = ext in IMAGE_EXT
        duration = 0.0 if is_image else info["duration"]
        if not is_image and duration > MAX_MEDIA_SECONDS:
            dest.unlink(missing_ok=True)
            raise LibraryError(f"Uma transição deve ter até {MAX_MEDIA_SECONDS:.0f} segundos (este vídeo tem {duration:.0f}).")
        alpha = bool(info.get("alpha")) or ext in (".png", ".webp")
        item = {"id": mid, "name": _clean_text(Path(filename).stem, 60, "Transição"), "file": dest.name,
                "kind": "image" if is_image else "video", "duration": round(duration, 3), "width": info["width"],
                "height": info["height"], "alpha": alpha, "codec": info.get("codec", ""), "added": int(time.time())}
        data["media"].append(item)
        _write(data)
        return _media_public(item)


def delete_media(media_id: str) -> str:
    """"ok" | "missing" | "in_use" (some transition of the library still uses it)."""
    with _lock:
        data = _read()
        for c in data["custom"]:
            if any(f.get("type") == "overlay" and f.get("media") == media_id for f in c.get("fx") or []):
                return "in_use"
        keep = [m for m in data["media"] if m["id"] != media_id]
        if len(keep) == len(data["media"]):
            return "missing"
        for m in data["media"]:
            if m["id"] == media_id:
                (MEDIA_DIR / str(m.get("file", ""))).unlink(missing_ok=True)
        data["media"] = keep
        _write(data)
    return "ok"


tr.register_library(get_custom, list_custom)
