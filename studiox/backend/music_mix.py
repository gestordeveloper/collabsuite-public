"""Background music: layers of clips (cuts of library tracks) mixed under the speaker's voice.

The editor keeps the music in the editing state (`edit.music`); this module cleans it, turns it into a list of
clips on the OUTPUT timeline (after the cuts) and builds the ffmpeg audio filters. They go into the last render
pass (render_service.compose_final), which is the only place the audio is re-encoded.

Config
    enabled     master switch (off = the music is kept but not heard)
    ducking     {enabled, db}: the music gets `db` dB quieter while the speaker talks (sidechain compressor)
    tracks      up to MAX_TRACKS layers: {id, name, volume, muted, clips}
      clip      {id, audio_id, start, in, dur, volume, fade_in, fade_out}
                start = where it begins in the video, in = where it begins inside the song (the "cut"),
                dur = how long it plays

Loudness: every library track is measured once (LUFS) and brought to TARGET_LUFS before the faders, which is
the loudness the render gives the voice (render.py normalises to -14 LUFS). So volume 100% means "as loud as
the voice" whatever the song, and a layer at 20% sits about 14 dB under it.
"""
from __future__ import annotations

import math
from typing import Any, Callable

MAX_TRACKS = 4
MAX_CLIPS = 80              # per layer
MIN_CLIP_S = 0.1
MIN_FADE_S = 0.01           # de-click at every clip edge, even with the fades at 0
TARGET_LUFS = -14.0
NORM_RANGE_DB = (-24.0, 18.0)
SAMPLE_RATE = 48000

# Ducking: an 8:1 compressor keyed by the voice. The threshold is derived from the wanted reduction `db`, for a
# voice at DUCK_VOICE_DB; softer speech ducks less. DUCK_VOICE_DB is CALIBRATED, not the plain RMS of speech: on
# real speech normalised to -14 LUFS (window RMS median -14.9 dBFS) the compressor's detector reads about 4 dB
# hotter, and with -11 the reduction while talking measured 6.2 / 12.1 / 18.0 dB for db = 6 / 12 / 18.
DUCK_RATIO = 8.0
DUCK_VOICE_DB = -11.0
DUCK_ATTACK_MS = 20.0
DUCK_RELEASE_MS = 400.0
DUCK_MIN_DB, DUCK_MAX_DB, DUCK_DEFAULT_DB = 3.0, 24.0, 12.0

DEFAULT_LAYER_VOLUME = 0.2
DEFAULT_FADE_IN, DEFAULT_FADE_OUT = 0.4, 0.8


def constants() -> dict[str, float]:
    """What the browser preview needs to behave like the render (one source of truth)."""
    return {
        "target_lufs": TARGET_LUFS, "norm_min_db": NORM_RANGE_DB[0], "norm_max_db": NORM_RANGE_DB[1],
        "min_fade_s": MIN_FADE_S, "min_clip_s": MIN_CLIP_S, "max_tracks": MAX_TRACKS,
        "duck_ratio": DUCK_RATIO, "duck_voice_db": DUCK_VOICE_DB, "duck_attack_s": DUCK_ATTACK_MS / 1000,
        "duck_release_s": DUCK_RELEASE_MS / 1000, "duck_min_db": DUCK_MIN_DB, "duck_max_db": DUCK_MAX_DB,
        "duck_default_db": DUCK_DEFAULT_DB, "layer_volume": DEFAULT_LAYER_VOLUME,
        "fade_in": DEFAULT_FADE_IN, "fade_out": DEFAULT_FADE_OUT,
    }


def _f(raw: Any, default: float, lo: float, hi: float) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return default
    if v != v:
        return default
    return min(hi, max(lo, v))


def _id(raw: Any, limit: int = 40) -> str:
    text = str(raw).strip() if isinstance(raw, (str, int)) else ""
    return "".join(c for c in text if c.isalnum() or c in "_-")[:limit]


def sanitize_music(raw: Any) -> dict[str, Any]:
    """Whitelists and clamps the music config before it is stored or rendered."""
    raw = raw if isinstance(raw, dict) else {}
    duck = raw.get("ducking") if isinstance(raw.get("ducking"), dict) else {}
    tracks: list[dict[str, Any]] = []
    track_ids: set[str] = set()
    clip_ids: set[str] = set()
    for ti, t in enumerate((raw.get("tracks") or [])[:MAX_TRACKS]):
        if not isinstance(t, dict):
            continue
        tid = _id(t.get("id")) or f"t{ti + 1}"
        while tid in track_ids:
            tid += "x"
        track_ids.add(tid)
        clips: list[dict[str, Any]] = []
        for ci, c in enumerate((t.get("clips") or [])[:MAX_CLIPS]):
            if not isinstance(c, dict) or not _id(c.get("audio_id")):
                continue
            dur = _f(c.get("dur"), 0.0, 0.0, 36000.0)
            if dur < MIN_CLIP_S:
                continue
            cid = _id(c.get("id")) or f"c{ti + 1}_{ci + 1}"
            while cid in clip_ids:
                cid += "x"
            clip_ids.add(cid)
            clips.append({
                "id": cid, "audio_id": _id(c.get("audio_id")),
                "start": round(_f(c.get("start"), 0.0, 0.0, 36000.0), 3),
                "in": round(_f(c.get("in"), 0.0, 0.0, 36000.0), 3),
                "dur": round(dur, 3),
                "volume": round(_f(c.get("volume"), 1.0, 0.0, 2.0), 3),
                "fade_in": round(_f(c.get("fade_in"), DEFAULT_FADE_IN, 0.0, 60.0), 3),
                "fade_out": round(_f(c.get("fade_out"), DEFAULT_FADE_OUT, 0.0, 60.0), 3),
            })
        clips.sort(key=lambda c: c["start"])
        name = str(t.get("name") or "").strip()[:40] or f"Música {ti + 1}"
        tracks.append({"id": tid, "name": name, "volume": round(_f(t.get("volume"), DEFAULT_LAYER_VOLUME, 0.0, 1.5), 3),
                       "muted": bool(t.get("muted", False)), "clips": clips})
    return {
        "enabled": bool(raw.get("enabled", True)),
        "ducking": {"enabled": bool(duck.get("enabled", True)),
                    "db": round(_f(duck.get("db"), DUCK_DEFAULT_DB, DUCK_MIN_DB, DUCK_MAX_DB), 1)},
        "tracks": tracks,
    }


def remove_audio(music: Any, audio_id: str) -> dict[str, Any]:
    """The config without any clip of a deleted library track."""
    m = sanitize_music(music)
    for t in m["tracks"]:
        t["clips"] = [c for c in t["clips"] if c["audio_id"] != audio_id]
    return m


def used_audio_ids(music: Any) -> set[str]:
    return {c["audio_id"] for t in sanitize_music(music)["tracks"] for c in t["clips"]}


def is_audible(music: Any) -> bool:
    """True when the render has something to mix (used to decide if the last pass is needed)."""
    m = sanitize_music(music)
    return m["enabled"] and any(not t["muted"] and t["volume"] > 0 and any(c["volume"] > 0 for c in t["clips"]) for t in m["tracks"])


def norm_gain(lufs: float | None) -> float:
    """Linear gain that brings a track of `lufs` loudness to TARGET_LUFS (1.0 when it was never measured)."""
    if lufs is None or lufs != lufs or lufs in (math.inf, -math.inf):
        return 1.0
    db = min(NORM_RANGE_DB[1], max(NORM_RANGE_DB[0], TARGET_LUFS - float(lufs)))
    return 10 ** (db / 20)


def duck_threshold(db: float) -> float:
    """Compressor threshold (linear) that lowers a voice at DUCK_VOICE_DB by `db` dB."""
    reduction_per_db = 1 - 1 / DUCK_RATIO
    thr_db = DUCK_VOICE_DB - db / reduction_per_db
    return min(1.0, max(0.000976563, 10 ** (thr_db / 20)))


def plan(music: Any, total: float, lookup: dict[str, dict[str, Any]], log: Callable[[str], None] | None = None) -> dict[str, Any]:
    """The clips the render will mix: the config clamped to the real length of the video and of each song.

    `lookup` maps library id -> {"path": Path, "duration": float, "lufs": float | None, "name": str}.
    Returns {"clips": [...], "duck": {"db", "threshold"} | None}; problems go to `log` as warnings.
    """
    say = log or (lambda _m: None)
    cfg = sanitize_music(music)
    out: list[dict[str, Any]] = []
    if not cfg["enabled"] or total <= 0:
        return {"clips": out, "duck": None}
    for t in cfg["tracks"]:
        if t["muted"] or t["volume"] <= 0:
            continue
        for c in t["clips"]:
            if c["volume"] <= 0:
                continue
            audio = lookup.get(c["audio_id"])
            if not audio:
                say("Aviso: uma música da trilha não existe mais na biblioteca e foi ignorada.")
                continue
            name = audio.get("name") or c["audio_id"]
            if c["start"] >= total - MIN_CLIP_S:
                say(f"Aviso: “{name}” começa em {c['start']:.1f}s, depois do fim do vídeo ({total:.1f}s), e foi ignorada.")
                continue
            song = float(audio.get("duration") or 0.0)
            room = song - c["in"] if song > 0 else c["dur"]
            if room < MIN_CLIP_S:
                say(f"Aviso: o corte de “{name}” começa em {c['in']:.1f}s, depois do fim da música ({song:.1f}s), e foi ignorado.")
                continue
            dur = min(c["dur"], total - c["start"], room)
            if dur < c["dur"] - 0.05:
                why = "do fim do vídeo" if total - c["start"] <= min(room, c["dur"]) else "do fim da música"
                say(f"Aviso: “{name}” passava {why}; foi cortada em {dur:.1f}s.")
            fi, fo = c["fade_in"], c["fade_out"]
            if fi + fo > dur:                       # the two fades never overlap
                k = dur / (fi + fo)
                fi, fo = fi * k, fo * k
            out.append({
                "audio_id": c["audio_id"], "name": name, "path": audio["path"], "start": c["start"], "in": c["in"],
                "dur": round(dur, 3), "fade_in": round(fi, 3), "fade_out": round(fo, 3),
                "gain": c["volume"] * t["volume"] * norm_gain(audio.get("lufs")),
            })
    duck = None
    if out and cfg["ducking"]["enabled"]:
        db = cfg["ducking"]["db"]
        duck = {"db": db, "threshold": duck_threshold(db)}
    return {"clips": out, "duck": duck}


def build_graph(clips: list[dict[str, Any]], total: float, duck: dict[str, Any] | None, first_input: int,
                has_voice: bool) -> dict[str, Any]:
    """ffmpeg pieces that mix `clips` (from plan) with the voice, which is audio stream 0:a.

    Returns {"inputs": [...-i args], "parts": [filter chains], "last": "[aout]"}. The clip inputs take the input
    numbers first_input, first_input + 1, ... in the order of `clips`. The result is as long as the video.
    """
    inputs: list[str] = []
    parts: list[str] = []
    labels: list[str] = []
    for i, c in enumerate(clips):
        idx = first_input + i
        # -ss/-t before -i: only the part of the song that plays is decoded (accurate seek: the file is re-encoded)
        inputs += ["-ss", f"{c['in']:.3f}", "-t", f"{c['dur']:.3f}", "-i", str(c["path"])]
        fi, fo = max(c["fade_in"], MIN_FADE_S), max(c["fade_out"], MIN_FADE_S)
        chain = (f"[{idx}:a]aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
                 f"asetpts=PTS-STARTPTS,volume={c['gain']:.5f},afade=t=in:st=0:d={fi:.3f},"
                 f"afade=t=out:st={max(0.0, c['dur'] - fo):.3f}:d={fo:.3f}")
        delay = int(round(c["start"] * 1000))
        if delay > 0:
            chain += f",adelay={delay}:all=1"
        parts.append(f"{chain}[mc{i}]")
        labels.append(f"[mc{i}]")

    pad = f"apad=whole_dur={total:.3f}"    # music as long as the video, so no filter stops early
    if len(labels) == 1:
        parts.append(f"{labels[0]}{pad}[mus]")
    else:
        parts.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest:dropout_transition=0,{pad}[mus]")

    limiter = "alimiter=limit=0.97:level=0"    # level=0: only stops peaks, never raises the level
    if not has_voice:
        parts.append(f"[mus]{limiter}[aout]")
        return {"inputs": inputs, "parts": parts, "last": "[aout]"}

    parts.append(f"[0:a]aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[vo0]")
    music = "[mus]"
    voice = "[vo0]"
    if duck:
        parts.append("[vo0]asplit=2[vo][sc]")
        parts.append(f"[mus][sc]sidechaincompress=threshold={duck['threshold']:.5f}:ratio={DUCK_RATIO:g}:"
                     f"attack={DUCK_ATTACK_MS:g}:release={DUCK_RELEASE_MS:g}:knee=1:makeup=1[duck]")
        voice, music = "[vo]", "[duck]"
    parts.append(f"{voice}{music}amix=inputs=2:normalize=0:duration=first:dropout_transition=0,{limiter}[aout]")
    return {"inputs": inputs, "parts": parts, "last": "[aout]"}
