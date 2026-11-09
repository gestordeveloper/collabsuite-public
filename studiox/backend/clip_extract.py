"""Turns a pick of a long recording into the source file of its own project.

A clip project starts as just a record (project_info.json with `clip_of`): nothing is cut yet, so choosing 30 clips
is instant. The queue worker calls `prepare` when it reaches the project: the clip is cut from the long video with
ffmpeg and the words of the long transcript that fall inside it are copied (shifted to start at 0), so the clip is
never transcribed again. From there it is an ordinary project.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Callable

from backend import audio_timeline, projects
from backend.config import ensure_ffmpeg
from backend.fsutil import replace_file

ensure_ffmpeg()

EDGE_SLACK_S = 0.08      # a word this close to the edge still belongs to the clip
MAX_LONG_SIDE = 1920     # a bigger source is scaled down: the render never uses more than this


def transcript_path(pid: str, source_name: str) -> Path:
    return projects.project_dir(pid) / "edit" / "transcripts" / f"{source_name}.json"


def extract_video(parent_video: Path, out: Path, start: float, end: float) -> None:
    """Frame-accurate cut re-encoded to H.264/AAC (a stream copy could only start on a keyframe)."""
    part = out.with_name(out.stem + ".part" + out.suffix)
    scale = f"scale='if(gt(iw,ih),min(iw,{MAX_LONG_SIDE}),-2)':'if(gt(iw,ih),-2,min(ih,{MAX_LONG_SIDE}))'"
    cmd = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(parent_video), "-t", f"{end - start:.3f}",
           "-map", "0:v:0", "-map", "0:a:0?", "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(part)]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        replace_file(part, out)
    finally:
        part.unlink(missing_ok=True)


def slice_transcript(parent_tr: Path, parent_video: Path, out_tr: Path, new_video: Path, start: float, end: float) -> int:
    """Writes the words inside [start, end] of the long transcript as the clip's transcript. Returns how many."""
    data = audio_timeline.ensure_transcript(parent_tr, parent_video)
    if not data or data.get("engine") == "fallback":
        return 0
    length = end - start
    words = []
    for w in data.get("words") or []:
        if not isinstance(w, dict) or w.get("type") not in (None, "word"):
            continue
        s, e = w.get("start"), w.get("end")
        if not isinstance(s, (int, float)) or not isinstance(e, (int, float)):
            continue
        if s >= start - EDGE_SLACK_S and e <= end + EDGE_SLACK_S:
            words.append({**w, "start": round(max(0.0, s - start), 3), "end": round(min(length, max(0.0, e - start)), 3)})
    out = {
        "text": " ".join(str(w.get("text", "")) for w in words),
        "words": words,
        "language": data.get("language"),
        "engine": data.get("engine"),
        "timeline": audio_timeline.VERSION,          # the words are already on the video's clock
        "audio_lead_in_s": round(audio_timeline.lead_in(new_video), 3),
        "sliced_from": {"start": round(start, 3), "end": round(end, 3)},
    }
    out_tr.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_tr.with_name(out_tr.name + ".tmp")
    tmp.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    replace_file(tmp, out_tr)
    return len(words)


def prepare(pid: str, log: Callable[[str], None]) -> bool:
    """Cuts the clip and its transcript when the project is a clip whose file does not exist yet. True if it did."""
    info = projects.read_info(pid)
    ref = info.get("clip_of")
    if not ref:
        return False
    pdir = projects.project_dir(pid)
    video = pdir / info["source_name"]
    if video.exists():
        return False
    if not projects.exists(ref["parent"]):
        raise RuntimeError("O vídeo longo de onde este corte sai foi apagado.")
    parent_info = projects.read_info(ref["parent"])
    parent_video = projects.project_dir(ref["parent"]) / parent_info["source_name"]
    if not parent_video.exists():
        raise RuntimeError("O arquivo do vídeo longo de onde este corte sai não existe mais.")
    start, end = float(ref["start"]), float(ref["end"])
    log(f"Cortando o trecho do vídeo longo ({_clock(start)} a {_clock(end)})…")
    extract_video(parent_video, video, start, end)
    n = slice_transcript(transcript_path(ref["parent"], parent_info["source_name"]), parent_video,
                         transcript_path(pid, info["source_name"]), video, start, end)
    log(f"Trecho pronto; {n} palavra(s) da transcrição copiadas" if n else "Trecho pronto (o vídeo longo não tinha transcrição)")
    return True


def _clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"
