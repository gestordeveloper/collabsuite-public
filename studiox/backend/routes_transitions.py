"""API of the transitions: the catalog (ready-made + the user's own), building/saving a custom one, the imported
overlay files (video/PNG), and the library of sound effects played at the cuts."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend import sfx, transition_library as lib, transitions as tr

router = APIRouter(prefix="/api")


# --- transitions -------------------------------------------------------------------
@router.get("/transitions")
def list_transitions():
    return {"transitions": tr.all_transitions(), "media": lib.list_media(), "sounds": sfx.catalog(),
            "limits": {"media_mb": lib.MAX_MEDIA_BYTES // 1048576, "media_seconds": lib.MAX_MEDIA_SECONDS,
                       "sound_mb": sfx.MAX_BYTES // 1048576, "sound_seconds": sfx.MAX_SECONDS,
                       "overlay_max": tr.OVERLAY_MAX_DUR, "max_fx": tr.MAX_FX},
            "sound_defaults": {"volume": 0.8, "offset": 0.0, "volume_range": list(tr.SOUND_VOLUME), "offset_range": list(tr.SOUND_OFFSET)}}


@router.post("/transitions")
def create_transition(body: dict[str, Any]):
    try:
        return lib.save_custom(body)
    except lib.LibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/transitions/{transition_id}")
def update_transition(transition_id: str, body: dict[str, Any]):
    if transition_id in tr.BY_ID:
        raise HTTPException(status_code=400, detail="As transições prontas não podem ser alteradas: duplique uma e edite a cópia.")
    try:
        return lib.save_custom(body, transition_id)
    except lib.LibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/transitions/{transition_id}")
def delete_transition(transition_id: str):
    if transition_id in tr.BY_ID:
        raise HTTPException(status_code=400, detail="As transições prontas não podem ser excluídas.")
    if not lib.delete_custom(transition_id):
        raise HTTPException(status_code=404, detail="Transição não encontrada")
    return {"deleted": transition_id}


# --- imported overlay files -----------------------------------------------------------
@router.post("/transitions/media")
def upload_media(file: UploadFile = File(...)):
    raw = file.file.read(lib.MAX_MEDIA_BYTES + 1)
    try:
        return lib.add_media(raw, file.filename or "")
    except lib.LibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/transitions/media/{media_id}")
def delete_media(media_id: str):
    result = lib.delete_media(media_id)
    if result == "missing":
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    if result == "in_use":
        raise HTTPException(status_code=400, detail="Alguma transição sua ainda usa este arquivo: exclua ou edite a transição antes.")
    return {"deleted": media_id}


@router.get("/transitions/media/{media_id}/file")
def media_file(media_id: str):
    path = lib.media_path(media_id)
    if not path:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


# --- sound effects ----------------------------------------------------------------------
@router.get("/sfx")
def list_sounds():
    return {"sounds": sfx.catalog(), "limits": {"max_mb": sfx.MAX_BYTES // 1048576, "max_seconds": sfx.MAX_SECONDS}}


@router.post("/sfx")
def upload_sound(file: UploadFile = File(...)):
    raw = file.file.read(sfx.MAX_BYTES + 1)
    try:
        return sfx.add(raw, file.filename or "")
    except sfx.SfxError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/sfx/{sound_id}")
def delete_sound(sound_id: str):
    result = sfx.remove(sound_id)
    if result == "builtin":
        raise HTTPException(status_code=400, detail="Os sons prontos não podem ser excluídos.")
    if result == "missing":
        raise HTTPException(status_code=404, detail="Som não encontrado")
    return {"deleted": sound_id}


@router.get("/sfx/{sound_id}/audio")
def sound_audio(sound_id: str):
    """The sound itself, for the preview to play at the cuts."""
    path = sfx.path_of(sound_id)
    if not path:
        raise HTTPException(status_code=404, detail="Som não encontrado")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})
