"""Automatic editing queue.

Every video in the queue is an ordinary saved project whose project_state.json carries a
`queue` block. A single background worker takes the oldest queued project and runs:

    analyze    probe, waveform, filmstrip, silence-based first cut list
    cuts       the template's cut mode (silence cuts or the whole take)
    transcribe word-level transcript (ElevenLabs Scribe / local Whisper), optional AI clean-up
    render     cuts + grade + headline + subtitles + loudness (the same render as the editor)

Each step is idempotent (analysis is skipped once done, an existing transcript is reused), so
"retry" after a failed render never pays for a second transcription. State lives on disk, so a
server restart puts interrupted items back in the queue instead of losing them.
"""
from __future__ import annotations

import base64
import json
import subprocess
import threading
import time
import traceback
from pathlib import Path
from typing import Any

from backend import audio_timeline, clip_extract, edit_templates, projects, review_service
from backend.config import PROJECTS_DIR, STORAGE_DIR
from backend.media_processor import (
    auto_cut_silences, extract_waveform, generate_thumbnails, probe_display_size, probe_media,
    render_size, thumbnail_count, waveform_sample_count,
)
from backend.render_service import JOBS, build_edl, run_render_job
from backend.subtitles import sanitize_style
from backend.transcriber import transcribe_video
from backend.transcript_review import apply_fixes

STEPS = ("analyze", "cuts", "transcribe", "review", "render")
STEP_LABELS = {"analyze": "Análise", "cuts": "Cortes", "transcribe": "Transcrição", "review": "Revisão IA", "render": "Render"}
RENDER_FROM = 67  # progress (%) at which the render step starts; it fills the rest of the bar
ACTIVE = ("awaiting", "queued", "running")
META_PATH = STORAGE_DIR / "queue_meta.json"
HEADLINE_PNG = "queue_headline.png"

_wake = threading.Event()
_worker: threading.Thread | None = None
_current: str | None = None
_meta_lock = threading.Lock()


class _Cancelled(Exception):
    pass


# ----------------------------------------------------------------------------
# State helpers
# ----------------------------------------------------------------------------
def _update(pid: str, **fields: Any) -> None:
    def mutate(state: dict) -> None:
        if state.get("queue") is not None:
            state["queue"].update(fields)
    projects.update_state(pid, mutate)


def _log(pid: str, text: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {text[:400]}"

    def mutate(state: dict) -> None:
        q = state.get("queue")
        if q is None:
            return
        q["logs"] = (q.get("logs") or [])[-79:] + [line]
        q["message"] = text[:200]
    projects.update_state(pid, mutate)


def _set_step(pid: str, step: str, status: str, progress: int | None = None) -> None:
    def mutate(state: dict) -> None:
        q = state.get("queue")
        if q is None:
            return
        q.setdefault("steps", {})[step] = status
        if status == "running":
            q["step"] = step
        if progress is not None:
            q["progress"] = progress
    projects.update_state(pid, mutate)


def _check_cancel(pid: str) -> None:
    q = projects.read_state(pid).get("queue") or {}
    if q.get("cancel_requested"):
        raise _Cancelled()


def _read_meta() -> dict:
    try:
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def is_paused() -> bool:
    return bool(_read_meta().get("paused"))


def set_paused(paused: bool) -> None:
    with _meta_lock:
        meta = _read_meta()
        meta["paused"] = bool(paused)
        META_PATH.write_text(json.dumps(meta), encoding="utf-8")
    _wake.set()


# ----------------------------------------------------------------------------
# Public API used by the routes
# ----------------------------------------------------------------------------
def enqueue(pid: str, template: dict, headline_text: str, headline_tag: str,
            headline_png: bytes | None, name: str | None = None, copy_text: str | None = None,
            strict_copy: bool = True) -> dict:
    """Puts an uploaded project in the queue with a snapshot of the template."""
    if not projects.exists(pid):
        raise projects.ProjectNotFound(pid)
    pdir = projects.project_dir(pid)
    (pdir / "edit").mkdir(exist_ok=True)
    png_path = pdir / "edit" / HEADLINE_PNG
    if headline_png:
        png_path.write_bytes(headline_png)
    else:
        png_path.unlink(missing_ok=True)

    def mutate(state: dict) -> None:
        if name and name.strip():
            state["name"] = name.strip()[:120]
        if copy_text is not None:
            state["copy"] = {"text": review_service.clean_copy(copy_text), "strict": bool(strict_copy)}
        state["queue"] = {
            "status": "queued",
            "step": None,
            "steps": {s: "pending" for s in STEPS},
            "progress": 0,
            "message": "Aguardando a vez na fila",
            "template_id": template["id"],
            "template_name": template["name"],
            "template": template,
            "headline_text": (headline_text or "")[:2000],
            "headline_tag": (headline_tag or "")[:80],
            "queued_at": time.time(),
            "started_at": None,
            "finished_at": None,
            "error": None,
            "cancel_requested": False,
            "attempts": 0,
            "logs": [f"{time.strftime('%H:%M:%S')} Adicionado à fila com o template “{template['name']}”"],
        }
    state = projects.update_state(pid, mutate)
    _wake.set()
    return state["queue"]


def cancel(pid: str) -> bool:
    ok = False

    def mutate(state: dict) -> None:
        nonlocal ok
        q = state.get("queue")
        if not q:
            return
        if q["status"] in ("queued", "awaiting"):
            q.update(status="cancelled", message="Cancelado", finished_at=time.time())
            ok = True
        elif q["status"] == "running":
            q.update(cancel_requested=True, message="Cancelando ao fim da etapa atual…")
            ok = True
    projects.update_state(pid, mutate)
    return ok


def retry(pid: str) -> bool:
    ok = False

    def mutate(state: dict) -> None:
        nonlocal ok
        q = state.get("queue")
        if not q or q["status"] not in ("error", "cancelled"):
            return
        steps = q.get("steps") or {}
        q.update(
            status="queued", step=None, error=None, cancel_requested=False, finished_at=None,
            queued_at=time.time(), attempts=q.get("attempts", 0) + 1, progress=0,
            message="Aguardando a vez na fila",
            steps={s: ("done" if steps.get(s) in ("done", "skipped", "warning") else "pending") for s in STEPS},
        )
        q["logs"] = (q.get("logs") or [])[-79:] + [f"{time.strftime('%H:%M:%S')} Nova tentativa"]
        ok = True
    projects.update_state(pid, mutate)
    if ok:
        _wake.set()
    return ok


def clear(pid: str) -> bool:
    """Takes a finished/failed/cancelled item off the queue view (the project stays saved)."""
    ok = False

    def mutate(state: dict) -> None:
        nonlocal ok
        q = state.get("queue")
        if q and q["status"] in ("done", "error", "cancelled", "awaiting"):
            state["queue"] = None
            ok = True
    projects.update_state(pid, mutate)
    return ok


def snapshot() -> dict:
    items = []
    for s in projects.list_projects():
        if not s.get("queue"):
            continue
        q = (projects.read_state(s["id"]).get("queue")) or {}
        items.append({
            "id": s["id"], "name": s["name"], "thumb_url": s["thumb_url"], "duration": s["duration"],
            "width": s["width"], "height": s["height"], "has_final": s["has_final"],
            "status": q.get("status"), "step": q.get("step"), "steps": q.get("steps"),
            "progress": q.get("progress", 0), "message": q.get("message"), "error": q.get("error"),
            "template_name": q.get("template_name"), "queued_at": q.get("queued_at"),
            "started_at": q.get("started_at"), "finished_at": q.get("finished_at"),
            "attempts": q.get("attempts", 0), "logs": (q.get("logs") or [])[-40:],
            "headline_text": q.get("headline_text"), "cancel_requested": q.get("cancel_requested", False),
            "review": q.get("review"),
        })
    order = {"running": 0, "queued": 1, "awaiting": 2, "error": 3, "cancelled": 4, "done": 5}

    def sort_key(item: dict) -> tuple:
        if item["status"] in ("queued", "running", "awaiting"):
            return (order.get(item["status"], 9), item["queued_at"] or 0)  # oldest first: it is the line
        return (order.get(item["status"], 9), -(item["finished_at"] or item["queued_at"] or 0))  # newest first
    items.sort(key=sort_key)
    return {"paused": is_paused(), "running": _current, "items": items}


# ----------------------------------------------------------------------------
# Worker
# ----------------------------------------------------------------------------
def start_worker() -> None:
    global _worker
    if _worker and _worker.is_alive():
        return
    _recover()
    _worker = threading.Thread(target=_loop, name="queue-worker", daemon=True)
    _worker.start()


def _recover() -> None:
    """Items that were running when the server stopped go back to the queue."""
    if not PROJECTS_DIR.exists():
        return
    for d in PROJECTS_DIR.iterdir():
        if not d.is_dir() or not projects.exists(d.name):
            continue
        q = projects.read_state(d.name).get("queue")
        if q and q.get("status") == "running":
            steps = q.get("steps") or {}
            _update(d.name, status="queued", step=None, cancel_requested=False, message="Retomado após reiniciar o servidor",
                    steps={s: ("done" if steps.get(s) in ("done", "skipped", "warning") else "pending") for s in STEPS})


def _next_queued() -> str | None:
    best: tuple[float, str] | None = None
    for d in PROJECTS_DIR.iterdir():
        if not d.is_dir() or not projects.ID_RE.match(d.name):
            continue
        try:
            q = projects.read_state(d.name).get("queue")
        except projects.ProjectNotFound:
            continue
        if q and q.get("status") == "queued":
            key = (float(q.get("queued_at") or 0), d.name)
            if best is None or key < best:
                best = key
    return best[1] if best else None


def _loop() -> None:
    global _current
    while True:
        pid = None
        try:
            if not is_paused():
                pid = _next_queued()
        except Exception:
            traceback.print_exc()
        if pid is None:
            _wake.wait(2.0)
            _wake.clear()
            continue
        _current = pid
        try:
            _process(pid)
        except Exception:  # never let one item kill the worker
            traceback.print_exc()
        finally:
            _current = None


class _LogList(list):
    """The render job appends its log lines here; mirror them into the queue item."""

    def __init__(self, pid: str):
        super().__init__()
        self._pid = pid

    def append(self, text: str) -> None:  # type: ignore[override]
        super().append(text)
        first = str(text).strip().splitlines()[0] if str(text).strip() else ""
        if first:
            _log(self._pid, first)


class _Job(dict):
    """render_service writes job['progress']; map 0..100 onto the render's share of the item."""

    def __init__(self, pid: str):
        super().__init__(id=f"queue_{pid}", status="pending", progress=0, logs=_LogList(pid))
        self._pid = pid

    def __setitem__(self, key: str, value: Any) -> None:
        super().__setitem__(key, value)
        if key == "progress":
            _update(self._pid, progress=RENDER_FROM + int(int(value) * (100 - RENDER_FROM) / 100))


def _review_mode(pipe: dict, pid: str, has_copy: bool) -> str:
    """off | local | llm, by the same rule the editor uses (review_service.effective_mode)."""
    wanted = pipe.get("ai_review", "off")
    mode = review_service.effective_mode(wanted, pipe.get("ai_provider") or None, has_copy)
    if wanted == "auto" and mode == "local":
        _log(pid, "Nenhuma IA configurada (tela Configurações): usei a análise local"
                  + (", guiada pela copy" if has_copy else ""))
    return mode


def _process(pid: str) -> None:
    state = projects.read_state(pid)
    q = state["queue"]
    tpl = q["template"]
    pipe = edit_templates.sanitize_pipeline(tpl["pipeline"])
    pdir = projects.project_dir(pid)

    _update(pid, status="running", started_at=time.time(), error=None, cancel_requested=False, progress=1)
    _log(pid, "Processamento iniciado")
    t0 = time.time()

    try:
        # 1. analyze --------------------------------------------------------
        info = projects.read_info(pid)
        video = pdir / info["source_name"]
        if info.get("clip_of") and not video.exists():
            # a clip picked from a long video: cut it (and its words) out of the long file first
            _set_step(pid, "analyze", "running", 2)
            clip_extract.prepare(pid, lambda m: _log(pid, m))
            info = projects.read_info(pid)
        if info.get("analyzed") is False:
            _set_step(pid, "analyze", "running", 2)
            _log(pid, "Analisando vídeo (metadados, forma de onda, miniaturas, silêncios)…")
            meta = probe_media(video)
            dw, dh = probe_display_size(video)
            meta.update(display_width=dw, display_height=dh)
            info["meta"] = meta
            info["waveform"] = extract_waveform(video, num_samples=waveform_sample_count(meta["duration"]))
            info["thumbnails"] = generate_thumbnails(
                video, pdir / "thumbs", count=thumbnail_count(meta["duration"]), duration=meta["duration"])
            info["initial_cuts"] = auto_cut_silences(video)
            info["timeline"] = audio_timeline.VERSION
            info["analyzed"] = True
            projects.write_info(pid, info)
        _set_step(pid, "analyze", "done", 20)
        _check_cancel(pid)

        # 2. cuts -----------------------------------------------------------
        _set_step(pid, "cuts", "running", 21)
        duration = float(info["meta"]["duration"])
        if pipe["auto_cut"] and info.get("initial_cuts"):
            clips = [{"start": c["start"], "end": c["end"], "beat": c.get("beat"), "source": info["source_name"]}
                     for c in info["initial_cuts"]]
            _log(pid, f"{len(clips)} corte(s) por silêncio")
        else:
            clips = [{"start": 0.0, "end": duration, "beat": "CLIP 1", "source": info["source_name"]}]
            _log(pid, "Vídeo inteiro, sem cortar silêncios")
        _set_step(pid, "cuts", "done", 25)
        _check_cancel(pid)

        # 3. transcribe -----------------------------------------------------
        subs_on = bool(tpl["subtitles"]["enabled"])
        copy_cfg = state.get("copy") or {}
        copy_text = review_service.clean_copy(copy_cfg.get("text"))
        strict_copy = bool(copy_cfg.get("strict", True))
        review_mode = _review_mode(pipe, pid, bool(copy_text))
        needs_words = pipe["transcribe"] and (subs_on or review_mode != "off")
        tr_path = pdir / "edit" / "transcripts" / f"{info['source_name']}.json"
        words: list[dict] = []
        if needs_words:
            _set_step(pid, "transcribe", "running", 26)
            if tr_path.exists():
                data = audio_timeline.ensure_transcript(tr_path, video) or {}
                _log(pid, "Transcrição existente reaproveitada")
            else:
                _log(pid, f"Transcrevendo o áudio (motor: {pipe['engine']}, idioma: {pipe['language']})…")
                data = transcribe_video(video, tr_path, preferred_engine=pipe["engine"], language=pipe["language"])
                for note in data.get("notes") or []:
                    _log(pid, f"Transcrição: {note}")
            if data.get("engine") == "fallback":
                tr_path.unlink(missing_ok=True)  # placeholder words ("Clip 1"...) must never become captions
                subs_on = False
                _set_step(pid, "transcribe", "warning", 55)
                _log(pid, "Nenhum motor de transcrição disponível: as legendas foram ignoradas")
            else:
                words = data.get("words", [])
                _log(pid, f"{len(words)} palavras transcritas ({data.get('engine', '?')})")
                _set_step(pid, "transcribe", "done", 55)
        else:
            _set_step(pid, "transcribe", "skipped", 55)
            if review_mode != "off" and tr_path.exists():  # a transcript from an earlier run can still be reviewed
                data = audio_timeline.ensure_transcript(tr_path, video) or {}
                if data.get("engine") != "fallback":
                    words = data.get("words", [])
        _check_cancel(pid)

        # 4. review: the AI validates the transcript, which decides the final cuts ---------------
        prev_review = (q.get("steps") or {}).get("review")
        saved_clips = ((state.get("edit") or {}).get("clips")) or []
        copy_sig = review_service.copy_signature(copy_text, strict_copy)
        same_copy = ((q.get("review") or {}).get("copy_sig") or "") == copy_sig
        # a review made before the audio/video clocks were aligned cut every clip ~0.2 s early: redo it (the transcript is kept)
        same_clock = int((q.get("review") or {}).get("timeline") or 1) >= audio_timeline.VERSION
        if review_mode != "off" and prev_review in ("done", "warning") and saved_clips and same_copy and same_clock:
            # a retry after a later failure: do not ask (and pay) the AI again
            clips = [{"start": c["start"], "end": c["end"], "beat": c.get("beat"), "source": info["source_name"]}
                     for c in saved_clips]
            _log(pid, "Revisão anterior reaproveitada")
            _set_step(pid, "review", prev_review, 65)
        elif review_mode != "off" and words:
            _set_step(pid, "review", "running", 56)
            label = "IA" if review_mode == "llm" else "regras locais"
            _log(pid, f"Revisando a transcrição ({label}{', seguindo a copy' if copy_text else ''}) "
                      "para cortar erros de gravação e retakes…")
            res = review_service.review_words(
                words, mode=review_mode, provider=pipe["ai_provider"] or None, model=pipe["ai_model"] or None,
                language=pipe["language"], fix_words=pipe["ai_fix_words"], copy=copy_text, strict_copy=strict_copy,
                video_path=video, duration=duration, log=lambda m: _log(pid, m),
            )
            fixed = apply_fixes(tr_path, res["word_diff"], res["fixes"]) if res["fixes"] else 0
            if res["recommended_cuts"]:
                clips = [{"start": c["start"], "end": c["end"], "beat": c.get("beat"), "source": info["source_name"]}
                         for c in res["recommended_cuts"]]
            else:
                res["warnings"].append("A revisão não deixou nenhum trecho: mantive os cortes por silêncio.")
                res["summary"]["time_saved_s"] = 0.0
                res["summary"]["errors_found"] = 0
                _log(pid, res["warnings"][-1])
            sm = res["summary"]
            _update(pid, review={
                "engine": sm["engine"], "model": sm.get("model"), "removed": sm["errors_found"], "retakes": sm["retakes"],
                "stutters": sm["stutters"], "fillers": sm["fillers"], "fixes": fixed, "time_saved_s": sm["time_saved_s"],
                "rule_cuts": sm.get("rule_cuts", 0), "verify_cuts": sm.get("verify_cuts", 0),
                "notes": sm.get("llm_notes") or "", "warnings": res["warnings"], "edges": sm["edges"],
                "script": sm.get("script"), "copy_sig": copy_sig, "timeline": audio_timeline.VERSION,
            })
            projects.update_state(pid, lambda s: s.__setitem__("cuts_timeline", audio_timeline.VERSION))
            _log(pid, f"Revisão concluída: {sm['errors_found']} trecho(s) removido(s), {fixed} palavra(s) corrigida(s), "
                      f"{sm['time_saved_s']}s a menos, {len(clips)} corte(s) com bordas ajustadas "
                      f"{'pelo áudio' if sm['edges'] == 'audio' else 'por margem fixa'}")
            _set_step(pid, "review", "warning" if (res["llm_failed"] or res["warnings"]) else "done", 65)
        else:
            _set_step(pid, "review", "skipped", 65)
        _check_cancel(pid)

        # Save the editing state now: even if the render fails the editor opens with the template applied
        head = dict(tpl["headline"])
        head["text"] = q.get("headline_text") or ""
        head["tag"] = q.get("headline_tag") or ""
        headline_on = bool(head["enabled"] and head["text"].strip())
        head["enabled"] = headline_on
        edit = projects.sanitize_edit({
            "clips": clips, "grade": tpl["grade"], "grade_adjust": tpl.get("grade_adjust"), "transition": tpl["transition"],
            "transition_scale": tpl.get("transition_scale"), "transition_sound": tpl.get("transition_sound"),
            "lut": tpl.get("lut"), "zoom": tpl.get("zoom"),
            "subtitles": {**tpl["subtitles"], "enabled": subs_on}, "headline": head,
        })
        projects.update_state(pid, lambda s: s.__setitem__("edit", edit))

        # 4. render ---------------------------------------------------------
        _set_step(pid, "render", "running", RENDER_FROM)
        headline_cfg = None
        png = pdir / "edit" / HEADLINE_PNG
        if headline_on:
            if png.exists():
                headline_cfg = {
                    "enabled": True,
                    "image": base64.b64encode(png.read_bytes()).decode(),
                    "start": edit["headline"]["start"], "duration": edit["headline"]["duration"],
                    "animation": edit["headline"]["style"]["animation"],
                    "anim_duration": edit["headline"]["style"]["anim_duration"],
                }
            else:
                _log(pid, "Aviso: headline sem imagem enviada pelo navegador; renderizando sem headline")

        edl = build_edl(pdir, info, clips, tpl["grade"], subs_on)
        job_id = f"queue_{pid}_{int(time.time())}"
        job = _Job(pid)
        JOBS[job_id] = job
        is_preview = pipe["render_mode"] == "preview"
        try:
            run_render_job(job_id, pdir, edl, edit["subtitles"]["style"], subs_on, headline_cfg, is_preview,
                           post={"grade": edit["grade"], "grade_adjust": edit["grade_adjust"], "split": edit["split"],
                                 "music": edit["music"], "lut": edit["lut"], "zoom": edit["zoom"],
                                 "transition": edit["transition"], "transition_scale": edit["transition_scale"],
                                 "transition_sound": edit["transition_sound"], "cut_transitions": edit["cut_transitions"],
                                 "canvas": edit.get("canvas")})
            if job["status"] != "completed":
                raise RuntimeError(str(job.get("error") or "falha no render")[-700:])
        finally:
            JOBS.pop(job_id, None)
        _set_step(pid, "render", "done", 100)

        _update(pid, status="done", step=None, progress=100, finished_at=time.time(), message="Concluído")
        _log(pid, f"Concluído em {int(time.time() - t0)}s")

    except _Cancelled:
        _update(pid, status="cancelled", step=None, finished_at=time.time(), message="Cancelado", cancel_requested=False)
        _log(pid, "Cancelado pelo usuário")
    except Exception as exc:
        traceback.print_exc()
        steps = (projects.read_state(pid).get("queue") or {}).get("steps") or {}
        cur = next((s for s, v in steps.items() if v == "running"), None)
        if cur:
            _set_step(pid, cur, "error")
        if isinstance(exc, subprocess.CalledProcessError) and str((exc.cmd or [""])[0]).startswith("ff"):
            text = "O FFmpeg não conseguiu processar este vídeo (o arquivo sumiu ou está corrompido?)"
        else:
            text = str(exc)
        _update(pid, status="error", finished_at=time.time(), error=text[-700:], message=f"Erro: {text[:160]}")
        _log(pid, f"Erro: {text[:300]}")
