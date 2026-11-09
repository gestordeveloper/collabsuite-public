"""API of the music library: upload, list, waveform, delete, and search/import of the free catalogs."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend import music_catalog, music_library, music_mix, projects
from backend.music_catalog import CatalogError
from backend.music_library import MusicError

router = APIRouter()


@router.get("/api/music")
def list_music():
    return {
        "items": [music_library.public(i) for i in music_library.list_items()],
        "providers": music_catalog.PROVIDERS,
        "constants": music_mix.constants(),
        "formats": [e.lstrip(".") for e in music_library.AUDIO_EXT],
        "limits": {"mb": music_library.MAX_BYTES // (1024 * 1024), "minutes": music_library.MAX_SECONDS // 60},
    }


@router.post("/api/music")
def upload_music(file: UploadFile = File(...)):
    name = file.filename or ""
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in music_library.AUDIO_EXT:
        raise HTTPException(status_code=400, detail="Formato não suportado. Use MP3, WAV, M4A, AAC, OGG, OPUS ou FLAC.")
    music_library.FILES_DIR.mkdir(parents=True, exist_ok=True)
    tmp = music_library.FILES_DIR / f"upload_{uuid.uuid4().hex[:8]}{ext}"
    written = 0
    try:
        with open(tmp, "wb") as out:
            while chunk := file.file.read(1024 * 1024):
                written += len(chunk)
                if written > music_library.MAX_BYTES:
                    raise MusicError(f"Arquivo grande demais (o limite é {music_library.MAX_BYTES // (1024 * 1024)} MB).")
                out.write(chunk)
        item = music_library.add(tmp, name.rsplit(".", 1)[0] if "." in name else name, source="upload")
    except MusicError as exc:
        tmp.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc))
    return music_library.public(item)


@router.get("/api/music/{audio_id}/usage")
def music_usage(audio_id: str):
    """How many projects have clips of this song (asked before deleting it)."""
    if not music_library.get(audio_id):
        raise HTTPException(status_code=404, detail="Música não encontrada")
    return {"projects": len(music_library.projects_using(audio_id))}


@router.delete("/api/music/{audio_id}")
def delete_music(audio_id: str, force: bool = False):
    item = music_library.get(audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Música não encontrada")
    used = music_library.projects_using(audio_id)
    if used and not force:
        raise HTTPException(status_code=409, detail=json.dumps({"projects": len(used)}))
    music_library.remove(audio_id)
    return {"deleted": audio_id, "projects": len(used)}


@router.get("/api/music/{audio_id}/file")
def music_file(audio_id: str):
    item = music_library.get(audio_id)
    path = music_library.path_of(item) if item else None
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return FileResponse(path, media_type=music_library.MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
                        headers={"Cache-Control": "private, max-age=3600"})


@router.get("/api/music/{audio_id}/peaks")
def music_peaks(audio_id: str):
    item = music_library.get(audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Música não encontrada")
    return {"rate": music_library.PEAK_RATE, "duration": item.get("duration"), "peaks": music_library.peaks_b64(audio_id) or ""}


@router.get("/api/music/catalog/search")
def catalog_search(provider: str = "incompetech", q: str = "", mood: str = "", genre: str = "", mode: str = "credit",
                   min_s: float = Query(0, ge=0), max_s: float = Query(0, ge=0), page: int = Query(1, ge=1, le=50)):
    try:
        data = music_catalog.search(provider, q=q[:120], mood=mood[:40], genre=genre[:40], mode=mode, min_s=min_s, max_s=max_s, page=page)
    except CatalogError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    keys = {i.get("source_key"): i["id"] for i in music_library.list_items() if i.get("source_key")}
    for r in data["results"]:
        r["in_library"] = keys.get(f"{r['provider']}:{r['key']}")
    return data


class ImportBody(BaseModel):
    provider: str
    key: str


@router.post("/api/music/catalog/import")
def catalog_import(body: ImportBody):
    try:
        item, existed = music_catalog.import_track(body.provider, body.key)
    except CatalogError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"item": music_library.public(item), "already_there": existed}


@router.get("/api/projects/{project_id}/audio-info")
def audio_info(project_id: str):
    """Loudness of the video's own audio (measured once): the preview uses it to hear the voice like the render will."""
    try:
        info = projects.read_info(project_id)
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    pdir = projects.project_dir(project_id)
    cache = pdir / "audio_info.json"
    source = info.get("source_name") or ""
    try:
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("source") == source:
            return data
    except (OSError, ValueError):
        pass
    data = {"source": source, "lufs": music_library.measure_loudness(pdir / source)}
    try:
        cache.write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass
    return data
