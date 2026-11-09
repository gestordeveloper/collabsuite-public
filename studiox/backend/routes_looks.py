"""API of the LUT library (backend/luts.py): list, upload a .cube, delete, and the .cube itself for the preview."""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend import luts

router = APIRouter(prefix="/api/luts")


@router.get("")
def list_luts():
    return {"luts": luts.catalog(), "limits": {"max_mb": luts.MAX_BYTES // 1048576}}


@router.post("")
def upload_lut(file: UploadFile = File(...)):
    raw = file.file.read(luts.MAX_BYTES + 1)
    try:
        return luts.add(raw, file.filename or "")
    except luts.LutError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{lut_id}")
def delete_lut(lut_id: str):
    result = luts.remove(lut_id)
    if result == "builtin":
        raise HTTPException(status_code=400, detail="Os looks prontos não podem ser excluídos.")
    if result == "missing":
        raise HTTPException(status_code=404, detail="LUT não encontrado")
    return {"deleted": lut_id}


@router.get("/{lut_id}/cube")
def lut_cube(lut_id: str):
    """The .cube as text: the preview parses it into a WebGL 3D texture."""
    path = luts.path_of(lut_id)
    if not path:
        raise HTTPException(status_code=404, detail="LUT não encontrado")
    return FileResponse(path, media_type="text/plain; charset=utf-8", headers={"Cache-Control": "no-cache"})
