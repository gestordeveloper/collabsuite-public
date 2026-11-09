"""LUTs (3D colour look-up tables, .cube): a small library of ready-made looks plus the ones the user uploads.

A LUT is applied by ffmpeg's lut3d filter (backend/looks.py) and by the browser preview (WebGL, js/fx.js), which
read the same .cube file, so what is seen in the editor is what is rendered. `intensity` (0..1) mixes the LUT with
the untouched picture.

The ready-made looks are not shipped as files: they are generated here (deterministic maths on a 33x33x33 grid) the
first time they are needed, into storage/luts/builtin/. The user's own LUTs live in storage/luts/user/.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np

from backend.config import STORAGE_DIR
from backend.fsutil import replace_file

LUTS_DIR = STORAGE_DIR / "luts"
BUILTIN_DIR = LUTS_DIR / "builtin"
USER_DIR = LUTS_DIR / "user"
INDEX = LUTS_DIR / "library.json"

GRID = 33                       # size of the generated cubes
MAX_BYTES = 40 * 1024 * 1024    # an upload larger than this is not a LUT (a 65^3 cube is ~5 MB of text)
MAX_SIZE = 129                  # LUT_3D_SIZE accepted from uploads
MAX_ITEMS = 60
GENERATOR_VERSION = 1           # bump when the looks below change: the cached files are rebuilt
ID_RE = re.compile(r"^[a-z0-9_]{1,60}$")

# The same reference colours the template screen paints (skin, sky, foliage, reds, greys): a LUT card shows how
# the look moves them
SWATCH_COLORS = ["#e0ac8f", "#c98a6a", "#8a5a44", "#87b6e6", "#3f7fbf", "#5f9e4a",
                 "#2f6b34", "#d9433a", "#f2c94c", "#f5f5f5", "#9a9a9a", "#2a2a2a"]

_lock = threading.RLock()


class LutError(Exception):
    """A problem the user can fix (not a 3D .cube, too big...); the message is shown as is."""


# ----------------------------------------------------------------------------
# The ready-made looks
# ----------------------------------------------------------------------------
def _smooth(x: np.ndarray) -> np.ndarray:
    return x * x * (3 - 2 * x)


def _look(rgb: np.ndarray, contrast: float = 1.0, sat: float = 1.0, lift: float = 0.0, gamma: float = 1.0,
          shadows: tuple = (0, 0, 0), mids: tuple = (0, 0, 0), highlights: tuple = (0, 0, 0),
          mono: tuple | None = None) -> np.ndarray:
    """One colour treatment on an (N, 3) array of RGB in 0..1: gamma, an S-shaped contrast, saturation,
    split toning (tints of the shadows / mid-tones / highlights) and a lift of the blacks."""
    x = np.clip(rgb, 0.0, 1.0) ** (1.0 / gamma)
    if contrast >= 1.0:
        amount = min(1.0, (contrast - 1.0) * 3.0)
        x = x + (_smooth(x) - x) * amount
    else:
        x = 0.5 + (x - 0.5) * contrast
    luma = x @ np.array([0.2126, 0.7152, 0.0722])
    x = luma[:, None] + (x - luma[:, None]) * sat
    luma = np.clip(luma, 0.0, 1.0)
    x = (x + ((1 - luma) ** 2)[:, None] * np.array(shadows) + (4 * luma * (1 - luma))[:, None] * np.array(mids)
         + (luma ** 2)[:, None] * np.array(highlights))
    if mono is not None:
        g = np.clip(x @ np.array([0.2126, 0.7152, 0.0722]), 0.0, 1.0)
        x = g[:, None] * np.array(mono)
    x = x * (1 - lift) + lift
    return np.clip(x, 0.0, 1.0)


# id -> (name, category, description, parameters of _look)
BUILTIN: dict[str, tuple[str, str, str, dict[str, Any]]] = {
    "natural_pop": ("Natural nítido", "Realce", "Um pouco mais de contraste e cor, sem mudar o clima. O mais seguro para qualquer vídeo.",
                    dict(contrast=1.08, sat=1.08, gamma=1.02)),
    "vivid_pop": ("Vívido (redes sociais)", "Realce", "Contraste e saturação altos e leve calor: destaca o vídeo no feed.",
                  dict(contrast=1.16, sat=1.28, highlights=(0.015, 0.005, -0.015))),
    "cinema_teal_orange": ("Cinema teal & laranja", "Cinema", "Sombras esverdeadas-azuladas e luzes alaranjadas: o visual clássico de cinema.",
                           dict(contrast=1.14, sat=1.06, shadows=(-0.05, 0.02, 0.07), highlights=(0.07, 0.02, -0.06))),
    "film_warm": ("Filme quente", "Cinema", "Tons quentes de filme, pretos levemente levantados e altas luzes suaves.",
                  dict(contrast=1.06, sat=1.04, lift=0.03, mids=(0.02, 0.005, -0.02), highlights=(0.04, 0.015, -0.03))),
    "film_cool": ("Filme frio", "Cinema", "Sombras azuladas, cores mais contidas e contraste firme: clima sério e moderno.",
                  dict(contrast=1.12, sat=0.86, shadows=(-0.03, 0.0, 0.06), highlights=(-0.01, 0.005, 0.025))),
    "soft_portrait": ("Retrato suave", "Pele", "Contraste mais leve e pele quente: favorece quem fala para a câmera.",
                      dict(contrast=0.94, sat=0.96, lift=0.025, gamma=1.05, mids=(0.015, 0.004, -0.008))),
    "bleach_bypass": ("Bleach bypass", "Estilizado", "Cores lavadas e contraste forte, como filme com a prata retida.",
                      dict(contrast=1.28, sat=0.6, gamma=0.98)),
    "vintage_fade": ("Vintage desbotado", "Estilizado", "Pretos acinzentados e sombras esverdeadas, como foto antiga.",
                     dict(contrast=0.98, sat=0.82, lift=0.07, shadows=(-0.02, 0.03, 0.02), highlights=(0.03, 0.02, -0.02))),
    "mono_cinema": ("P&B cinematográfico", "Estilizado", "Preto e branco de contraste rico, com um leve tom quente.",
                    dict(contrast=1.22, mono=(1.02, 1.0, 0.94))),
}


def _hex_to_rgb(colors: list[str]) -> np.ndarray:
    return np.array([[int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)] for c in colors])


def _rgb_to_hex(rgb: np.ndarray) -> list[str]:
    return ["#%02x%02x%02x" % tuple(int(round(v * 255)) for v in np.clip(row, 0, 1)) for row in rgb]


def _builtin_swatches(lut_id: str) -> list[str]:
    return _rgb_to_hex(_look(_hex_to_rgb(SWATCH_COLORS), **BUILTIN[lut_id][3]))


def _cube_text(lut_id: str, title: str, grid: int = GRID) -> str:
    """The .cube file of a ready-made look (red changes fastest, as the format wants)."""
    idx = np.arange(grid) / (grid - 1)
    b, g, r = np.meshgrid(idx, idx, idx, indexing="ij")
    rgb = np.stack([r.ravel(), g.ravel(), b.ravel()], axis=1)
    out = _look(rgb, **BUILTIN[lut_id][3])
    lines = [f"# StudioX look v{GENERATOR_VERSION}", f'TITLE "{title}"', f"LUT_3D_SIZE {grid}"]
    lines += [f"{a:.6f} {bb:.6f} {c:.6f}" for a, bb, c in out]
    return "\n".join(lines) + "\n"


def _builtin_path(lut_id: str) -> Path:
    """Path of a ready-made look, generated (or regenerated after a generator change) when missing."""
    path = BUILTIN_DIR / f"{lut_id}.cube"
    with _lock:
        stale = True
        try:
            with open(path, "r", encoding="utf-8") as fh:
                stale = fh.readline().strip() != f"# StudioX look v{GENERATOR_VERSION}"
        except OSError:
            pass
        if stale:
            BUILTIN_DIR.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
            tmp.write_text(_cube_text(lut_id, BUILTIN[lut_id][0]), encoding="utf-8")
            replace_file(tmp, path)
    return path


# ----------------------------------------------------------------------------
# Reading a .cube (also the validation of uploads)
# ----------------------------------------------------------------------------
def parse_cube(text: str) -> tuple[int, np.ndarray]:
    """(size, data): data has shape (size, size, size, 3) indexed [blue][green][red]. Raises LutError when the file is
    not a usable 3D LUT."""
    size = 0
    rows: list[list[str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        head = line.split(None, 1)[0].upper()
        if head == "LUT_3D_SIZE":
            try:
                size = int(line.split()[1])
            except (IndexError, ValueError):
                raise LutError("O arquivo .cube tem um LUT_3D_SIZE inválido.")
        elif head == "LUT_1D_SIZE":
            raise LutError("Este .cube é um LUT 1D. Só LUTs 3D (LUT_3D_SIZE) são aceitos.")
        elif head in ("DOMAIN_MIN", "DOMAIN_MAX"):
            vals = line.split()[1:]
            try:
                ok = all(abs(float(v) - (0.0 if head == "DOMAIN_MIN" else 1.0)) < 1e-6 for v in vals)
            except ValueError:
                ok = False
            if not ok:
                raise LutError("Este .cube usa um domínio de entrada diferente de 0–1 (DOMAIN_MIN/MAX), que não é suportado.")
        elif head in ("TITLE", "LUT_3D_INPUT_RANGE", "LUT_1D_INPUT_RANGE"):
            continue
        elif line[0] in "0123456789+-.":
            parts = line.split()
            if len(parts) != 3:
                raise LutError("O arquivo .cube tem uma linha de dados que não tem 3 valores.")
            rows.append(parts)
        else:
            continue   # unknown keyword: ignore, as most tools do
    if size < 2 or size > MAX_SIZE:
        raise LutError(f"O arquivo .cube precisa declarar LUT_3D_SIZE entre 2 e {MAX_SIZE}.")
    if len(rows) != size ** 3:
        raise LutError(f"O .cube deveria ter {size ** 3} linhas de cor (LUT_3D_SIZE {size}) e tem {len(rows)}.")
    try:
        data = np.array(rows, dtype=np.float64)
    except ValueError:
        raise LutError("O arquivo .cube tem valores que não são números.")
    if not np.isfinite(data).all():
        raise LutError("O arquivo .cube tem valores inválidos (NaN/infinito).")
    return size, data.reshape(size, size, size, 3)


def apply_cube(size: int, data: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    """Trilinear lookup of (N, 3) colours in 0..1."""
    p = np.clip(rgb, 0.0, 1.0) * (size - 1)
    i0 = np.clip(np.floor(p).astype(int), 0, size - 2)
    f = p - i0
    r0, g0, b0 = i0[:, 0], i0[:, 1], i0[:, 2]
    fr, fg, fb = f[:, 0:1], f[:, 1:2], f[:, 2:3]
    out = 0
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (fr if dr else 1 - fr) * (fg if dg else 1 - fg) * (fb if db else 1 - fb)
                out = out + w * data[b0 + db, g0 + dg, r0 + dr]
    return out


# ----------------------------------------------------------------------------
# The library
# ----------------------------------------------------------------------------
def _read_index() -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_index(index: dict[str, dict[str, Any]]) -> None:
    LUTS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INDEX.with_name(f"{INDEX.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    replace_file(tmp, INDEX)


def catalog() -> list[dict[str, Any]]:
    """Every LUT the editor can offer: the ready-made looks first, then the user's."""
    items = [{"id": lid, "name": v[0], "category": v[1], "description": v[2], "kind": "builtin", "size": GRID,
              "swatches": _builtin_swatches(lid)} for lid, v in BUILTIN.items()]
    with _lock:
        index = _read_index()
    for lid, meta in sorted(index.items(), key=lambda kv: kv[1].get("created_at", "")):
        if (USER_DIR / f"{lid}.cube").exists():
            items.append({"id": lid, "name": meta.get("name", lid), "category": "Meus LUTs", "description": meta.get("description", ""),
                          "kind": "user", "size": meta.get("size"), "swatches": meta.get("swatches", [])})
    return items


def exists(lut_id: str) -> bool:
    return bool(lut_id) and (lut_id in BUILTIN or (bool(ID_RE.match(lut_id)) and (USER_DIR / f"{lut_id}.cube").exists()
                                                    and lut_id in _read_index()))


def path_of(lut_id: str) -> Path | None:
    """The .cube file of a LUT (a ready-made look is generated on the first request), or None."""
    if lut_id in BUILTIN:
        return _builtin_path(lut_id)
    if ID_RE.match(lut_id or "") and lut_id in _read_index() and (USER_DIR / f"{lut_id}.cube").exists():
        return USER_DIR / f"{lut_id}.cube"
    return None


def name_of(lut_id: str) -> str:
    if lut_id in BUILTIN:
        return BUILTIN[lut_id][0]
    return _read_index().get(lut_id, {}).get("name", lut_id)


def add(raw: bytes, filename: str) -> dict[str, Any]:
    """Validates and stores an uploaded .cube. Returns its catalog entry."""
    if len(raw) > MAX_BYTES:
        raise LutError(f"Arquivo grande demais (o limite é {MAX_BYTES // 1048576} MB).")
    if not (filename or "").lower().endswith(".cube"):
        raise LutError("Envie um arquivo .cube (LUT 3D).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    size, data = parse_cube(text)
    with _lock:
        index = _read_index()
        if len(index) >= MAX_ITEMS:
            raise LutError(f"Você já tem {MAX_ITEMS} LUTs enviados. Exclua algum antes de enviar outro.")
        lut_id = f"user_{uuid.uuid4().hex[:10]}"
        USER_DIR.mkdir(parents=True, exist_ok=True)
        path = USER_DIR / f"{lut_id}.cube"
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        tmp.write_bytes(raw)
        replace_file(tmp, path)
        title = re.search(r'^\s*TITLE\s+"?([^"\r\n]+)"?', text, re.M | re.I)
        base = re.sub(r"[_\-]+", " ", Path(filename).stem).strip()
        name = (base or (title.group(1).strip() if title else "LUT"))[:60]
        swatches = _rgb_to_hex(apply_cube(size, data, _hex_to_rgb(SWATCH_COLORS)))
        index[lut_id] = {"name": name, "size": size, "filename": Path(filename).name[:120], "swatches": swatches,
                         "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        _write_index(index)
    return {"id": lut_id, "name": name, "category": "Meus LUTs", "description": "", "kind": "user", "size": size, "swatches": swatches}


def remove(lut_id: str) -> str:
    """"deleted" | "missing" | "builtin"."""
    if lut_id in BUILTIN:
        return "builtin"
    with _lock:
        index = _read_index()
        if lut_id not in index or not ID_RE.match(lut_id):
            return "missing"
        (USER_DIR / f"{lut_id}.cube").unlink(missing_ok=True)
        index.pop(lut_id)
        _write_index(index)
    return "deleted"


# ----------------------------------------------------------------------------
# What an edit stores
# ----------------------------------------------------------------------------
DEFAULT_LUT: dict[str, Any] = {"id": "", "intensity": 1.0}


def sanitize_lut(raw: Any) -> dict[str, Any]:
    """{"id": "" (no LUT) or a library id, "intensity": 0..1}. The id is not checked against the library here:
    a template can outlive a LUT the user deleted, and the render then just skips it (see resolve)."""
    raw = raw if isinstance(raw, dict) else {}
    lut_id = str(raw.get("id") or "").strip()
    if not ID_RE.match(lut_id):
        lut_id = ""
    try:
        k = float(raw.get("intensity", 1.0))
    except (TypeError, ValueError):
        k = 1.0
    if k != k:
        k = 1.0
    return {"id": lut_id, "intensity": round(min(1.0, max(0.0, k)), 3)}


def resolve(raw: Any) -> dict[str, Any] | None:
    """The LUT to render: {"id", "name", "path", "intensity"}, or None when there is none (or it no longer exists)."""
    cfg = sanitize_lut(raw)
    if not cfg["id"] or cfg["intensity"] < 0.005:
        return None
    path = path_of(cfg["id"])
    if not path:
        return None
    return {"id": cfg["id"], "name": name_of(cfg["id"]), "path": path, "intensity": cfg["intensity"]}
