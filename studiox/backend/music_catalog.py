"""Free-music catalogs: search them and copy a track into the library (backend/music_library.py).

Only catalogs whose licence allows using a song in a video that is published (also monetised) are used, and the
licence of every track travels with it so the credit line can be copied when one is required:

  incompetech  Kevin MacLeod's ~1,400 tracks, filed by mood, genre and tempo. Creative Commons BY 4.0 (credit
               required). Official machine-readable catalog: incompetech.com/music/royalty-free/pieces.json.
  openverse    Openverse (WordPress) indexes Creative Commons audio of Jamendo, Freesound and Wikimedia. Only CC BY
               (credit required) and CC0 / public domain (no credit) are asked for: the "NonCommercial",
               "NoDerivatives" and "ShareAlike" licences are left out, because a song laid under a video counts as
               an adaptation and they would either forbid it or force the video to take the same licence.

What this is NOT: TikTok's own sound library (its Commercial Music Library) can only be used inside TikTok and
cannot be downloaded, so it cannot be mixed into a file rendered here.
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
from urllib.parse import quote, urljoin, urlparse

import requests

from backend import music_library
from backend.config import MUSIC_DIR
from backend.music_library import MusicError

USER_AGENT = "StudioX/1.0 (video editor; searching Creative Commons music)"
INCOMPETECH_BASE = (os.environ.get("MUSIC_INCOMPETECH_BASE") or "https://incompetech.com/music/royalty-free").rstrip("/")
OPENVERSE_BASE = (os.environ.get("MUSIC_OPENVERSE_BASE") or "https://api.openverse.org/v1").rstrip("/")
CATALOG_TTL_S = 7 * 24 * 3600
SEARCH_TTL_S = 10 * 60
PAGE_SIZE = 20
MIN_OPENVERSE_S = 25.0          # shorter CC0 results are sound effects, not music beds
DOWNLOAD_TIMEOUT_S = 240
# the servers a download may come from (the URL is read from the provider's answer, never from the browser)
ALLOWED_HOSTS = ("incompetech.com", "jamendo.com", "freesound.org", "wikimedia.org")
if os.environ.get("MUSIC_ALLOW_HOST"):            # tests point the catalogs at a local fake
    ALLOWED_HOSTS += (os.environ["MUSIC_ALLOW_HOST"],)

PROVIDERS = [
    {"id": "incompetech", "name": "Kevin MacLeod (Incompetech)", "credit": True,
     "note": "~1.400 músicas por clima e estilo. Licença CC BY 4.0: cole o crédito na legenda do vídeo."},
    {"id": "openverse", "name": "Comunidade (Jamendo, Freesound…)", "credit": None,
     "note": "Catálogo aberto (Openverse). Só licenças que permitem uso comercial e em vídeo."},
]

# what people type in Portuguese -> the moods/words the catalogs use
SYNONYMS = {
    "calma": ["calming", "calm", "relaxed", "ambient"], "calmo": ["calming", "calm", "relaxed"], "relaxante": ["relaxed", "calming"],
    "triste": ["somber", "sad"], "melancolica": ["somber"], "epica": ["epic", "cinematic"], "epico": ["epic", "cinematic"],
    "feliz": ["bright", "uplifting", "happy"], "alegre": ["bright", "bouncy", "happy"], "animada": ["bouncy", "upbeat", "uplifting"],
    "animado": ["bouncy", "upbeat", "uplifting"], "energetica": ["driving", "intense", "upbeat"], "energetico": ["driving", "intense", "upbeat"],
    "escura": ["dark"], "escuro": ["dark"], "misteriosa": ["mysterious"], "misterio": ["mysterious"], "suspense": ["suspenseful"],
    "acao": ["action", "driving"], "agressiva": ["aggressive", "intense"], "divertida": ["humorous", "bouncy"], "engracada": ["humorous"],
    "tensa": ["intense", "suspenseful"], "terror": ["eerie", "horror"], "romantica": ["romantic", "calming"], "inspiradora": ["uplifting"],
    "motivacional": ["uplifting", "driving"], "eletronica": ["electronic", "electronica"], "rock": ["rock"], "jazz": ["jazz"],
    "classica": ["classical"], "piano": ["piano"], "guitarra": ["guitar"], "batida": ["drums", "grooving"], "corporativa": ["corporate"],
}


class CatalogError(Exception):
    """The catalog could not answer (offline, rate limit...); the message is shown as is."""


_lock = threading.Lock()
_inflight: set[str] = set()
_search_cache: dict[str, tuple[float, dict]] = {}


def _norm(text: str) -> str:
    text = (text or "").lower()
    for a, b in (("áàâãä", "a"), ("éèêë", "e"), ("íìîï", "i"), ("óòôõö", "o"), ("úùûü", "u"), ("ç", "c")):
        text = re.sub(f"[{a}]", b, text)
    return text


def _get(url: str, **kw: Any) -> requests.Response:
    try:
        return requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=kw.pop("timeout", 20), **kw)
    except requests.RequestException as exc:
        raise CatalogError("Não consegui acessar o catálogo de músicas. Confira a conexão com a internet e tente de novo.") from exc


# ----------------------------------------------------------------------------
# Incompetech (Kevin MacLeod)
# ----------------------------------------------------------------------------
_inc_lock = threading.Lock()
_inc_memory: dict[str, Any] = {}


def _seconds(text: str) -> float:
    """'00:05:07' -> 307.0"""
    try:
        parts = [float(x) for x in (text or "").split(":")]
    except ValueError:
        return 0.0
    return sum(v * 60 ** i for i, v in enumerate(reversed(parts)))


def _clean(text: Any, limit: int = 300) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


def _incompetech_catalog() -> dict[str, Any]:
    """The whole catalog (normalised), cached on disk for a week and in memory."""
    cache_file = MUSIC_DIR / "catalog_incompetech.json"
    with _inc_lock:
        cached = _inc_memory.get("data")
        if not cached:
            try:
                cached = json.loads(cache_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                cached = None
        if cached and time.time() - float(cached.get("fetched_at") or 0) < CATALOG_TTL_S:
            _inc_memory["data"] = cached
            return cached
        try:
            pieces = _get(f"{INCOMPETECH_BASE}/pieces.json", timeout=40)
            genres = _get(f"{INCOMPETECH_BASE}/genre.json")
            pieces.raise_for_status()
            genre_map = {str(g.get("id")): _clean(g.get("genre"), 40) for g in (genres.json() if genres.ok else []) if isinstance(g, dict)}
            items = []
            for p in pieces.json():
                fname = _clean(p.get("filename"), 200)
                title = _clean(p.get("title"), 120)
                if not fname or not title:
                    continue
                feel = [f.strip() for f in _clean(p.get("feel"), 200).split(",") if f.strip()]
                try:
                    bpm = int(p.get("bpm") or 0) or None
                except (TypeError, ValueError):
                    bpm = None
                items.append({"key": fname, "title": title, "duration": round(_seconds(str(p.get("length") or "")), 1), "bpm": bpm,
                              "genre": genre_map.get(str(p.get("genre")), ""), "feel": feel,
                              "instruments": _clean(p.get("instruments"), 160), "description": _clean(p.get("description"), 240),
                              "uploaded": _clean(p.get("uploaded"), 10)})
            if not items:
                raise CatalogError("O catálogo do Kevin MacLeod veio vazio.")
            cached = {"fetched_at": time.time(), "items": items}
            try:
                MUSIC_DIR.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass                         # the catalog still works from memory
        except (CatalogError, requests.RequestException, ValueError) as exc:
            if cached:                       # offline: an old copy is better than nothing
                _inc_memory["data"] = cached
                return cached
            if isinstance(exc, CatalogError):
                raise
            raise CatalogError("Não consegui baixar o catálogo do Kevin MacLeod.") from exc
        _inc_memory["data"] = cached
        return cached


def _incompetech_item(p: dict[str, Any]) -> dict[str, Any]:
    url = f"{INCOMPETECH_BASE}/mp3-royaltyfree/{quote(p['key'])}"
    return {"provider": "incompetech", "key": p["key"], "title": p["title"], "artist": "Kevin MacLeod", "duration": p["duration"],
            "bpm": p["bpm"], "tags": p["feel"], "genre": p["genre"], "instruments": p["instruments"], "description": p["description"],
            "license": "CC BY 4.0", "credit_required": True, "preview_url": url, "download_url": url,
            "landing_url": "https://incompetech.com/music/royalty-free/music.html"}


def _incompetech_attribution(title: str) -> str:
    return (f"“{title}” Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\n"
            "http://creativecommons.org/licenses/by/4.0/")


def _tokens(q: str) -> list[list[str]]:
    """Each word of the query as the list of things that satisfy it (the word itself and its synonyms)."""
    out = []
    for w in re.findall(r"[\w#+]+", _norm(q)):
        out.append([w] + SYNONYMS.get(w, []))
    return out


def search_incompetech(q: str = "", mood: str = "", genre: str = "", min_s: float = 0, max_s: float = 0, page: int = 1) -> dict[str, Any]:
    cat = _incompetech_catalog()["items"]
    toks = _tokens(q)
    mood_n, genre_n = _norm(mood), _norm(genre)
    rows = []
    for p in cat:
        if mood_n and mood_n not in {_norm(f) for f in p["feel"]}:
            continue
        if genre_n and _norm(p["genre"]) != genre_n:
            continue
        if min_s and p["duration"] < min_s:
            continue
        if max_s and p["duration"] > max_s:
            continue
        score = 0
        if toks:
            title = _norm(p["title"])
            hay = _norm(" ".join([p["title"], p["genre"], " ".join(p["feel"]), p["instruments"], p["description"]]))
            for alts in toks:
                hit = [a for a in alts if a in hay]
                if not hit:
                    score = -1
                    break
                score += 3 if any(a in title for a in hit) else 1
            if score < 0:
                continue
        rows.append((score, p))
    if toks:
        rows.sort(key=lambda r: (-r[0], r[1]["title"]))              # title matches first
    else:
        rows.sort(key=lambda r: r[1]["uploaded"], reverse=True)     # newest first when just browsing
    page = max(1, page)
    chunk = rows[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    moods: dict[str, int] = {}
    genres: dict[str, int] = {}
    for p in cat:
        for f in p["feel"]:
            moods[f] = moods.get(f, 0) + 1
        if p["genre"]:
            genres[p["genre"]] = genres.get(p["genre"], 0) + 1
    return {
        "provider": "incompetech", "total": len(rows), "page": page, "page_size": PAGE_SIZE,
        "has_more": page * PAGE_SIZE < len(rows), "results": [_incompetech_item(p) for _, p in chunk],
        "facets": {"moods": sorted(moods, key=lambda k: -moods[k]), "genres": sorted(genres, key=lambda k: -genres[k])},
    }


# ----------------------------------------------------------------------------
# Openverse (Jamendo, Freesound, Wikimedia Commons)
# ----------------------------------------------------------------------------
LICENSE_NAMES = {"by": "CC BY", "cc0": "CC0", "pdm": "Domínio público"}


def _openverse_item(r: dict[str, Any]) -> dict[str, Any] | None:
    url = r.get("url") or ""
    dur = (r.get("duration") or 0) / 1000
    lic = str(r.get("license") or "").lower()
    if not url or lic not in LICENSE_NAMES or not _host_allowed(url):
        return None      # only what can be imported is listed: a known licence on a known server
    version = r.get("license_version") or ""
    name = LICENSE_NAMES[lic] + (f" {version}" if lic == "by" and version else "")
    title = re.sub(r"\.(wav|mp3|flac|ogg|oga|opus|m4a|aac|aif|aiff)$", "", _clean(r.get("title"), 120), flags=re.I).strip()
    return {"provider": "openverse", "key": r.get("id"), "title": title or "Sem título",
            "artist": _clean(r.get("creator"), 80), "duration": round(dur, 1), "bpm": None,
            "tags": [t.get("name") for t in (r.get("tags") or []) if isinstance(t, dict) and t.get("name")][:6],
            "genre": ", ".join(r.get("genres") or [])[:60], "instruments": "", "description": "",
            "license": name, "credit_required": lic == "by", "preview_url": url, "download_url": url,
            "landing_url": r.get("foreign_landing_url") or "", "source": r.get("source") or ""}


def _openverse_get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    resp = _get(f"{OPENVERSE_BASE}{path}", params=params, timeout=25)
    if resp.status_code == 429:
        raise CatalogError("O catálogo da comunidade limita as buscas sem cadastro (20 por minuto, 200 por dia). "
                           "Espere um pouco ou use o catálogo do Kevin MacLeod.")
    if resp.status_code == 404:
        raise CatalogError("Essa música não está mais no catálogo.")
    if not resp.ok:
        raise CatalogError(f"O catálogo da comunidade respondeu com erro ({resp.status_code}). Tente de novo em instantes.")
    try:
        return resp.json()
    except ValueError as exc:
        raise CatalogError("O catálogo da comunidade respondeu algo ilegível.") from exc


def search_openverse(q: str = "", mode: str = "credit", page: int = 1) -> dict[str, Any]:
    """mode 'credit' = songs that need a credit line (Jamendo, CC BY); 'free' = no credit needed (CC0 / public domain)."""
    page = max(1, page)
    terms = " ".join(dict.fromkeys(w for word in _tokens(q) for w in word[:2])) if q.strip() else ""
    params: dict[str, Any] = {"page": page, "page_size": PAGE_SIZE}
    if terms:
        params["q"] = terms
    if mode == "free":
        params["license"] = "cc0,pdm"
        params.setdefault("q", "music")
    else:
        params["license"] = "by"
        params["category"] = "music"
    key = json.dumps(params, sort_keys=True)
    hit = _search_cache.get(key)
    if hit and time.time() - hit[0] < SEARCH_TTL_S:
        return hit[1]
    data = _openverse_get("/audio/", params)
    results = []
    for r in data.get("results") or []:
        item = _openverse_item(r)
        if item and (mode != "free" or item["duration"] >= MIN_OPENVERSE_S):
            results.append(item)
    out = {"provider": "openverse", "total": int(data.get("result_count") or 0), "page": page, "page_size": PAGE_SIZE,
           "has_more": page < int(data.get("page_count") or 0), "results": results, "facets": None, "mode": mode}
    _search_cache[key] = (time.time(), out)
    if len(_search_cache) > 200:
        _search_cache.pop(next(iter(_search_cache)))
    return out


def search(provider: str, **kw: Any) -> dict[str, Any]:
    if provider == "incompetech":
        return search_incompetech(kw.get("q", ""), kw.get("mood", ""), kw.get("genre", ""), float(kw.get("min_s") or 0),
                                  float(kw.get("max_s") or 0), int(kw.get("page") or 1))
    if provider == "openverse":
        return search_openverse(kw.get("q", ""), kw.get("mode", "credit"), int(kw.get("page") or 1))
    raise CatalogError("Catálogo desconhecido.")


# ----------------------------------------------------------------------------
# Import into the library
# ----------------------------------------------------------------------------
def _host_allowed(url: str) -> bool:
    u = urlparse(url)
    host = (u.hostname or "").lower()
    ok_scheme = u.scheme == "https" or (u.scheme == "http" and bool(os.environ.get("MUSIC_ALLOW_HOST")))
    return ok_scheme and any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS)


def _extension(content_type: str, url: str, provider: str) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    by_type = {"audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/ogg": ".ogg", "application/ogg": ".ogg", "audio/wav": ".wav",
               "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/flac": ".flac", "audio/x-flac": ".flac", "audio/mp4": ".m4a",
               "audio/aac": ".aac", "audio/x-m4a": ".m4a"}
    if ct in by_type:
        return by_type[ct]
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in music_library.AUDIO_EXT:
        return suffix
    return ".mp3" if provider in ("incompetech", "openverse") else ""


def _open_stream(url: str) -> requests.Response:
    """GET with the redirects followed by hand: every hop is checked BEFORE connecting to it, so a server that
    redirects somewhere else (another site, this very computer) is never followed."""
    for _ in range(5):
        if not _host_allowed(url):
            raise CatalogError("O endereço do arquivo não é de um servidor conhecido do catálogo.")
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, stream=True, timeout=(10, 30), allow_redirects=False)
        if resp.status_code in (301, 302, 303, 307, 308):
            target = urljoin(url, resp.headers.get("Location", ""))
            resp.close()
            if not _host_allowed(target):
                raise CatalogError("O download foi redirecionado para um servidor desconhecido.")
            url = target
            continue
        return resp
    raise CatalogError("O servidor da música redirecionou demais.")


def _download(url: str, provider: str) -> Path:
    music_library.FILES_DIR.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + DOWNLOAD_TIMEOUT_S
    tmp: Path | None = None
    try:
        with _open_stream(url) as resp:
            if not resp.ok:
                raise CatalogError(f"O servidor da música respondeu com erro ({resp.status_code}).")
            ext = _extension(resp.headers.get("Content-Type", ""), resp.url, provider)
            if ext not in music_library.AUDIO_EXT:
                raise CatalogError("O servidor não devolveu um arquivo de áudio.")
            tmp = music_library.FILES_DIR / f"dl_{uuid.uuid4().hex[:8]}{ext}"
            written = 0
            with open(tmp, "wb") as out:
                for chunk in resp.iter_content(256 * 1024):
                    written += len(chunk)
                    if written > music_library.MAX_BYTES:
                        raise CatalogError("O arquivo é grande demais.")
                    if time.time() > deadline:
                        raise CatalogError("O download demorou demais. Tente de novo.")
                    out.write(chunk)
        return tmp
    except requests.RequestException as exc:
        if tmp:
            tmp.unlink(missing_ok=True)
        raise CatalogError("A conexão caiu durante o download da música. Tente de novo.") from exc
    except CatalogError:
        if tmp:
            tmp.unlink(missing_ok=True)
        raise


def import_track(provider: str, key: str) -> tuple[dict[str, Any], bool]:
    """Downloads a catalog track into the library. Returns (library item, already_there)."""
    key = (key or "").strip()
    if provider not in ("incompetech", "openverse") or not key or len(key) > 200:
        raise CatalogError("Música inválida.")
    source_key = f"{provider}:{key}"
    existing = music_library.find_by_source_key(source_key)
    if existing:
        return existing, True
    with _lock:
        if source_key in _inflight:
            raise CatalogError("Esta música já está sendo baixada.")
        _inflight.add(source_key)
    try:
        if provider == "incompetech":
            piece = next((p for p in _incompetech_catalog()["items"] if p["key"] == key), None)
            if not piece:
                raise CatalogError("Essa música não está mais no catálogo.")
            info = _incompetech_item(piece)
            attribution, license_url = _incompetech_attribution(info["title"]), "https://creativecommons.org/licenses/by/4.0/"
            origin = info["landing_url"]
        else:
            if not re.fullmatch(r"[0-9a-fA-F\-]{8,64}", key):
                raise CatalogError("Música inválida.")
            raw = _openverse_get(f"/audio/{key}/")
            if str(raw.get("license") or "").lower() not in LICENSE_NAMES:
                raise CatalogError("Essa música tem uma licença que não permite o uso em vídeo, então não foi importada.")
            info = _openverse_item(raw)
            if not info:
                raise CatalogError("O endereço do arquivo não é de um servidor conhecido do catálogo.")
            attribution = _clean(raw.get("attribution"), 500) or f"“{info['title']}” de {info['artist']} ({info['license']})"
            license_url = raw.get("license_url") or ""
            origin = info["landing_url"]
        tmp = _download(info["download_url"], provider)
        try:
            item = music_library.add(tmp, info["title"], source=provider, artist=info["artist"], license=info["license"],
                                     license_url=license_url, credit_required=info["credit_required"],
                                     attribution=attribution if info["credit_required"] else "", origin_url=origin, source_key=source_key)
        except MusicError as exc:
            raise CatalogError(str(exc)) from exc
        return item, False
    finally:
        with _lock:
            _inflight.discard(source_key)
