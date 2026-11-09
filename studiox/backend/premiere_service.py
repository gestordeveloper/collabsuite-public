"""Edits a video for the Adobe Premiere panel: cuts, transcript, AI review and captions, without rendering.

The panel sends the path of a file on this computer; this module runs the same steps as the editing queue
(analysis -> silence cuts -> transcription -> review) and hands back a cut list, an SRT on the cut timeline
and a Premiere-importable XML (xmeml). Premiere then does the editing itself.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote
from xml.sax.saxutils import escape

from backend import audio_timeline, projects, review_service
from backend.config import URL_BASE, PROJECTS_DIR
from backend.media_processor import auto_cut_silences, probe_display_size, probe_media
from backend.subtitles import build_cues, cues_to_srt, sanitize_style
from backend.transcriber import transcribe_video
from backend.transcript_review import apply_fixes

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mxf"}
JOBS: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()
_MAX_JOBS = 30


class PremiereError(Exception):
    pass


def _log(job: dict, text: str) -> None:
    job["logs"].append(text)
    del job["logs"][:-80]
    job["message"] = text


def _set(job: dict, progress: int, step: str) -> None:
    job["progress"] = progress
    job["step"] = step


def start(path: str, *, language: str = "pt", engine: str = "auto", auto_cut: bool = True,
          review: str = "auto", copy: str = "", strict_copy: bool = True, fix_words: bool = True,
          subtitles: dict | None = None, words_per_cue: int | None = None) -> str:
    """Creates the job and starts working on it in a thread; returns the job id."""
    src = Path(path)
    if not src.is_file():
        raise PremiereError(f"Arquivo não encontrado: {path}")
    if src.suffix.lower() not in VIDEO_EXTENSIONS:
        raise PremiereError(f"Formato não suportado ({src.suffix or 'sem extensão'}).")
    style_raw = dict(subtitles or {})
    if words_per_cue:
        style_raw["words_per_cue"] = words_per_cue
    job_id = f"pr_{uuid.uuid4().hex[:10]}"
    job = {"id": job_id, "status": "running", "step": "analyze", "progress": 1, "message": "Iniciando", "logs": [],
           "error": None, "result": None, "started_at": time.time(), "source": str(src)}
    with _LOCK:
        for old in sorted(JOBS, key=lambda k: JOBS[k]["started_at"])[:-_MAX_JOBS]:
            JOBS.pop(old, None)
        JOBS[job_id] = job
    opts = dict(language=language or "pt", engine=engine or "auto", auto_cut=auto_cut, review=review or "auto",
                copy=copy, strict_copy=strict_copy, fix_words=fix_words, style=sanitize_style(style_raw))
    threading.Thread(target=_run, args=(job, src, opts), daemon=True).start()
    return job_id


def get(job_id: str) -> dict | None:
    return JOBS.get(job_id)


def _import_source(src: Path) -> tuple[str, Path, str]:
    """Project folder + a copy (hard link when possible) of the video inside it."""
    pid = f"proj_{uuid.uuid4().hex[:8]}"
    pdir = PROJECTS_DIR / pid
    pdir.mkdir(parents=True, exist_ok=True)
    source_name = "source_" + re.sub(r"[^\w.\-]", "_", src.name)
    dest = pdir / source_name
    try:
        os.link(src, dest)
    except OSError:
        shutil.copy2(src, dest)
    return pid, dest, source_name


def _run(job: dict, src: Path, o: dict) -> None:
    try:
        _process(job, src, o)
    except Exception as exc:  # the panel shows the message; the console keeps the trace
        traceback.print_exc()
        job.update(status="error", error=str(exc)[-600:], message=f"Erro: {str(exc)[:160]}")
        _log(job, f"Erro: {str(exc)[:300]}")


def _process(job: dict, src: Path, o: dict) -> None:
    _log(job, "Lendo o vídeo…")
    pid, video, source_name = _import_source(src)
    job["project_id"] = pid
    pdir = PROJECTS_DIR / pid
    meta = probe_media(video)
    dw, dh = probe_display_size(video)
    meta.update(display_width=dw, display_height=dh)
    duration = float(meta["duration"])
    _set(job, 8, "cuts")

    # silence cuts ---------------------------------------------------------------------------------
    initial = auto_cut_silences(video) if o["auto_cut"] else []
    info = {"id": pid, "source_name": source_name, "meta": meta, "waveform": [], "thumbnails": [],
            "initial_cuts": initial, "timeline": audio_timeline.VERSION, "analyzed": True,
            "video_url": f"{URL_BASE}/api/projects/{pid}/video/{source_name}", "origin": "premiere", "origin_path": str(src)}
    projects.write_info(pid, info)
    if initial:
        clips = [{"start": c["start"], "end": c["end"], "beat": c.get("beat")} for c in initial]
        _log(job, f"{len(clips)} corte(s) por silêncio")
    else:
        clips = [{"start": 0.0, "end": duration, "beat": "CLIP 1"}]
        _log(job, "Vídeo inteiro, sem cortar silêncios")

    # transcription --------------------------------------------------------------------------------
    _set(job, 15, "transcribe")
    copy_text = review_service.clean_copy(o["copy"])
    mode = review_service.effective_mode(o["review"], None, bool(copy_text))
    tr_path = pdir / "edit" / "transcripts" / f"{source_name}.json"
    _log(job, f"Transcrevendo o áudio (motor: {o['engine']}, idioma: {o['language']})…")
    data = transcribe_video(video, tr_path, preferred_engine=o["engine"], language=o["language"])
    for note in data.get("notes") or []:
        _log(job, f"Transcrição: {note}")
    words: list[dict] = []
    warnings: list[str] = []
    if data.get("engine") == "fallback":
        tr_path.unlink(missing_ok=True)  # placeholder words must never become captions
        warnings.append("Nenhum motor de transcrição disponível: sem legendas e sem revisão. "
                        "Configure uma chave na tela Configurações do StudioX.")
        mode = "off"
    else:
        words = data.get("words", [])
        _log(job, f"{len(words)} palavras transcritas ({data.get('engine', '?')})")

    # review ---------------------------------------------------------------------------------------
    review_info: dict[str, Any] | None = None
    if mode != "off" and words:
        _set(job, 55, "review")
        label = "IA" if mode == "llm" else "regras locais"
        _log(job, f"Revisando a transcrição ({label}{', seguindo a copy' if copy_text else ''})…")
        res = review_service.review_words(
            words, mode=mode, language=o["language"], fix_words=o["fix_words"], copy=copy_text,
            strict_copy=o["strict_copy"], video_path=video, duration=duration, log=lambda m: _log(job, m))
        fixed = apply_fixes(tr_path, res["word_diff"], res["fixes"]) if res["fixes"] else 0
        if res["recommended_cuts"]:
            clips = [{"start": c["start"], "end": c["end"], "beat": c.get("beat")} for c in res["recommended_cuts"]]
        else:
            res["warnings"].append("A revisão não deixou nenhum trecho: mantive os cortes por silêncio.")
        warnings += res["warnings"]
        sm = res["summary"]
        review_info = {"engine": sm["engine"], "removed": sm["errors_found"], "retakes": sm["retakes"],
                       "stutters": sm["stutters"], "fillers": sm["fillers"], "fixes": fixed,
                       "time_saved_s": sm["time_saved_s"]}
        _log(job, f"Revisão: {sm['errors_found']} trecho(s) removido(s), {fixed} palavra(s) corrigida(s), "
                  f"{sm['time_saved_s']}s a menos")

    # captions on the cut timeline -----------------------------------------------------------------
    _set(job, 85, "captions")
    ranges = [{"source": source_name, "start": float(c["start"]), "end": float(c["end"])} for c in clips]
    cues = build_cues(ranges, pdir / "edit" / "transcripts", o["style"]) if words else []
    srt = cues_to_srt(cues) if cues else ""
    srt_path = pdir / "edit" / "premiere.srt"
    srt_path.parent.mkdir(parents=True, exist_ok=True)
    if srt:
        srt_path.write_text(srt, encoding="utf-8")

    fps_num, fps_den = _fps(video)
    xml = build_xmeml(src, clips, meta, (fps_num, fps_den), name=src.stem, rotation=_rotation(video))
    xml_path = pdir / "edit" / "premiere.xml"
    xml_path.write_text(xml, encoding="utf-8")

    total = round(sum(c["end"] - c["start"] for c in clips), 3)
    projects.update_state(pid, lambda s: s.__setitem__("premiere", {"clips": clips, "created_at": projects.now_iso()}))
    job["result"] = {
        "project_id": pid, "source": str(src), "fps": {"num": fps_num, "den": fps_den},
        "duration": duration, "total_duration": total, "width": meta.get("width"), "height": meta.get("height"),
        "clips": [{"start": round(float(c["start"]), 3), "end": round(float(c["end"]), 3), "beat": c.get("beat")}
                  for c in clips],
        "cues": [{"start": c.start, "end": c.end, "text": " ".join(w.text for w in c.words),
                  "words": [{"start": w.start, "end": w.end, "text": w.text} for w in c.words]} for c in cues],
        "files": {"xml": str(xml_path), "srt": str(srt_path) if srt else None},
        "review": review_info, "warnings": warnings,
    }
    _set(job, 100, "done")
    job.update(status="done", message="Concluído")
    _log(job, f"Concluído: {len(clips)} corte(s), {len(cues)} legenda(s), {total:.1f}s")


# ----------------------------------------------------------------------------
# Premiere XML (xmeml v4, "Final Cut Pro XML" which Premiere imports)
# ----------------------------------------------------------------------------
def _fps(video: Path) -> tuple[int, int]:
    """Frame rate as a fraction (30000/1001 for 29.97...)."""
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                              "stream=r_frame_rate", "-of", "csv=p=0", str(video)],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        num, _, den = out.partition("/")
        n, d = int(num), int(den or 1)
        if n > 0 and d > 0 and 1 <= n / d <= 240:
            return n, d
    except Exception:
        pass
    return 30, 1


def _rotation(video: Path) -> int:
    """Clockwise degrees (0/90/180/270) a player applies to the stored picture; phones save video sideways with a flag."""
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                              "stream_side_data=rotation:stream_tags=rotate", "-of", "json", str(video)],
                             capture_output=True, text=True, timeout=30).stdout
        stream = (json.loads(out).get("streams") or [{}])[0]
        angle = next((float(d["rotation"]) for d in stream.get("side_data_list") or [] if "rotation" in d), None)
        if angle is None and (stream.get("tags") or {}).get("rotate") is not None:
            angle = -float(stream["tags"]["rotate"])   # the old tag turns clockwise, the display matrix counterclockwise
        return int(round(-(angle or 0.0))) % 360
    except Exception:
        return 0


def _path_url(path: Path) -> str:
    return "file://localhost/" + quote(str(path.resolve()).replace("\\", "/"), safe="/:")


def build_xmeml(src: Path, clips: list[dict], meta: dict, fps: tuple[int, int], name: str = "StudioX",
                rotation: int = 0) -> str:
    num, den = fps
    ntsc = den != 1
    timebase = round(num / den)
    fr = lambda sec: int(round(sec * num / den))   # seconds -> frames
    # The file keeps its stored size; a phone video (stored 1920x1080, rotation flag) plays 1080x1920, which is the
    # sequence size. Premiere does not read the flag from an XML, so the clips get an explicit rotation.
    file_w, file_h = int(meta.get("width") or 1920), int(meta.get("height") or 1080)
    sideways = rotation in (90, 270)
    width, height = (file_h, file_w) if sideways else (file_w, file_h)
    angle = rotation - 360 if rotation > 180 else rotation   # Premiere Rotation param (clockwise), checked on a phone clip
    # Premiere first fits the stored 1920x1080 picture to the 1080-wide frame; after turning it, it must grow by file_w/file_h
    fit = round(100 * file_w / file_h, 2) if sideways else 100
    motion = ""
    if rotation:
        motion = ('<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory>'
                  '<effecttype>motion</effecttype><mediatype>video</mediatype>'
                  f'<parameter><parameterid>scale</parameterid><name>Scale</name><value>{fit}</value></parameter>'
                  f'<parameter><parameterid>rotation</parameterid><name>Rotation</name><value>{angle}</value></parameter>'
                  '</effect></filter>')
    dur_frames = fr(float(meta["duration"]))
    channels = int(meta.get("channels") or 2) if isinstance(meta.get("channels"), (int, float)) else 2
    rate = f"<rate><timebase>{timebase}</timebase><ntsc>{'TRUE' if ntsc else 'FALSE'}</ntsc></rate>"
    fname = escape(src.name)
    file_full = (
        f'<file id="file-1"><name>{fname}</name><pathurl>{escape(_path_url(src))}</pathurl>{rate}'
        f'<duration>{dur_frames}</duration>'
        f'<media><video><samplecharacteristics>{rate}<width>{file_w}</width><height>{file_h}</height>'
        f'</samplecharacteristics></video>'
        f'<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics>'
        f'<channelcount>{max(1, channels)}</channelcount></audio></media></file>'
    )

    # frame-aligned positions on the new timeline
    placed: list[tuple[int, int, int, int]] = []   # in, out (source frames), start, end (timeline frames)
    pos = 0
    for c in clips:
        a, b = fr(float(c["start"])), fr(float(c["end"]))
        if b <= a:
            continue
        placed.append((a, b, pos, pos + (b - a)))
        pos += b - a

    v_items, a_items = [], []
    n_aud = max(1, min(2, channels))
    for i, (a, b, s, e) in enumerate(placed, start=1):
        file_xml = file_full if i == 1 else '<file id="file-1"/>'
        links = "".join(f"<link><linkclipref>{ref}</linkclipref></link>"
                        for ref in [f"v-{i}"] + [f"a{k}-{i}" for k in range(1, n_aud + 1)])
        v_items.append(
            f'<clipitem id="v-{i}"><name>{fname}</name><enabled>TRUE</enabled><duration>{dur_frames}</duration>{rate}'
            f'<start>{s}</start><end>{e}</end><in>{a}</in><out>{b}</out>{file_xml}{motion}{links}</clipitem>')
        for k in range(1, n_aud + 1):
            a_items.append((k, (
                f'<clipitem id="a{k}-{i}" premiereChannelType="mono"><name>{fname}</name><enabled>TRUE</enabled>'
                f'<duration>{dur_frames}</duration>{rate}<start>{s}</start><end>{e}</end><in>{a}</in><out>{b}</out>'
                f'<file id="file-1"/><sourcetrack><mediatype>audio</mediatype><trackindex>{k}</trackindex></sourcetrack>'
                f'{links}</clipitem>')))
    audio_tracks = "".join(
        '<track>' + "".join(x for kk, x in a_items if kk == k) + '</track>' for k in range(1, n_aud + 1))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">'
        f'<sequence id="sequence-1"><name>{escape(name)} - StudioX</name><duration>{pos}</duration>{rate}'
        f'<media><video><format><samplecharacteristics>{rate}<width>{width}</width><height>{height}</height>'
        f'<pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>'
        f'<track>{"".join(v_items)}</track></video>'
        f'<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth>'
        f'<samplerate>48000</samplerate></samplecharacteristics></format>{audio_tracks}</audio></media>'
        '</sequence></xmeml>'
    )
