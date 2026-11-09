"""The images and videos a project can use beside the speaker (split screen): files the user uploads and
pictures/clips made by an AI provider (backend/media_generation.py).

Files live in storage/projects/<id>/media/; the list (name, kind, size, where it came from, the prompt) is in
the project state, so it travels with the project and is removed with it.
"""
from __future__ import annotations

import json
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

from backend import projects
from backend.config import URL_BASE, ensure_ffmpeg
from backend.split_screen import remove_media as split_without

ensure_ffmpeg()

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi")
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_VIDEO_BYTES = 600 * 1024 * 1024
MAX_ITEMS = 60
MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
               ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
               ".mkv": "video/x-matroska", ".avi": "video/x-msvideo"}


class MediaError(Exception):
    """A problem the user can fix (wrong format, too big...)."""


def media_dir(pid: str) -> Path:
    d = projects.project_dir(pid) / "media"
    d.mkdir(parents=True, exist_ok=True)
    return d


def kind_of(filename: str) -> str | None:
    ext = Path(filename).suffix.lower()
    return "image" if ext in IMAGE_EXT else ("video" if ext in VIDEO_EXT else None)


def _probe(path: Path) -> dict[str, Any]:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,codec_name:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True)
    if proc.returncode != 0:
        raise MediaError("Não consegui ler esse arquivo. Ele está corrompido ou não é uma imagem/vídeo comum?")
    try:
        data = json.loads(proc.stdout or "{}")
        stream = (data.get("streams") or [{}])[0]
        return {"width": int(stream.get("width") or 0), "height": int(stream.get("height") or 0),
                "duration": float((data.get("format") or {}).get("duration") or 0)}
    except (ValueError, TypeError):
        raise MediaError("Não consegui ler esse arquivo.")


def _thumb(src: Path, dst: Path, is_video: bool) -> None:
    seek = ["-ss", "0.3"] if is_video else []
    proc = subprocess.run(["ffmpeg", "-y", *seek, "-i", str(src), "-frames:v", "1", "-vf", "scale=360:-2",
                           "-q:v", "4", str(dst)], capture_output=True, text=True)
    if proc.returncode != 0 or not dst.exists():  # a clip shorter than 0.3 s
        subprocess.run(["ffmpeg", "-y", "-i", str(src), "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", str(dst)],
                       capture_output=True, text=True)


def public(item: dict[str, Any], pid: str) -> dict[str, Any]:
    """What the browser gets (no file system paths)."""
    base = f"{URL_BASE}/api/projects/{pid}/media/{item['id']}"
    return {k: item.get(k) for k in ("id", "kind", "name", "source", "prompt", "model", "width", "height", "duration",
                                     "bytes", "created_at")} | {"url": f"{base}/file", "thumb_url": f"{base}/thumb"}


def list_media(pid: str) -> list[dict[str, Any]]:
    return [m for m in (projects.read_state(pid).get("media") or []) if isinstance(m, dict) and m.get("id")]


def get(pid: str, media_id: str) -> dict[str, Any] | None:
    return next((m for m in list_media(pid) if m["id"] == media_id), None)


def path_of(pid: str, item: dict[str, Any]) -> Path:
    return media_dir(pid) / item["file"]


def lookup(pid: str) -> dict[str, dict[str, Any]]:
    """id -> {path, kind, name, duration} of the files that still exist (what the render needs)."""
    out = {}
    for m in list_media(pid):
        p = path_of(pid, m)
        if p.exists():
            out[m["id"]] = {"path": p, "kind": m["kind"], "name": m.get("name", ""), "duration": m.get("duration")}
    return out


def add(pid: str, tmp_path: Path, name: str, kind: str, source: str = "upload", prompt: str | None = None,
        model: str | None = None) -> dict[str, Any]:
    """Registers a file that is already inside the project's media folder (tmp_path). Validates it first."""
    try:
        size = tmp_path.stat().st_size
        if size == 0:
            raise MediaError("O arquivo está vazio.")
        if size > (MAX_IMAGE_BYTES if kind == "image" else MAX_VIDEO_BYTES):
            limit = (MAX_IMAGE_BYTES if kind == "image" else MAX_VIDEO_BYTES) // (1024 * 1024)
            raise MediaError(f"Arquivo grande demais (o limite é {limit} MB para {'imagens' if kind == 'image' else 'vídeos'}).")
        meta = _probe(tmp_path)
        if not meta["width"] or not meta["height"]:
            raise MediaError("Não consegui ler esse arquivo. Ele está corrompido ou não é uma imagem/vídeo comum?")
        if kind == "video" and meta["duration"] < 0.3:
            raise MediaError("O vídeo é curto demais (menos de 0,3 s).")
        if len(list_media(pid)) >= MAX_ITEMS:
            raise MediaError(f"Este projeto já tem {MAX_ITEMS} mídias. Apague algumas antes de adicionar outras.")

        media_id = f"m_{uuid.uuid4().hex[:8]}"
        ext = tmp_path.suffix.lower() or (".png" if kind == "image" else ".mp4")
        final = media_dir(pid) / f"{media_id}{ext}"
        tmp_path.replace(final)
        (media_dir(pid) / "thumbs").mkdir(exist_ok=True)
        _thumb(final, media_dir(pid) / "thumbs" / f"{media_id}.jpg", kind == "video")
    except MediaError:
        tmp_path.unlink(missing_ok=True)
        raise

    item = {
        "id": media_id, "kind": kind, "name": re.sub(r"[^\w.\- ]", "_", name)[:80] or media_id, "file": final.name,
        "source": source, "prompt": (prompt or "")[:1500] or None, "model": model, "width": meta["width"],
        "height": meta["height"], "duration": round(meta["duration"], 2) if kind == "video" else None,
        "bytes": final.stat().st_size, "created_at": projects.now_iso(),
    }
    projects.update_state(pid, lambda st: st.setdefault("media", []).append(item))
    return item


def remove(pid: str, media_id: str) -> bool:
    item = get(pid, media_id)
    if not item:
        return False

    def mutate(st: dict) -> None:
        st["media"] = [m for m in (st.get("media") or []) if m.get("id") != media_id]
        edit = st.get("edit")
        if isinstance(edit, dict) and edit.get("split"):
            edit["split"] = split_without(edit["split"], media_id)
    projects.update_state(pid, mutate)
    path_of(pid, item).unlink(missing_ok=True)
    (media_dir(pid) / "thumbs" / f"{media_id}.jpg").unlink(missing_ok=True)
    return True
