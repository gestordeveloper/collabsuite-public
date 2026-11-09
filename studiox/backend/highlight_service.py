"""Cuts from a long video: the analysis job and the creation of the clip projects.

A long video is an ordinary saved project with a `highlights` block in project_state.json:
    status      idle | running | ready | error | cancelled
    stage       transcribe | audio | analyze
    progress    0..100, message, error, logs
    params      what the person asked for (highlights.clean_params)
    candidates  the picks (backend/highlights.py), each with `project_id` once turned into a project
    clips       [{project_id, cand_id, title, start, end}] every clip project made from this video

The analysis runs in its own thread, not in the editing queue: transcribing a two-hour recording must not wait for a
render, and the queue must not wait for it. Picking clips is free of cuts; the queue worker cuts each clip when it
reaches its project (backend/clip_extract.py).
"""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from typing import Any

from backend import audio_timeline, clip_extract, highlights, projects
from backend.config import URL_BASE, PROJECTS_DIR
from backend.cut_refine import load_speech_map
from backend.llm_anthropic import LLMError
from backend.media_processor import render_size
from backend.transcriber import transcribe_video

KEY = "highlights"
MAX_CLIPS_PER_BATCH = 200
MIN_CLIP_S = 3.0
MAX_CLIP_S = 900.0

_lock = threading.Lock()
_threads: dict[str, threading.Thread] = {}
_cancel: set[str] = set()


class Busy(Exception):
    pass


# ----------------------------------------------------------------------------
# State
# ----------------------------------------------------------------------------
def _block(state: dict) -> dict:
    return state.setdefault(KEY, {"status": "idle", "candidates": [], "clips": []})


def _update(pid: str, **fields: Any) -> None:
    def mutate(state: dict) -> None:
        _block(state).update(fields)
    projects.update_state(pid, mutate)


def _log(pid: str, text: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {text[:300]}"

    def mutate(state: dict) -> None:
        b = _block(state)
        b["logs"] = (b.get("logs") or [])[-59:] + [line]
        b["message"] = text[:200]
    projects.update_state(pid, mutate)


def is_running(pid: str) -> bool:
    t = _threads.get(pid)
    return bool(t and t.is_alive())


def public_block(state: dict) -> dict:
    b = dict(_block(state))
    b["logs"] = (b.get("logs") or [])[-30:]
    return b


def init_source(pid: str) -> None:
    """Marks a freshly uploaded project as a long video (it is not queued: it only feeds clips)."""
    projects.update_state(pid, lambda s: _block(s))


# ----------------------------------------------------------------------------
# Analysis
# ----------------------------------------------------------------------------
def start(pid: str, params: dict) -> dict:
    p = highlights.clean_params(params)
    with _lock:
        if is_running(pid):
            raise Busy()
        _cancel.discard(pid)
        info = projects.read_info(pid)
        reuse = clip_extract.transcript_path(pid, info["source_name"]).exists()   # the first stage is then skipped

        def mutate(state: dict) -> None:
            b = _block(state)
            b.update(status="running", stage="audio" if reuse else "transcribe", progress=1, message="Começando…", error=None, params=p,
                     logs=[], started_at=time.time(), finished_at=None, warnings=[], engine=None)
        projects.update_state(pid, mutate)
        t = threading.Thread(target=_run, args=(pid, p), name=f"highlights-{pid}", daemon=True)
        _threads[pid] = t
        t.start()
    return public_block(projects.read_state(pid))


def cancel(pid: str) -> bool:
    if not is_running(pid):
        return False
    _cancel.add(pid)
    _update(pid, message="Cancelando…")
    return True


def recover() -> None:
    """A job that was running when the server stopped is marked as interrupted (the transcript it made is kept)."""
    if not PROJECTS_DIR.exists():
        return
    for d in PROJECTS_DIR.iterdir():
        if not d.is_dir() or not projects.exists(d.name):
            continue
        b = projects.read_state(d.name).get(KEY)
        if b and b.get("status") == "running":
            _update(d.name, status="error", error="A análise foi interrompida porque o servidor reiniciou. "
                    "Analise de novo: a transcrição que já foi feita é reaproveitada.", message="Interrompida")


def _run(pid: str, p: dict) -> None:
    def cancelled() -> bool:
        return pid in _cancel

    try:
        info = projects.read_info(pid)
        pdir = projects.project_dir(pid)
        video = pdir / info["source_name"]
        duration = float((info.get("meta") or {}).get("duration") or 0)
        tr_path = clip_extract.transcript_path(pid, info["source_name"])

        data = audio_timeline.ensure_transcript(tr_path, video) if tr_path.exists() else None
        if data and data.get("engine") == "fallback":
            data = None
        if data is None:
            _update(pid, stage="transcribe", progress=3)
            _log(pid, f"Transcrevendo o áudio (motor: {p['engine']}, idioma: {p['language']}). Em vídeos longos isso leva alguns minutos…")
            data = transcribe_video(video, tr_path, preferred_engine=p["engine"], language=p["language"])
            for note in data.get("notes") or []:
                _log(pid, f"Transcrição: {note}")
            if data.get("engine") == "fallback":
                tr_path.unlink(missing_ok=True)
                raise RuntimeError("Nenhum motor de transcrição disponível. Salve a chave do ElevenLabs ou do Groq na tela Configurações.")
            _log(pid, f"{len(data.get('words') or [])} palavras transcritas ({data.get('engine', '?')})")
        else:
            _log(pid, "Transcrição existente reaproveitada")
        if cancelled():
            raise highlights.Cancelled()

        _update(pid, stage="audio", progress=35)
        _log(pid, "Analisando o áudio para achar onde a fala realmente começa e termina…")
        speech = load_speech_map(video)
        if cancelled():
            raise highlights.Cancelled()

        _update(pid, stage="analyze", progress=42)

        def progress(frac: float, message: str) -> None:
            _update(pid, progress=42 + int(frac * 56), message=message)

        result = highlights.find_highlights(data.get("words") or [], duration, p, speech=speech,
                                            log=lambda m: _log(pid, m), progress=progress, cancelled=cancelled)

        def mutate(state: dict) -> None:
            b = _block(state)
            for c in result["candidates"]:
                c["project_id"] = None
            b.update(status="ready", stage=None, progress=100, message=f"{len(result['candidates'])} corte(s) encontrados",
                     candidates=result["candidates"], warnings=result["warnings"], engine=result["engine"],
                     finished_at=time.time(), error=None)
        projects.update_state(pid, mutate)
    except highlights.Cancelled:
        _update(pid, status="cancelled", stage=None, message="Cancelado", finished_at=time.time())
    except LLMError as exc:
        _update(pid, status="error", stage=None, error=str(exc)[-500:], message=f"Erro: {str(exc)[:160]}", finished_at=time.time())
    except Exception as exc:  # never let a job die silently
        traceback.print_exc()
        _update(pid, status="error", stage=None, error=str(exc)[-500:], message=f"Erro: {str(exc)[:160]}", finished_at=time.time())
    finally:
        _cancel.discard(pid)


# ----------------------------------------------------------------------------
# Clip projects
# ----------------------------------------------------------------------------
def create_clips(pid: str, items: list[dict]) -> list[dict]:
    """One project per pick, waiting for its template (the browser draws the headline and enqueues each one)."""
    info = projects.read_info(pid)
    meta = info.get("meta") or {}
    duration = float(meta.get("duration") or 0)
    state = projects.read_state(pid)
    parent_name = projects.display_name(info, state)
    number = len((state.get(KEY) or {}).get("clips") or [])
    dw, dh = int(meta.get("display_width") or meta.get("width") or 0), int(meta.get("display_height") or meta.get("height") or 0)
    rw, rh = render_size(dw, dh)

    made = []
    for it in items[:MAX_CLIPS_PER_BATCH]:
        try:
            start, end = float(it.get("start")), float(it.get("end"))
        except (TypeError, ValueError):
            continue
        start = max(0.0, start)
        end = min(end, duration) if duration else end
        if not MIN_CLIP_S <= end - start <= MAX_CLIP_S:
            continue
        number += 1
        title = str(it.get("title") or "").strip()[:120]
        plain = title.replace("*", "")
        cid = f"clip_{uuid.uuid4().hex[:8]}"
        cdir = PROJECTS_DIR / cid
        cdir.mkdir(parents=True, exist_ok=True)
        source_name = f"source_{cid}.mp4"
        ref = {"parent": pid, "parent_name": parent_name, "cand_id": str(it.get("cand_id") or "")[:20],
               "start": round(start, 3), "end": round(end, 3), "score": it.get("score"), "title": title, "number": number}
        projects.write_info(cid, {
            "id": cid, "source_name": source_name, "meta": {**meta, "duration": round(end - start, 3), "size_mb": None},
            "waveform": [], "thumbnails": [], "initial_cuts": [], "analyzed": False, "clip_of": ref,
            "video_url": f"{URL_BASE}/api/projects/{cid}/video/{source_name}",
        })

        def mutate(s: dict, plain=plain, ref=ref, number=number) -> None:
            s["name"] = (f"Corte {number:02d} · {plain}" if plain else f"Corte {number:02d}")[:120]
            s["clip_of"] = ref
            s["queue"] = {"status": "awaiting", "steps": {k: "pending" for k in ("analyze", "cuts", "transcribe", "review", "render")},
                          "progress": 0, "message": "Trecho escolhido, aguardando o template", "logs": []}
        projects.update_state(cid, mutate)
        made.append({"project_id": cid, "cand_id": ref["cand_id"], "title": title, "tag": str(it.get("tag") or "").strip()[:40],
                     "name": projects.read_state(cid)["name"], "render_width": rw, "render_height": rh,
                     "start": ref["start"], "end": ref["end"]})

    def record(s: dict) -> None:
        b = _block(s)
        by_cand = {m["cand_id"]: m["project_id"] for m in made if m["cand_id"]}
        for c in b.get("candidates") or []:
            if c.get("id") in by_cand:
                c["project_id"] = by_cand[c["id"]]
        b["clips"] = (b.get("clips") or []) + [{k: m[k] for k in ("project_id", "cand_id", "title", "start", "end")} for m in made]
    if made:
        projects.update_state(pid, record)
    return made
