"""Sound effects for the cuts: a few ready-made sounds plus the ones the user uploads.

A cut can play a sound (whoosh, impact, glitch...) at the moment of the transition. The ready-made sounds are not
shipped as files: ffmpeg synthesises them (noise, sines and envelopes, so there is nothing to license) the first time
they are needed, into storage/sfx/builtin/. The user's own sounds live in storage/sfx/user/ with a small index.

Every sound has a `peak`: the second INSIDE the file where the "hit" lands (the end of a riser, the middle of a
whoosh). The render and the preview start the sound `peak` seconds before the cut (plus the user's `offset`), so the
hit coincides with the cut.
"""
from __future__ import annotations

import json
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from backend.config import STORAGE_DIR
from backend.fsutil import replace_file

SFX_DIR = STORAGE_DIR / "sfx"
BUILTIN_DIR = SFX_DIR / "builtin"
USER_DIR = SFX_DIR / "user"
INDEX = SFX_DIR / "library.json"

MAX_BYTES = 20 * 1024 * 1024
MAX_SECONDS = 15.0
MAX_ITEMS = 80
GENERATOR_VERSION = 1            # bump when a recipe changes: the cached files are rebuilt
SAMPLE_RATE = 44100
ALLOWED = {".wav", ".mp3", ".ogg", ".m4a", ".aac", ".flac", ".opus"}
ID_RE = re.compile(r"^[a-z0-9_]{1,60}$")

_lock = threading.RLock()


class SfxError(Exception):
    """A problem the user can fix (not audio, too long...); the message is shown as is."""


# id -> (name, description, peak seconds, ffmpeg recipe: (lavfi inputs, filter graph or audio filters))
# Every recipe ends at a peak of about -3 dB so the same volume setting means about the same loudness.
_ST = f"aformat=channel_layouts=stereo,aresample={SAMPLE_RATE}"
BUILTIN: dict[str, dict[str, Any]] = {
    "whoosh": {"name": "Whoosh", "peak": 0.42, "duration": 0.8, "description": "Varrida de ar clássica: para deslizes e whips.",
               "inputs": [f"anoisesrc=d=0.8:c=pink:r={SAMPLE_RATE}:a=0.9"],
               "af": f"highpass=f=250,lowpass=f=7000,tremolo=f=9:d=0.25,afade=t=in:st=0:d=0.45:curve=qsin,"
                     f"afade=t=out:st=0.45:d=0.35:curve=exp,volume=10dB,{_ST}"},
    "swish": {"name": "Swish curto", "peak": 0.1, "duration": 0.3, "description": "Chiado rápido e agudo: cortes velozes.",
              "inputs": [f"anoisesrc=d=0.3:c=white:r={SAMPLE_RATE}:a=0.9"],
              "af": f"highpass=f=1500,lowpass=f=9000,afade=t=in:d=0.1:curve=qsin,afade=t=out:st=0.1:d=0.2:curve=exp,volume=0.5dB,{_ST}"},
    "impact": {"name": "Impacto", "peak": 0.0, "duration": 0.9, "description": "Pancada grave no corte: dá peso a uma frase ou virada.",
               "inputs": [f"aevalsrc='0.7*sin(2*PI*(60*t-30*t*t))*exp(-4*t)':d=0.9:s={SAMPLE_RATE}",
                          f"anoisesrc=d=0.9:c=brown:r={SAMPLE_RATE}:a=0.5"],
               "graph": f"[1:a]lowpass=f=900,afade=t=out:st=0:d=0.25[n];[0:a][n]amix=inputs=2:normalize=0,volume=2dB,{_ST}[o]"},
    "riser": {"name": "Subida (riser)", "peak": 0.85, "duration": 0.9, "description": "Tom que sobe e termina no corte: cria expectativa.",
              "inputs": [f"aevalsrc='0.6*sin(2*PI*(180*t+700*t*t))':d=0.9:s={SAMPLE_RATE}"],
              "af": f"afade=t=in:st=0:d=0.85:curve=exp,afade=t=out:st=0.86:d=0.04,volume=4dB,{_ST}"},
    "glitch": {"name": "Glitch digital", "peak": 0.0, "duration": 0.35, "description": "Rajada de ruído digital: combina com o glitch RGB.",
               "inputs": [f"anoisesrc=d=0.35:c=white:r={SAMPLE_RATE}:a=0.8"],
               "af": f"highpass=f=1200,tremolo=f=38:d=1,acrusher=bits=5:mix=0.8,afade=t=out:st=0.2:d=0.15,volume=-3dB,{_ST}"},
    "pop": {"name": "Pop", "peak": 0.0, "duration": 0.12, "description": "Estalo curtinho e limpo.",
            "inputs": [f"aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*t)':d=0.12:s={SAMPLE_RATE}"],
            "af": f"volume=2dB,{_ST}"},
}


# ----------------------------------------------------------------------------
# Index of the user's sounds
# ----------------------------------------------------------------------------
def _read_index() -> list[dict[str, Any]]:
    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = data.get("items") if isinstance(data, dict) else None
    return [i for i in (items or []) if isinstance(i, dict) and ID_RE.match(str(i.get("id", "")))]


def _write_index(items: list[dict[str, Any]]) -> None:
    SFX_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INDEX.with_suffix(".tmp")
    tmp.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=1), encoding="utf-8")
    replace_file(tmp, INDEX)


# ----------------------------------------------------------------------------
# The ready-made sounds
# ----------------------------------------------------------------------------
def _builtin_path(sound_id: str) -> Path:
    return BUILTIN_DIR / f"{sound_id}.v{GENERATOR_VERSION}.wav"


def _generate(sound_id: str) -> Path:
    path = _builtin_path(sound_id)
    if path.exists() and path.stat().st_size > 1000:
        return path
    recipe = BUILTIN[sound_id]
    BUILTIN_DIR.mkdir(parents=True, exist_ok=True)
    for stale in BUILTIN_DIR.glob(f"{sound_id}.v*.wav"):
        stale.unlink(missing_ok=True)
    tmp = path.with_name(path.stem + ".tmp.wav")
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for src in recipe["inputs"]:
        cmd += ["-f", "lavfi", "-i", src]
    if "graph" in recipe:
        cmd += ["-filter_complex", recipe["graph"], "-map", "[o]"]
    else:
        cmd += ["-af", recipe["af"]]
    cmd += ["-c:a", "pcm_s16le", str(tmp)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not tmp.exists():
        raise SfxError(f"Não consegui gerar o som “{recipe['name']}”: {proc.stderr[-300:]}")
    replace_file(tmp, path)
    return path


def _duration(path: Path) -> float:
    proc = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                          capture_output=True, text=True)
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


# ----------------------------------------------------------------------------
# What the rest of the app uses
# ----------------------------------------------------------------------------
def catalog() -> list[dict[str, Any]]:
    """The ready-made sounds followed by the user's: [{id, name, kind, description, peak, duration}]."""
    out = []
    for sid, r in BUILTIN.items():
        out.append({"id": sid, "name": r["name"], "kind": "builtin", "description": r["description"], "peak": r["peak"],
                    "duration": r["duration"]})
    with _lock:
        for i in _read_index():
            out.append({"id": i["id"], "name": i.get("name") or i["id"], "kind": "user", "description": "",
                        "peak": float(i.get("peak") or 0.0), "duration": float(i.get("duration") or 0.0)})
    return out


def path_of(sound_id: Any) -> Path | None:
    if not isinstance(sound_id, str) or not ID_RE.match(sound_id):
        return None
    if sound_id in BUILTIN:
        try:
            return _generate(sound_id)
        except SfxError:
            return None
    with _lock:
        for i in _read_index():
            if i["id"] == sound_id:
                p = USER_DIR / str(i.get("file", ""))
                return p if p.exists() else None
    return None


def lookup() -> dict[str, dict[str, Any]]:
    """id -> {"path", "peak", "duration", "name"} of every sound that exists (the ready-made ones are generated now)."""
    out = {}
    for item in catalog():
        p = path_of(item["id"])
        if p:
            out[item["id"]] = {"path": p, "peak": item["peak"], "duration": item["duration"] or _duration(p), "name": item["name"]}
    return out


def add(raw: bytes, filename: str) -> dict[str, Any]:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise SfxError("Use um arquivo de áudio: WAV, MP3, OGG, M4A, AAC, FLAC ou OPUS.")
    if not raw:
        raise SfxError("O arquivo está vazio.")
    if len(raw) > MAX_BYTES:
        raise SfxError(f"O arquivo passa de {MAX_BYTES // 1048576} MB.")
    with _lock:
        items = _read_index()
        if len(items) >= MAX_ITEMS:
            raise SfxError("A biblioteca de sons está cheia: exclua algum antes de enviar outro.")
        sid = f"u_{uuid.uuid4().hex[:10]}"
        USER_DIR.mkdir(parents=True, exist_ok=True)
        dest = USER_DIR / f"{sid}{ext}"
        dest.write_bytes(raw)
        duration = _duration(dest)
        if duration <= 0.01:
            dest.unlink(missing_ok=True)
            raise SfxError("Não consegui ler esse áudio.")
        if duration > MAX_SECONDS:
            dest.unlink(missing_ok=True)
            raise SfxError(f"Um efeito sonoro deve ter até {MAX_SECONDS:.0f} segundos (este tem {duration:.0f}).")
        name = re.sub(r"[\r\n\t]", " ", Path(filename).stem).strip()[:60] or "Som"
        item = {"id": sid, "name": name, "file": dest.name, "duration": round(duration, 3), "peak": 0.0, "added": int(time.time())}
        items.append(item)
        _write_index(items)
    return {"id": sid, "name": name, "kind": "user", "description": "", "peak": 0.0, "duration": item["duration"]}


def remove(sound_id: str) -> str:
    """"ok" | "builtin" | "missing"."""
    if sound_id in BUILTIN:
        return "builtin"
    with _lock:
        items = _read_index()
        keep = [i for i in items if i["id"] != sound_id]
        if len(keep) == len(items):
            return "missing"
        for i in items:
            if i["id"] == sound_id:
                (USER_DIR / str(i.get("file", ""))).unlink(missing_ok=True)
        _write_index(keep)
    return "ok"


# ----------------------------------------------------------------------------
# The render
# ----------------------------------------------------------------------------
def plan(cut_times: list[float], per_cut: list[dict[str, Any]], total: float, video_start: float,
         lib: dict[str, dict[str, Any]], log: Any = None) -> list[dict[str, Any]]:
    """The sounds to mix: [{path, start, dur, gain}] with `start` in seconds from the start of the audio.
    `cut_times` = time of every cut on the video's clock; `per_cut` = transitions.resolve_cuts() of those cuts."""
    say = log or (lambda _m: None)
    out = []
    missing = 0
    for t, cut in zip(cut_times, per_cut):
        snd = cut.get("sound")
        if not snd:
            continue
        item = lib.get(snd["id"])
        if not item:
            missing += 1
            continue
        start = max(0.0, (t - video_start) - item["peak"] + snd["offset"])
        if start >= total:
            continue
        out.append({"path": item["path"], "start": round(start, 3), "dur": item["duration"], "gain": snd["volume"]})
    if missing:
        say(f"Aviso: {missing} corte(s) usam um som que não existe mais na biblioteca; ficaram sem som.")
    return out


def build_graph(sounds: list[dict[str, Any]], base: str | None, total: float, first_input: int) -> dict[str, Any]:
    """ffmpeg pieces that mix `sounds` over the audio `base` (a label such as "[0:a]" or "[aout]"; None = the video has
    no sound of its own). Returns {"inputs", "parts", "last"}; sound k is input first_input + k. As long as the video."""
    inputs: list[str] = []
    parts: list[str] = []
    labels: list[str] = []
    for k, s in enumerate(sounds):
        idx = first_input + k
        inputs += ["-i", str(s["path"])]
        chain = (f"[{idx}:a]aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
                 f"asetpts=PTS-STARTPTS,volume={s['gain']:.4f}")
        delay = int(round(s["start"] * 1000))
        if delay > 0:
            chain += f",adelay={delay}:all=1"
        parts.append(f"{chain}[sx{k}]")
        labels.append(f"[sx{k}]")
    limiter = "alimiter=limit=0.97:level=0"
    pad = f"apad=whole_dur={total:.3f},atrim=0:{total:.3f}"
    if base:
        parts.append(f"{base}aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[sxb]")
        parts.append(f"[sxb]{''.join(labels)}amix=inputs={len(labels) + 1}:normalize=0:duration=first:dropout_transition=0,{limiter}[sfxout]")
    else:
        parts.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest:dropout_transition=0,{pad},{limiter}[sfxout]"
                     if len(labels) > 1 else f"{labels[0]}{pad},{limiter}[sfxout]")
    return {"inputs": inputs, "parts": parts, "last": "[sfxout]"}
