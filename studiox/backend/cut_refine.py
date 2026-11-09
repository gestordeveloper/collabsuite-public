"""Puts cut points on the real edges of speech.

Speech-to-text timestamps are not sample-accurate: measured on this user's phone audio, Scribe marks
word starts 50-160 ms late, so cutting at "word start - 50 ms" clips the first consonant. The audio
itself is the ground truth: this module builds a 5 ms energy envelope of the recording, finds the
islands of speech (energy above a threshold derived from the file's own noise floor) and moves each
cut point to the edge of the island the word belongs to, plus a small safety margin.

When two words run together (no silence between them) there is no edge to find and the classic
fixed padding is used, never crossing into the neighbouring word.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from backend import audio_timeline

HOP_S = 0.005            # envelope resolution
SAMPLE_RATE = 16000
MIN_GAP_S = 0.04         # a dip shorter than this (a plosive closure) does not split a word
FALLBACK_PAD_IN = 0.05
FALLBACK_PAD_OUT = 0.08
MARGIN_IN = 0.07         # breathing room kept before the detected onset
MARGIN_OUT = 0.12        # ... and after the detected end
TAIL_DB = 8.0            # an island keeps growing over energy up to this far below the speech threshold
TAIL_MAX_S = 0.15        # ... for at most this long on each side
LOOK_BACK_S = 0.40       # never move a start more than this before the ASR timestamp
LOOK_AHEAD_S = 0.20      # how far ahead an onset may be when the ASR start was too early


@dataclass
class SpeechMap:
    starts: np.ndarray   # island start times (s)
    ends: np.ndarray     # island end times (s)
    threshold_db: float
    floor_db: float

    def containing(self, t: float) -> tuple[float, float] | None:
        i = int(np.searchsorted(self.starts, t, side="right")) - 1
        if i >= 0 and self.ends[i] >= t:
            return float(self.starts[i]), float(self.ends[i])
        return None

    def next_start(self, t: float, within: float) -> float | None:
        i = int(np.searchsorted(self.starts, t, side="right"))
        if i < len(self.starts) and self.starts[i] - t <= within:
            return float(self.starts[i])
        return None

    def prev_end(self, t: float, within: float) -> float | None:
        i = int(np.searchsorted(self.ends, t, side="left")) - 1
        if i >= 0 and t - self.ends[i] <= within:
            return float(self.ends[i])
        return None


def energy_envelope_db(video_path: Path) -> np.ndarray:
    """Per-5ms RMS of the first audio stream, in dBFS (floored at -90)."""
    # audio_timeline pads the start when the audio begins after the video, so this envelope shares the video's clock
    cmd = ["ffmpeg", "-v", "error", "-i", str(video_path), "-vn", *audio_timeline.filter_args(video_path), "-ac", "1",
           "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
    hop = int(SAMPLE_RATE * HOP_S)
    parts: list[np.ndarray] = []
    leftover = b""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        while True:
            chunk = proc.stdout.read(1 << 20)
            if not chunk:
                break
            data = leftover + chunk
            n = (len(data) // 2 // hop) * hop
            if n:
                arr = np.frombuffer(data[:n * 2], dtype=np.int16).astype(np.float32)
                parts.append(np.sqrt(np.mean(arr.reshape(-1, hop) ** 2, axis=1)))
            leftover = data[n * 2:]
    finally:
        proc.stdout.close()
        proc.wait()
    if not parts:
        return np.zeros(0, dtype=np.float32)
    rms = np.concatenate(parts)
    return (20.0 * np.log10(np.maximum(rms, 1.0) / 32768.0)).astype(np.float32)


def build_speech_map(env_db: np.ndarray) -> SpeechMap | None:
    if env_db.size < 20:
        return None
    floor = float(np.percentile(env_db, 10))
    thr = min(-38.0, max(-50.0, floor + 12.0))
    speech = env_db >= thr

    # Close dips shorter than MIN_GAP_S so one word is one island
    edges = np.flatnonzero(np.diff(np.concatenate(([0], speech.view(np.int8), [0]))))
    runs = list(zip(edges[0::2], edges[1::2]))  # [start, end) frame indices of True runs
    merged: list[list[int]] = []
    gap_frames = int(MIN_GAP_S / HOP_S)
    for s, e in runs:
        if merged and s - merged[-1][1] <= gap_frames:
            merged[-1][1] = e
        else:
            merged.append([int(s), int(e)])
    if not merged:
        return None

    # Hysteresis: a word's soft tail (trailing vowel/fricative, breath of a sentence ending) decays below the
    # threshold while still audible. Grow each island along energy that is still within TAIL_DB of it, a bounded
    # distance, so the cut lands after the tail instead of in the middle of it.
    low = env_db >= thr - TAIL_DB
    max_grow = int(TAIL_MAX_S / HOP_S)
    n = len(env_db)
    for k, (s, e) in enumerate(merged):
        lo_lim = merged[k - 1][1] if k else 0
        hi_lim = merged[k + 1][0] if k + 1 < len(merged) else n
        g = 0
        while e < hi_lim and g < max_grow and low[e]:
            e += 1
            g += 1
        g = 0
        while s > lo_lim and g < max_grow and low[s - 1]:
            s -= 1
            g += 1
        merged[k] = [s, e]
    arr = np.array(merged, dtype=np.float64) * HOP_S
    return SpeechMap(starts=arr[:, 0], ends=arr[:, 1], threshold_db=thr, floor_db=floor)


def load_speech_map(video_path: Path) -> SpeechMap | None:
    try:
        return build_speech_map(energy_envelope_db(video_path))
    except (OSError, ValueError):
        return None


def refine_segment(sm: SpeechMap | None, first_start: float, last_end: float,
                   prev_end: float, next_start: float) -> tuple[float, float]:
    """Cut in/out for a stretch whose first kept word starts at `first_start` and last ends at `last_end`.
    `prev_end` / `next_start` are the neighbouring words' edges (kept or cut): the cut never crosses them."""
    lo = max(0.0, prev_end + 0.005)
    hi = max(last_end, next_start - 0.005)

    # Default: classic fixed padding, clamped to the neighbours
    start = min(first_start, max(first_start - FALLBACK_PAD_IN, lo))
    end = max(last_end, min(last_end + FALLBACK_PAD_OUT, hi))
    if sm is None:
        return start, end

    # --- in point: the edge of the speech island the first word belongs to
    isl = sm.containing(first_start + 0.03)
    if isl is not None:
        onset = isl[0]
    else:
        onset = sm.next_start(first_start, LOOK_AHEAD_S)
    if onset is not None and onset > lo:            # a real silence lies between the neighbour and the word
        onset = max(onset, first_start - LOOK_BACK_S)
        start = max(lo, onset - MARGIN_IN)
    # else: words run together -> keep the fallback padding

    # --- out point: the edge of the island the last word belongs to
    isl = sm.containing(last_end - 0.03)
    if isl is not None:
        offset = isl[1]
    else:
        offset = sm.prev_end(last_end, LOOK_AHEAD_S)
    if offset is not None and offset < hi:          # a silence follows before the next word
        offset = min(offset, last_end + LOOK_BACK_S)
        end = min(hi, max(last_end, offset + MARGIN_OUT))

    return min(start, first_start), max(end, last_end)
