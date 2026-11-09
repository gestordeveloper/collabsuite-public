"""Google Fonts support: family catalog, on-demand TTF download and libass metrics.

The frontend previews fonts straight from the Google Fonts CDN, but the burned-in
subtitles are drawn by libass (ffmpeg), which needs real TTF files on disk. Google
serves static TTF instances when the CSS API is asked with a legacy User-Agent, so
each (family, weight, italic) is downloaded once and cached in storage/fonts/.
"""
from __future__ import annotations

import json
import os
import re
import struct
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

import requests

from backend.config import STORAGE_DIR

FONTS_DIR = STORAGE_DIR / "fonts"
FONTS_DIR.mkdir(parents=True, exist_ok=True)
CATALOG_PATH = FONTS_DIR / "catalog.json"
CATALOG_TTL_S = 7 * 24 * 3600

METADATA_URL = "https://fonts.google.com/metadata/fonts"
CSS_URL = "https://fonts.googleapis.com/css2"
# Any browser-like UA gets woff2, which libass can't read; a legacy one gets TTF.
LEGACY_UA = "Mozilla/4.0"

CATEGORY_SLUGS = {
    "Sans Serif": "sans-serif",
    "Serif": "serif",
    "Display": "display",
    "Handwriting": "handwriting",
    "Monospace": "monospace",
}

# Used only when the catalog can't be downloaded and there is no cached copy.
_FALLBACK_FAMILIES = [
    ("Roboto", "sans-serif"), ("Open Sans", "sans-serif"), ("Montserrat", "sans-serif"),
    ("Poppins", "sans-serif"), ("Inter", "sans-serif"), ("Lato", "sans-serif"),
    ("Oswald", "sans-serif"), ("Raleway", "sans-serif"), ("Nunito", "sans-serif"),
    ("Rubik", "sans-serif"), ("Barlow", "sans-serif"), ("Work Sans", "sans-serif"),
    ("Playfair Display", "serif"), ("Merriweather", "serif"), ("Lora", "serif"),
    ("Anton", "sans-serif"), ("Bebas Neue", "display"), ("Bangers", "display"),
    ("Permanent Marker", "handwriting"), ("Caveat", "handwriting"),
    ("Orbitron", "sans-serif"), ("Fira Code", "monospace"), ("JetBrains Mono", "monospace"),
]


class FontUnavailable(RuntimeError):
    """The requested family/weight/style could not be obtained from Google Fonts."""


@dataclass
class FontFile:
    path: Path
    ass_name: str        # name libass matches the file by (the font's full name)
    cell_factor: float   # libass cell height / em: ASS Fontsize per 1px of nominal size
    ascent_factor: float = 0.0  # libass first-baseline offset from the line top, / em


# ----------------------------------------------------------------------------
# Catalog
# ----------------------------------------------------------------------------
def _compact(meta: dict) -> list[dict]:
    out: list[dict] = []
    for fam in meta.get("familyMetadataList", []):
        styles = fam.get("fonts") or {}
        weights = sorted({int(k) for k in styles if k.isdigit()})
        italics = sorted({int(k[:-1]) for k in styles if k.endswith("i") and k[:-1].isdigit()})
        if not weights and not italics:
            continue
        out.append({
            "f": fam["family"],
            "c": CATEGORY_SLUGS.get(fam.get("category", ""), "sans-serif"),
            "w": weights,
            "i": italics,
            "p": int(fam.get("popularity", 99999)),
        })
    out.sort(key=lambda x: x["p"])
    return out


def _fallback_catalog() -> list[dict]:
    return [
        {"f": name, "c": cat, "w": [400, 700], "i": [], "p": i}
        for i, (name, cat) in enumerate(_FALLBACK_FAMILIES)
    ]


def _download_catalog() -> list[dict]:
    resp = requests.get(METADATA_URL, timeout=25)
    resp.raise_for_status()
    text = resp.text
    meta = json.loads(text[text.index("{"):])  # the endpoint may prefix an anti-XSSI guard
    fams = _compact(meta)
    if not fams:
        raise ValueError("catálogo vazio")
    return fams


def get_catalog(force: bool = False) -> dict:
    """Every Google Fonts family (~1900), most popular first. Cached for a week."""
    cached: list[dict] | None = None
    fresh = False
    if CATALOG_PATH.exists():
        try:
            cached = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
            fresh = (time.time() - CATALOG_PATH.stat().st_mtime) < CATALOG_TTL_S
        except Exception:
            cached = None

    if cached and fresh and not force:
        return {"fonts": cached, "count": len(cached), "source": "cache"}

    try:
        fams = _download_catalog()
        CATALOG_PATH.write_text(json.dumps(fams, ensure_ascii=False), encoding="utf-8")
        return {"fonts": fams, "count": len(fams), "source": "google"}
    except Exception as exc:
        print(f"[Fonts] Não foi possível baixar o catálogo do Google Fonts: {exc}")
        if cached:
            return {"fonts": cached, "count": len(cached), "source": "cache"}
        fams = _fallback_catalog()
        return {"fonts": fams, "count": len(fams), "source": "fallback"}


# ----------------------------------------------------------------------------
# TTF download + metrics
# ----------------------------------------------------------------------------
def _slug(family: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-") or "font"


def font_path(family: str, weight: int, italic: bool) -> Path:
    return FONTS_DIR / f"{_slug(family)}-{weight}{'i' if italic else ''}.ttf"


def _download_ttf(family: str, weight: int, italic: bool, dest: Path) -> None:
    fam = urllib.parse.quote_plus(family)
    url = f"{CSS_URL}?family={fam}:ital,wght@{1 if italic else 0},{weight}&display=swap"
    try:
        css = requests.get(url, headers={"User-Agent": LEGACY_UA}, timeout=25)
    except requests.RequestException as exc:
        raise FontUnavailable(f"sem conexão com o Google Fonts ({exc.__class__.__name__})") from exc
    if css.status_code != 200:
        style = f"{weight}{' itálico' if italic else ''}"
        raise FontUnavailable(f"'{family}' não tem o estilo {style} no Google Fonts")

    links = re.findall(r"url\((https://[^)]+?\.(?:ttf|otf))\)", css.text)
    if not links:
        raise FontUnavailable(f"o Google Fonts não devolveu um arquivo TTF para '{family}'")

    try:
        data = requests.get(links[0], timeout=60)
        data.raise_for_status()
    except requests.RequestException as exc:
        raise FontUnavailable(f"falha ao baixar '{family}' ({exc.__class__.__name__})") from exc

    tmp = dest.with_name(f"{dest.name}.{os.getpid()}.part")
    tmp.write_bytes(data.content)
    os.replace(tmp, dest)


def _read_name(data: bytes, table: tuple[int, int], name_id: int) -> str | None:
    off, _ln = table
    _fmt, count, str_off = struct.unpack(">HHH", data[off:off + 6])
    best: tuple[int, str] | None = None
    for i in range(count):
        plat, enc, lang, nid, length, s_off = struct.unpack(">HHHHHH", data[off + 6 + 12 * i: off + 18 + 12 * i])
        if nid != name_id:
            continue
        raw = data[off + str_off + s_off: off + str_off + s_off + length]
        if plat in (0, 3):
            text = raw.decode("utf-16-be", errors="ignore")
            rank = 2 if (plat == 3 and lang == 0x409) else 1
        else:
            text = raw.decode("mac_roman", errors="ignore")
            rank = 0
        if text and (best is None or rank > best[0]):
            best = (rank, text)
    return best[1] if best else None


def read_font_file(path: Path, fallback_name: str) -> FontFile:
    """Extracts the libass-relevant facts from a TTF: full name and cell height.

    libass sizes text so that ascent+descent (OS/2 usWin* metrics) equals Fontsize,
    while CSS sizes by the em square. cell_factor bridges the two so that "64 px"
    means the same glyph size in the browser preview and in the burned video.
    """
    data = path.read_bytes()
    if data[:4] == b"ttcf":
        raise FontUnavailable("coleções TTC não são suportadas")
    num_tables = struct.unpack(">H", data[4:6])[0]
    tables: dict[str, tuple[int, int]] = {}
    for i in range(num_tables):
        tag, _cs, off, ln = struct.unpack(">4sIII", data[12 + 16 * i: 28 + 16 * i])
        tables[tag.decode("latin-1")] = (off, ln)

    upem = struct.unpack(">H", data[tables["head"][0] + 18: tables["head"][0] + 20])[0] or 1000
    win_a = win_d = 0
    if "OS/2" in tables and tables["OS/2"][1] >= 78:
        o = tables["OS/2"][0]
        win_a, win_d = struct.unpack(">HH", data[o + 74: o + 78])
    if not (win_a + win_d) and "hhea" in tables:
        h = tables["hhea"][0]
        asc, desc = struct.unpack(">hh", data[h + 4: h + 8])
        win_a, win_d = asc, -desc
    cell = (win_a + win_d) / upem if (win_a + win_d) > 0 else 1.2

    name = None
    if "name" in tables:
        name = _read_name(data, tables["name"], 4)
    name = (name or fallback_name).replace(",", " ").strip()
    return FontFile(path=path, ass_name=name, cell_factor=cell, ascent_factor=win_a / upem)


def ensure_font(family: str, weight: int = 400, italic: bool = False) -> FontFile:
    """Returns the cached TTF for the style, downloading it from Google Fonts if needed."""
    family = (family or "").strip()
    if not family or len(family) > 100:
        raise FontUnavailable("nome de fonte inválido")
    weight = min(900, max(100, int(round(weight / 100)) * 100))

    path = font_path(family, weight, italic)
    if not path.exists():
        _download_ttf(family, weight, italic, path)
    try:
        return read_font_file(path, fallback_name=family)
    except FontUnavailable:
        raise
    except Exception as exc:
        path.unlink(missing_ok=True)  # corrupt download: don't keep it around
        raise FontUnavailable(f"arquivo de fonte inválido para '{family}' ({exc})") from exc
