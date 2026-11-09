"""One clock for the picture and the sound.

Phone recordings often have an audio stream that starts AFTER the video (measured on this app's own projects: the
audio's first sample plays 0.17 - 0.29 s into the video). ffmpeg writes such audio to a WAV starting at its first
sample, so everything computed from that WAV (the transcript, the speech/silence map, the waveform) sat 0.2 s
BEHIND the video's clock, while the cuts are made on the video's clock (`ffmpeg -ss`). Result: every cut ended
0.2 - 0.3 s before the last word finished (11 of 11 cut ends fell inside speech) and began ~0.3 s too early.

Everything that analyses the audio now goes through `filter_args`, which pads the start with the missing silence so
that time 0 of the WAV is time 0 of the video. `VERSION` marks data made on that clock; older transcripts are moved
onto it the first time they are read (`ensure_transcript`).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.config import ensure_ffmpeg
from backend.fsutil import replace_file

ensure_ffmpeg()

VERSION = 2               # 1 (or missing) = timed from the first audio sample; 2 = on the video's clock
MIN_LEAD_S = 0.005        # below this the two clocks are the same for every practical purpose


@lru_cache(maxsize=64)
def _probe(path: str, mtime_ns: int) -> tuple[float, int]:
    """(seconds the first audio sample comes after the start of the file, its sample rate)."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=start_time:stream=codec_type,start_time,sample_rate",
         "-of", "json", path], capture_output=True, text=True)
    try:
        data = json.loads(proc.stdout or "{}")
    except ValueError:
        return 0.0, 48000

    def num(v: Any) -> float | None:
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    streams = data.get("streams") or []
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not audio:
        return 0.0, 48000
    a_start = num(audio.get("start_time")) or 0.0
    origin = num((data.get("format") or {}).get("start_time"))
    if origin is None:
        origin = min([a_start] + [num(s.get("start_time")) or 0.0 for s in streams if s.get("codec_type") == "video"])
    rate = int(num(audio.get("sample_rate")) or 48000)
    return max(0.0, a_start - origin), rate


def lead_in(video: Path) -> float:
    """Seconds by which the audio starts after the video (0 when they start together or there is no audio)."""
    try:
        lead, _ = _probe(str(video), video.stat().st_mtime_ns)
    except OSError:
        return 0.0
    return lead if lead >= MIN_LEAD_S else 0.0


def filter_args(video: Path) -> list[str]:
    """ffmpeg arguments (`-af ...`) that pad the start of the audio so its time 0 is the video's time 0.
    Empty when the audio already starts with the video. Put them before `-ac` / `-ar` / the output."""
    try:
        lead, rate = _probe(str(video), video.stat().st_mtime_ns)
    except OSError:
        return []
    if lead < MIN_LEAD_S:
        return []
    return ["-af", f"adelay={round(lead * rate)}S:all=1"]


# ----------------------------------------------------------------------------
# Transcripts
# ----------------------------------------------------------------------------
def align_words(data: dict[str, Any], lead: float) -> None:
    """Moves every word of a transcript `lead` seconds later, in place, and marks it as on the video's clock."""
    if lead >= MIN_LEAD_S:
        for w in data.get("words") or []:
            if isinstance(w, dict):
                for key in ("start", "end"):
                    if isinstance(w.get(key), (int, float)):
                        w[key] = round(float(w[key]) + lead, 3)
    data["timeline"] = VERSION
    data["audio_lead_in_s"] = round(lead, 3)


def ensure_transcript(tr_path: Path, video: Path) -> dict[str, Any] | None:
    """The saved transcript on the video's clock (older ones are converted once and saved back). None if missing."""
    try:
        data = json.loads(tr_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or int(data.get("timeline") or 1) >= VERSION:
        return data if isinstance(data, dict) else None
    if data.get("engine") == "fallback":       # placeholder words ("Clip 1"...): nothing to move
        return data
    lead = lead_in(video)
    backup = tr_path.with_name(f"{tr_path.stem}.before-timeline-fix.json")
    if lead >= MIN_LEAD_S and not backup.exists():
        try:
            backup.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    align_words(data, lead)
    tmp = tr_path.with_name(f"{tr_path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        replace_file(tmp, tr_path)
    except OSError:
        tmp.unlink(missing_ok=True)
    return data


def edit_words(tr_path: Path, first: int, last: int, text: str) -> list[dict[str, Any]]:
    """Replaces the text of words[first..last] (inclusive) by `text`, keeping the timing; returns the new words list.

    Same number of words: each keeps its own start/end. Different number: the new words share the stretch the old ones
    covered, in proportion to their length. The original text is kept in `orig_text` of the first word touched."""
    data = json.loads(tr_path.read_text(encoding="utf-8"))
    words = data.get("words")
    if not isinstance(words, list) or not (0 <= first <= last < len(words)):
        raise ValueError("Trecho da transcrição inválido")
    old = words[first:last + 1]
    new_tokens = text.split()
    if not new_tokens:
        raise ValueError("A legenda não pode ficar vazia")
    orig = " ".join(str(w.get("orig_text", w.get("text", ""))) for w in old if w.get("type", "word") == "word")

    spoken = [w for w in old if w.get("type", "word") == "word"]
    if len(spoken) == len(new_tokens):
        it = iter(new_tokens)
        for w in spoken:
            w.setdefault("orig_text", w.get("text"))
            w["text"] = next(it)
        words[first:last + 1] = old
    else:
        start = float(old[0].get("start", 0.0))
        end = float(old[-1].get("end", start))
        weights = [max(1, len(re.sub(r"\W", "", t))) for t in new_tokens]
        total = float(sum(weights))
        span = max(end - start, 0.0)
        t0 = start
        made = []
        for tok, wgt in zip(new_tokens, weights):
            t1 = t0 + span * wgt / total
            made.append({"text": tok, "start": round(t0, 3), "end": round(t1, 3), "type": "word",
                         "speaker_id": old[0].get("speaker_id")})
            t0 = t1
        made[0]["orig_text"] = orig
        words[first:last + 1] = made
    tmp = tr_path.with_name(f"{tr_path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        replace_file(tmp, tr_path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise
    return words


def migrate_project(project_dir: Path, info: dict[str, Any], state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Brings an older project onto the video's clock: its transcripts, and its waveform (drawn from the audio, so it
    sat `lead` seconds ahead of the picture). Saved back to project_info.json once. When the saved cuts were made by
    an analysis of the old clock the returned info carries `timeline_notice` so the editor can say they must be redone."""
    video = project_dir / str(info.get("source_name") or "")
    if not video.is_file():
        return info
    ensure_project_transcripts(project_dir)
    lead = lead_in(video)
    if int(info.get("timeline") or 1) < VERSION:
        if lead >= MIN_LEAD_S:
            from backend.media_processor import extract_waveform
            samples = len(info.get("waveform") or []) or 800
            info["waveform"] = extract_waveform(video, num_samples=samples)
        info["timeline"] = VERSION
        info["audio_lead_in_s"] = round(lead, 3)
        path = project_dir / "project_info.json"
        tmp = path.with_name(f"project_info.json.{os.getpid()}.tmp")
        try:
            tmp.write_text(json.dumps(info), encoding="utf-8")
            replace_file(tmp, path)
        except OSError:
            tmp.unlink(missing_ok=True)
    if state is not None and lead >= MIN_LEAD_S and int(state.get("cuts_timeline") or 1) < VERSION:
        clips = ((state.get("edit") or {}).get("clips")) or []
        if any(str(c.get("beat") or "").upper().startswith("CORTE") for c in clips if isinstance(c, dict)):
            info["timeline_notice"] = {"lead_in_s": round(lead, 3)}
    return info


def ensure_project_transcripts(project_dir: Path) -> None:
    """Every transcript of a project on the video's clock (a no-op once they are)."""
    folder = project_dir / "edit" / "transcripts"
    if not folder.is_dir():
        return
    for path in folder.glob("*.json"):
        if path.name.endswith(".before-timeline-fix.json"):
            continue
        video = project_dir / path.stem          # transcripts are named <source file name>.json
        if video.exists():
            ensure_transcript(path, video)
