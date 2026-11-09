"""The music library: songs the user uploads or imports from the free catalogs (backend/music_catalog.py).

Unlike the split-screen media, the library is shared by every project (storage/music/): a song is uploaded or
imported once and used in any video, and the queue can use it later. Each project only keeps a reference (the
clips in `edit.music`, see backend/music_mix.py).

storage/music/
    library.json        the list (name, artist, where it came from, licence, duration, loudness...)
    files/<id>.<ext>    the audio as it was uploaded or downloaded
    peaks/<id>.b64      the waveform (one byte per 20 ms) the timeline draws when cutting the song
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any

from backend import music_mix, projects
from backend.config import URL_BASE, MUSIC_DIR, PROJECTS_DIR, ensure_ffmpeg
from backend.fsutil import replace_file

ensure_ffmpeg()

try:
    import numpy as np
except ImportError:   # peaks are a nicety: without numpy the timeline just draws a plain bar
    np = None

AUDIO_EXT = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac")
MEDIA_TYPES = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
               ".oga": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac"}
MAX_BYTES = 120 * 1024 * 1024
MAX_SECONDS = 40 * 60
MIN_SECONDS = 1.0
MAX_ITEMS = 500
PEAK_RATE = 50                 # peaks per second (20 ms each)
FILES_DIR = MUSIC_DIR / "files"
PEAKS_DIR = MUSIC_DIR / "peaks"
INDEX = MUSIC_DIR / "library.json"

_lock = threading.RLock()


class MusicError(Exception):
    """A problem the user can fix (wrong format, too big...); the message is shown as is."""


def _dirs() -> None:
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    PEAKS_DIR.mkdir(parents=True, exist_ok=True)


def _read_index() -> list[dict[str, Any]]:
    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = data.get("items") if isinstance(data, dict) else None
    return [i for i in (items or []) if isinstance(i, dict) and i.get("id") and i.get("file")]


def _write_index(items: list[dict[str, Any]]) -> None:
    tmp = INDEX.with_name(f"{INDEX.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps({"version": 1, "items": items}, ensure_ascii=False), encoding="utf-8")
    replace_file(tmp, INDEX)


def list_items() -> list[dict[str, Any]]:
    with _lock:
        items = _read_index()
    # newest first; the file is in upload order, so reversing it first also orders songs added within the same second
    return sorted(reversed(items), key=lambda i: i.get("created_at") or "", reverse=True)


def get(audio_id: str) -> dict[str, Any] | None:
    return next((i for i in list_items() if i["id"] == audio_id), None)


def find_by_source_key(key: str) -> dict[str, Any] | None:
    return next((i for i in list_items() if key and i.get("source_key") == key), None)


def path_of(item: dict[str, Any]) -> Path:
    return FILES_DIR / item["file"]


def lookup() -> dict[str, dict[str, Any]]:
    """id -> what the render needs, for the files that still exist."""
    out = {}
    for i in list_items():
        p = path_of(i)
        if p.exists():
            out[i["id"]] = {"path": p, "duration": i.get("duration") or 0.0, "lufs": i.get("lufs"), "name": i.get("name") or i["id"]}
    return out


def public(item: dict[str, Any]) -> dict[str, Any]:
    """What the browser gets (no file system paths)."""
    keys = ("id", "name", "artist", "source", "license", "license_url", "credit_required", "attribution", "origin_url",
            "duration", "lufs", "bytes", "created_at", "ext")
    return {k: item.get(k) for k in keys} | {"url": f"{URL_BASE}/api/music/{item['id']}/file", "peaks_url": f"{URL_BASE}/api/music/{item['id']}/peaks"}


# ----------------------------------------------------------------------------
# Analysis
# ----------------------------------------------------------------------------
def _probe(path: Path) -> dict[str, Any]:
    proc = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name",
                           "-of", "json", str(path)], capture_output=True, text=True)
    try:
        data = json.loads(proc.stdout or "{}")
    except ValueError:
        data = {}
    if proc.returncode != 0 or not any(s.get("codec_type") == "audio" for s in data.get("streams") or []):
        raise MusicError("Não consegui ler esse arquivo como áudio. Ele está corrompido ou não é MP3, WAV, M4A, OGG ou FLAC?")
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    return {"duration": duration}


def measure_loudness(path: Path) -> float | None:
    """Integrated loudness in LUFS (EBU R128), or None for silence / when it cannot be measured."""
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-af", "ebur128=framelog=quiet",
                           "-f", "null", "-"], capture_output=True, text=True)
    found = re.findall(r"\bI:\s+(-?\d+(?:\.\d+)?)\s+LUFS", proc.stderr or "")
    if not found:
        return None
    value = float(found[-1])
    return value if value > -70 else None


def compute_peaks(path: Path, duration: float) -> bytes:
    """One byte per 20 ms: the loudest sample of the window, scaled so the loudest window of the song is 255."""
    if np is None:
        return b""
    rate = 8000
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(rate), "-t", str(MAX_SECONDS),
                           "-f", "s16le", "-"], capture_output=True)
    data = np.frombuffer(proc.stdout, dtype=np.int16)
    win = rate // PEAK_RATE
    n = data.size // win
    if n <= 0:
        return b""
    peaks = np.abs(data[: n * win].astype(np.int32)).reshape(n, win).max(axis=1).astype(np.float32)
    top = float(peaks.max())
    if top <= 0:
        return bytes(n)
    return np.clip(np.round(peaks / top * 255), 0, 255).astype(np.uint8).tobytes()


def peaks_b64(audio_id: str) -> str | None:
    p = PEAKS_DIR / f"{audio_id}.b64"
    if not re.fullmatch(r"[\w\-]+", audio_id) or not p.exists():
        return None
    return p.read_text(encoding="ascii")


# ----------------------------------------------------------------------------
# Library
# ----------------------------------------------------------------------------
def _clean_name(name: str, fallback: str) -> str:
    return re.sub(r"[\r\n\t]+", " ", name or "").strip()[:80] or fallback


def add(tmp_path: Path, name: str, source: str = "upload", *, artist: str = "", license: str = "", license_url: str = "",
        credit_required: bool = False, attribution: str = "", origin_url: str = "", source_key: str = "") -> dict[str, Any]:
    """Registers a file (tmp_path) after checking and analysing it. The file is moved into the library."""
    _dirs()
    try:
        ext = tmp_path.suffix.lower()
        if ext not in AUDIO_EXT:
            raise MusicError("Formato não suportado. Use MP3, WAV, M4A, AAC, OGG, OPUS ou FLAC.")
        size = tmp_path.stat().st_size
        if size == 0:
            raise MusicError("O arquivo está vazio.")
        if size > MAX_BYTES:
            raise MusicError(f"Arquivo grande demais (o limite é {MAX_BYTES // (1024 * 1024)} MB).")
        meta = _probe(tmp_path)
        duration = meta["duration"]
        if duration < MIN_SECONDS:
            raise MusicError("O áudio é curto demais (menos de 1 segundo).")
        if duration > MAX_SECONDS:
            raise MusicError(f"O áudio passa de {MAX_SECONDS // 60} minutos. Corte-o antes de enviar.")
        with _lock:
            if len(_read_index()) >= MAX_ITEMS:
                raise MusicError(f"A biblioteca já tem {MAX_ITEMS} músicas. Apague algumas antes de adicionar outras.")

        audio_id = f"a_{uuid.uuid4().hex[:8]}"
        final = FILES_DIR / f"{audio_id}{ext}"
        lufs = measure_loudness(tmp_path)
        peaks = compute_peaks(tmp_path, duration)
        tmp_path.replace(final)
    except MusicError:
        tmp_path.unlink(missing_ok=True)
        raise
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        raise MusicError(f"Não foi possível guardar o arquivo: {exc}")

    (PEAKS_DIR / f"{audio_id}.b64").write_text(base64.b64encode(peaks).decode("ascii"), encoding="ascii")
    item = {
        "id": audio_id, "name": _clean_name(name, audio_id), "artist": _clean_name(artist, "")[:80], "file": final.name, "ext": ext,
        "source": source, "source_key": source_key or None, "license": license[:40], "license_url": license_url[:300],
        "credit_required": bool(credit_required), "attribution": attribution[:600], "origin_url": origin_url[:300],
        "duration": round(duration, 2), "lufs": round(lufs, 1) if lufs is not None else None, "bytes": size,
        "created_at": projects.now_iso(),
    }
    with _lock:
        items = _read_index()
        items.append(item)
        _write_index(items)
    return item


def projects_using(audio_id: str) -> list[str]:
    """Ids of the projects with at least one clip of this song."""
    found = []
    if not PROJECTS_DIR.exists():
        return found
    for d in PROJECTS_DIR.iterdir():
        if d.is_dir() and projects.ID_RE.match(d.name) and (d / projects.STATE_FILE).exists():
            edit = projects.read_state(d.name).get("edit")
            if isinstance(edit, dict) and audio_id in music_mix.used_audio_ids(edit.get("music")):
                found.append(d.name)
    return found


def remove(audio_id: str) -> bool:
    """Deletes the song and its clips in every project."""
    item = get(audio_id)
    if not item:
        return False
    for pid in projects_using(audio_id):
        def mutate(st: dict) -> None:
            edit = st.get("edit")
            if isinstance(edit, dict):
                edit["music"] = music_mix.remove_audio(edit.get("music"), audio_id)
        projects.update_state(pid, mutate)
    with _lock:
        _write_index([i for i in _read_index() if i["id"] != audio_id])
    path_of(item).unlink(missing_ok=True)
    (PEAKS_DIR / f"{audio_id}.b64").unlink(missing_ok=True)
    return True
