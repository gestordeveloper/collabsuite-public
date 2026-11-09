"""A motion graphic that FOLLOWS something in the picture: a face, a hand, or any point the user clicked.

Three steps, like the face camera (backend/face_track.py, whose detector and person-following this reuses):
  1. analyze():  decodes only the stretches of the SOURCE video the item covers, at FPS samples a second, and finds the
                 target: YuNet for the face, MediaPipe's hand landmarker for the hand, Lucas-Kanade optical flow for a
                 clicked point. The result (every anchor of that target — "above the head", "index fingertip"... — as
                 fractions of the frame, in source time) is cached in <project>/motion_tracks/<item>.json.
  2. smoothed(): a Gaussian low-pass per continuous run, so the graphic glides instead of shaking. The browser asks for THIS
                 path (js/motiontrack.js), and the render draws the same one.
  3. build_exprs(): where the target ends up on the FINAL frame over the output timeline (after the cuts, the face camera
                 and the aspect-ratio canvas), as ffmpeg expressions of t for the overlay's x/y and for its enable.

A graphic that follows something is rendered ONCE (like every motion item) with its design centred in the frame, and the
final pass only moves that full-frame video: overlay x = (X - 0.5) * W. So moving, re-targeting or changing the anchor
never needs a new Remotion render.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from backend import face_track

VERSION = 1
TRACK_DIR = "motion_tracks"
HAND_MODEL = Path(__file__).resolve().parent / "models" / "hand_landmarker.task"

FPS = 15                  # samples per second of the source video
DETECT_WIDTH = 480        # faces/hands are looked for at this width (the point tracker uses POINT_WIDTH)
POINT_WIDTH = 360
GAP_S = 1.0               # a target lost for longer than this hides the graphic (shorter gaps are bridged)
JUMP = 0.30               # a move bigger than this (fraction of the frame) between two samples is a cut, not a motion
MAX_SPAN_S = 180.0        # the most video one item may analyse
PAD_S = 0.25              # analysed beyond the item's edges, so the path is already running when it appears

TARGETS = ("none", "face", "hand", "point")

# Anchors, in units of the face height (x is converted to the frame's width): where on the person the graphic sits.
FACE_PARTS: dict[str, tuple[float, float]] = {
    "head_top": (0.0, -0.85), "forehead": (0.0, -0.35), "center": (0.0, 0.0),
    "chin": (0.0, 0.75), "left": (-0.9, 0.0), "right": (0.9, 0.0),
}
# MediaPipe hand landmarks: 0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 20 pinky tip; the palm is the middle of 0/5/9/13/17
HAND_PARTS: dict[str, tuple[int, ...]] = {
    "palm": (0, 5, 9, 13, 17), "wrist": (0,), "index_tip": (8,), "thumb_tip": (4,), "middle_tip": (12,), "pinky_tip": (20,),
}
PARTS: dict[str, list[str]] = {"face": list(FACE_PARTS), "hand": list(HAND_PARTS), "point": ["point"]}
DEFAULT_PART = {"face": "head_top", "hand": "palm", "point": "point"}

DEFAULT_FOLLOW: dict[str, Any] = {"target": "none", "part": "center", "dx": 0.0, "dy": 0.0, "smooth": 0.4, "seed": None}


class MotionTrackError(RuntimeError):
    pass


def _num(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if x != x:
        return default
    return min(hi, max(lo, x))


def sanitize_follow(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    target = raw.get("target") if raw.get("target") in TARGETS else "none"
    out = dict(DEFAULT_FOLLOW)
    out["target"] = target
    if target == "none":
        return out
    out["part"] = raw.get("part") if raw.get("part") in PARTS[target] else DEFAULT_PART[target]
    out["dx"] = round(_num(raw.get("dx"), -0.5, 0.5, 0.0), 4)
    out["dy"] = round(_num(raw.get("dy"), -0.5, 0.5, 0.0), 4)
    out["smooth"] = round(_num(raw.get("smooth"), 0.0, 1.0, DEFAULT_FOLLOW["smooth"]), 3)
    seed = raw.get("seed")
    if isinstance(seed, dict):
        t, x, y = (_num(seed.get(k), lo, hi, -1.0) for k, lo, hi in (("t", 0.0, 1e6), ("x", 0.0, 1.0), ("y", 0.0, 1.0)))
        if min(t, x, y) >= 0:
            out["seed"] = {"t": round(t, 3), "x": round(x, 4), "y": round(y, 4)}
    return out


def is_following(follow: Any) -> bool:
    return isinstance(follow, dict) and follow.get("target") in ("face", "hand", "point")


def shared_constants() -> dict[str, Any]:
    return {"targets": list(TARGETS[1:]), "parts": PARTS, "default_part": DEFAULT_PART, "fps": FPS, "defaults": dict(DEFAULT_FOLLOW)}


def _vision():
    """MediaPipe's Tasks API: (vision, BaseOptions). Its `vision` package imports matplotlib only for its drawing helpers, which
    this never calls — and the packaged app does not ship matplotlib — so a missing one is replaced by an empty stand-in
    BEFORE the import (a half-finished import of mediapipe cannot be retried)."""
    import importlib.util
    try:
        has_plt = importlib.util.find_spec("matplotlib") is not None
    except (ValueError, ImportError):
        has_plt = False
    if not has_plt:
        import sys
        import types
        pkg, plt = types.ModuleType("matplotlib"), types.ModuleType("matplotlib.pyplot")
        pkg.__path__ = []
        pkg.pyplot = plt
        sys.modules["matplotlib"], sys.modules["matplotlib.pyplot"] = pkg, plt
    from mediapipe.tasks.python import BaseOptions, vision
    return vision, BaseOptions


def availability() -> dict[str, bool]:
    try:
        import cv2  # noqa: F401
        cv_ok = True
    except ImportError:
        cv_ok = False
    hand_ok = False
    if HAND_MODEL.exists():
        try:
            _vision()
            hand_ok = True
        except Exception:
            hand_ok = False
    return {"face": cv_ok and face_track.is_available(), "hand": hand_ok, "point": cv_ok}


# ----------------------------------------------------------------------------
# What has to be analysed
# ----------------------------------------------------------------------------
def merge_ranges(ranges: list[list[float]], limit: float | None = None) -> list[list[float]]:
    out: list[list[float]] = []
    for r in sorted([float(a), float(b)] for a, b in ranges if float(b) - float(a) > 0.02):
        r = [max(0.0, r[0]), r[1]]
        if out and r[0] <= out[-1][1] + 0.05:
            out[-1][1] = max(out[-1][1], r[1])
        else:
            out.append(r)
    if limit is not None:
        total, kept = 0.0, []
        for a, b in out:
            take = min(b - a, limit - total)
            if take <= 0.02:
                break
            kept.append([a, a + take])
            total += take
        out = kept
    return [[round(a, 3), round(b, 3)] for a, b in out]


def source_ranges(item_start: float, item_dur: float, ranges: list[dict], lens: list[float], start_time: float = 0.0) -> list[list[float]]:
    """The stretches of the SOURCE video an item (output time [start, start+dur]) is on screen over, padded a little."""
    out: list[list[float]] = []
    acc = start_time
    a, b = item_start, item_start + item_dur
    for r, d in zip(ranges, lens):
        lo, hi = max(a, acc), min(b, acc + d)
        if hi - lo > 1e-3:
            s = float(r["start"]) + (lo - acc)
            out.append([s - PAD_S, s + (hi - lo) + PAD_S])
        acc += d
    return merge_ranges(out, MAX_SPAN_S)


def covers(data: dict[str, Any], ranges: list[list[float]]) -> bool:
    have = data.get("covered") or []
    for a, b in ranges:
        if not any(ca - 0.06 <= a and b <= cb + 0.06 for ca, cb in have):
            return False
    return True


def same_request(data: dict[str, Any], follow: dict[str, Any]) -> bool:
    seed = follow.get("seed")
    return (data.get("version") == VERSION and data.get("target") == follow.get("target")
            and (data.get("seed") or None) == (seed or None))


# ----------------------------------------------------------------------------
# Analysis
# ----------------------------------------------------------------------------
def _frames(video: Path, start: float, end: float, w: int, h: int, gray: bool):
    """Yields (source time, frame) at FPS, scaled to w x h (the picture as DISPLAYED: phone clips carry a rotation flag)."""
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, start):.3f}", "-t", f"{end - max(0.0, start):.3f}", "-i", str(video),
           "-an", "-vf", f"fps={FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray" if gray else "bgr24", "-"]
    size = w * h * (1 if gray else 3)
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError as exc:
        raise MotionTrackError(f"Não consegui abrir o ffmpeg: {exc}") from exc
    n = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            shape = (h, w) if gray else (h, w, 3)
            yield max(0.0, start) + n / FPS, np.frombuffer(buf, dtype=np.uint8).reshape(shape)
            n += 1
    finally:
        proc.stdout.close()
        proc.terminate()
        proc.wait()


def _dims(video: Path, width: int) -> tuple[int, int]:
    w, h, _ = face_track._probe(video)
    dw = min(width, w)
    return dw, max(2, int(round(dw * h / w / 2)) * 2)


def _face_samples(video: Path, ranges: list[list[float]], seed: dict | None, tick: Callable[[float], None]) -> list[dict]:
    import cv2

    if not face_track.is_available():
        raise MotionTrackError("O rastreador de rosto não está instalado.")
    dw, dh = _dims(video, DETECT_WIDTH)
    aspect = dh / dw   # frame height / width: a face's height fraction -> width fraction
    out: list[dict] = []
    for k, (s, e) in enumerate(ranges):
        detector = cv2.FaceDetectorYN.create(str(face_track.MODEL_PATH), "", (dw, dh), face_track.MIN_SCORE, 0.3, 20)
        faces: list[list[Any]] = []
        for t, frame in _frames(video, s, e, dw, dh, gray=False):
            _, found = detector.detect(frame)
            if found is not None and len(found):
                faces.append([round(t, 3), [[float((f[0] + f[2] / 2) / dw), float((f[1] + f[3] / 2) / dh), float(f[3] / dh), float(f[14])] for f in found]])
            tick((k + min(1.0, (t - s) / max(0.1, e - s))) / len(ranges))
        for t, cx, cy, h in face_track.follow({"faces": faces}, seed):
            w_frac = h * aspect
            out.append({"t": t, "p": {name: (cx + ox * w_frac, cy + oy * h) for name, (ox, oy) in FACE_PARTS.items()}})
    return out


def _hand_samples(video: Path, ranges: list[list[float]], seed: dict | None, tick: Callable[[float], None]) -> list[dict]:
    if not availability()["hand"]:
        raise MotionTrackError("O rastreador de mãos não está instalado nesta cópia (falta o mediapipe ou o modelo).")
    vision, BaseOptions = _vision()
    import mediapipe as mp

    dw, dh = _dims(video, DETECT_WIDTH)
    out: list[dict] = []
    for k, (s, e) in enumerate(ranges):
        opts = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(HAND_MODEL)), running_mode=vision.RunningMode.VIDEO, num_hands=2,
            min_hand_detection_confidence=0.45, min_hand_presence_confidence=0.45, min_tracking_confidence=0.45)
        det = vision.HandLandmarker.create_from_options(opts)
        prev: tuple[float, float] | None = None
        prev_t = -99.0
        first = True
        try:
            for t, frame in _frames(video, s, e, dw, dh, gray=False):
                rgb = np.ascontiguousarray(frame[:, :, ::-1])
                res = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int((t - s) * 1000))
                cands = []
                for i, lm in enumerate(res.hand_landmarks or []):
                    pts = {name: (float(np.mean([lm[j].x for j in idx])), float(np.mean([lm[j].y for j in idx]))) for name, idx in HAND_PARTS.items()}
                    score = float(res.handedness[i][0].score) if res.handedness and res.handedness[i] else 0.5
                    cands.append((pts, score))
                if cands:
                    ref = prev if prev is not None and t - prev_t <= GAP_S else None
                    if ref is None and first and seed and abs(seed["t"] - t) <= 1.5:
                        ref = (seed["x"], seed["y"])
                    if ref is not None:
                        pick = min(cands, key=lambda c: (c[0]["palm"][0] - ref[0]) ** 2 + (c[0]["palm"][1] - ref[1]) ** 2)
                    else:
                        pick = max(cands, key=lambda c: c[1])
                    if ref is None or (pick[0]["palm"][0] - ref[0]) ** 2 + (pick[0]["palm"][1] - ref[1]) ** 2 < 0.5 ** 2:
                        prev, prev_t, first = pick[0]["palm"], t, False
                        out.append({"t": round(t, 3), "p": pick[0]})
                tick((k + min(1.0, (t - s) / max(0.1, e - s))) / len(ranges))
        finally:
            det.close()
    return out


def _point_samples(video: Path, ranges: list[list[float]], seed: dict | None, tick: Callable[[float], None]) -> list[dict]:
    import cv2

    if not seed:
        raise MotionTrackError("Clique no vídeo, no ponto que o gráfico deve seguir.")
    dw, dh = _dims(video, POINT_WIDTH)
    st = float(seed["t"])
    rng = next(([a, b] for a, b in ranges if a - 0.06 <= st <= b + 0.06), None)
    if rng is None:
        raise MotionTrackError("O ponto escolhido está fora do trecho em que o gráfico aparece.")
    a, b = rng
    frames = [(t, f.copy()) for t, f in _frames(video, a, b, dw, dh, gray=True)]
    if not frames:
        raise MotionTrackError("Não consegui ler o vídeo.")
    k0 = int(np.argmin([abs(t - st) for t, _ in frames]))

    lk = dict(winSize=(25, 25), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))
    cx, cy = seed["x"] * dw, seed["y"] * dh
    step = max(3, int(dw * 0.012))
    offs = np.array([[ox * step, oy * step] for ox in (-2, -1, 0, 1, 2) for oy in (-2, -1, 0, 1, 2)], dtype=np.float32)

    def run(order: list[int]) -> list[tuple[float, float, float]]:
        pts = (np.array([[cx, cy]], dtype=np.float32) + offs).reshape(-1, 1, 2)
        keep = np.ones(len(offs), dtype=bool)
        res = [(frames[order[0]][0], cx, cy)]
        for i, j in zip(order, order[1:]):
            nxt, ok, _ = cv2.calcOpticalFlowPyrLK(frames[i][1], frames[j][1], pts, None, **lk)
            ok = ok.reshape(-1).astype(bool) & keep
            if ok.sum() < max(4, len(offs) // 4):
                break
            pts, keep = nxt, ok
            centre = np.median((pts.reshape(-1, 2) - offs)[keep], axis=0)
            if not (0 <= centre[0] <= dw and 0 <= centre[1] <= dh):
                break
            res.append((frames[j][0], float(centre[0]), float(centre[1])))
        return res

    fwd = run(list(range(k0, len(frames))))
    bwd = run(list(range(k0, -1, -1)))[1:]
    tick(1.0)
    return [{"t": round(t, 3), "p": {"point": (x / dw, y / dh)}} for t, x, y in bwd[::-1] + fwd]


def analyze(video: Path, ranges: list[list[float]], follow: dict[str, Any], progress: Callable[[float], None] | None = None) -> dict[str, Any]:
    """Every anchor of the target over `ranges` (source seconds): {"t": [...], "x": {part: [...]}, "y": {part: [...]}} on the
    samples where the target was found (fractions of the displayed frame)."""
    target = follow["target"]
    if target not in PARTS:
        raise MotionTrackError("Este item não segue nada.")
    ranges = merge_ranges(ranges, MAX_SPAN_S)
    if not ranges:
        raise MotionTrackError("O item não está sobre nenhum trecho do vídeo.")
    seed = follow.get("seed")
    tick = progress or (lambda p: None)
    fn = {"face": _face_samples, "hand": _hand_samples, "point": _point_samples}[target]
    samples = sorted(fn(video, ranges, seed, tick), key=lambda s: s["t"])
    parts = PARTS[target]
    return {
        "version": VERSION, "target": target, "seed": seed or None, "fps": FPS, "covered": ranges, "parts": parts,
        "t": [round(s["t"], 3) for s in samples],
        "x": {p: [round(s["p"][p][0], 4) for s in samples] for p in parts},
        "y": {p: [round(s["p"][p][1], 4) for s in samples] for p in parts},
    }


# ----------------------------------------------------------------------------
# Storage
# ----------------------------------------------------------------------------
def _file(project_dir: Path, item_id: str) -> Path:
    safe = "".join(c for c in item_id if c.isalnum() or c in "_-")[:40] or "item"
    return project_dir / TRACK_DIR / f"{safe}.json"


def save(project_dir: Path, item_id: str, data: dict[str, Any]) -> None:
    path = _file(project_dir, item_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def load(project_dir: Path, item_id: str) -> dict[str, Any] | None:
    try:
        data = json.loads(_file(project_dir, item_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("version") == VERSION else None


JOBS: dict[tuple[str, str], dict[str, Any]] = {}
_lock = threading.Lock()


def job_state(project_id: str, item_id: str) -> dict[str, Any]:
    with _lock:
        return dict(JOBS.get((project_id, item_id)) or {})


def start_job(project_dir: Path, item_id: str, video: Path, follow: dict[str, Any], ranges: list[list[float]]) -> dict[str, Any]:
    """Analyses in the background (a detector pass over a long stretch is not instant). One job per item at a time."""
    key = (project_dir.name, item_id)
    with _lock:
        cur = JOBS.get(key)
        if cur and cur.get("status") == "running":
            return dict(cur)
        job = {"status": "running", "progress": 0.0, "error": "", "started": time.time()}
        JOBS[key] = job

    def work() -> None:
        try:
            data = analyze(video, ranges, follow, lambda p: job.__setitem__("progress", min(0.99, p)))
            save(project_dir, item_id, data)
            job.update(status="done", progress=1.0)
        except Exception as exc:  # shown in the editor; must never take the server down
            job.update(status="error", error=str(exc))

    threading.Thread(target=work, daemon=True).start()
    return dict(job)


def ensure(project_dir: Path, item_id: str, video: Path, follow: dict[str, Any], ranges: list[list[float]],
           log: Callable[[str], None] | None = None) -> dict[str, Any] | None:
    """The analysis of an item for these ranges: the cached one when it still fits, otherwise a fresh one, done now
    (the final render must not depend on the editor having analysed first)."""
    data = load(project_dir, item_id)
    if data and same_request(data, follow) and covers(data, ranges):
        return data
    if log:
        log(f"Analisando o alvo do motion graphic ({follow['target']})…")
    try:
        data = analyze(video, ranges, follow)
    except MotionTrackError as exc:
        if log:
            log(f"Aviso: não consegui rastrear o motion graphic: {exc}")
        return None
    save(project_dir, item_id, data)
    return data


# ----------------------------------------------------------------------------
# The path
# ----------------------------------------------------------------------------
def smoothed(data: dict[str, Any], part: str, smooth: float) -> dict[str, Any] | None:
    """One anchor, smoothed: {"fps", "t", "x", "y", "runs": [[i0, i1], ...]} — the runs are the stretches where the target
    was seen continuously (a gap longer than GAP_S, or a jump that is really a cut, starts a new one)."""
    t = np.asarray(data.get("t") or [], dtype=np.float64)
    if len(t) == 0 or part not in (data.get("x") or {}):
        return None
    x = np.asarray(data["x"][part], dtype=np.float64)
    y = np.asarray(data["y"][part], dtype=np.float64)
    runs: list[list[int]] = []
    a = 0
    for i in range(1, len(t)):
        if t[i] - t[i - 1] > GAP_S or np.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) > JUMP:
            runs.append([a, i - 1])
            a = i
    runs.append([a, len(t) - 1])
    sigma = (0.02 + 0.40 * min(1.0, max(0.0, smooth))) * FPS
    sx, sy = x.copy(), y.copy()
    for i0, i1 in runs:
        if i1 - i0 >= 2:
            sx[i0:i1 + 1], sy[i0:i1 + 1] = face_track._gauss(x[i0:i1 + 1], sigma), face_track._gauss(y[i0:i1 + 1], sigma)
    return {"fps": data.get("fps", FPS), "t": [round(float(v), 3) for v in t],
            "x": [round(float(v), 4) for v in sx], "y": [round(float(v), 4) for v in sy], "runs": runs}


# ----------------------------------------------------------------------------
# Source frame -> final frame (the render's side; js/motiontrack.js mirrors it for the preview)
# ----------------------------------------------------------------------------
class FrameMap:
    """Where a point of the SOURCE picture (u, v fractions) lands on the FINAL frame, for each cut.

    Mirrors the render order: the face camera (backend/face_track.py, which already draws on the canvas-sized picture when
    the aspect ratio changed) -> the aspect-ratio canvas (cover + scale/position/rotation, backend/canvas.py). The punch-in zoom
    of the cuts is NOT modelled (a small shift while it is on)."""

    def __init__(self, src: tuple[int, int], canvas_cfg: dict[str, Any] | None, canvas_size: tuple[int, int] | None,
                 face: dict[str, Any] | None, face_path: dict[str, Any] | None, ranges: list[dict]):
        from backend import canvas as canvas_frame
        self.src = src
        self.cfg = canvas_cfg
        self.transform = (canvas_cfg or {}).get("transform") or {"scale": 1.0, "x": 0.0, "y": 0.0, "rotation": 0.0}
        self.canvas_frame = canvas_frame
        self.frame = canvas_size or src                      # the picture the face camera draws (and the final frame)
        self.face = face if (face and face_path) else None
        self.path = face_path
        self.ranges = ranges
        self.final = canvas_frame.target_size(canvas_cfg, *src) if canvas_cfg else src
        self.manual = not canvas_frame.is_identity(self.transform)
        if self.face:
            self.final = self.frame
        self.active = [face_track.clip_is_active(face, float(r["start"]), float(r["end"])) for r in ranges] if self.face else []

    def _manual(self, px: float, py: float, cw: int, ch: int, picture: tuple[float, float]) -> tuple[float, float]:
        """The scale/position/rotation transform on a picture of size `picture` that is centred in a cw x ch canvas
        (px, py are canvas pixels BEFORE the transform)."""
        import math
        tr = self.transform
        cx, cy = cw / 2 + tr["x"] * cw, ch / 2 + tr["y"] * ch
        dx, dy = (px - cw / 2) * tr["scale"], (py - ch / 2) * tr["scale"]
        rad = math.radians(tr["rotation"])
        c, s = math.cos(rad), math.sin(rad)
        return cx + dx * c - dy * s, cy + dx * s + dy * c

    def point(self, u: float, v: float, t_src: float, clip: int) -> tuple[float, float]:
        W, H = self.src
        cw, ch = self.frame
        if self.face:
            if cw != W or ch != H:
                cover = max(cw / W, ch / H)
                bw, bh = max(cw, round(W * cover / 2) * 2), max(ch, round(H * cover / 2) * 2)
            else:
                bw, bh = W, H
            if self.active[clip]:
                zoom = self.face["zoom"]
                w = int(bw * zoom / 2) * 2
                h = bh * w / bw
                fx = float(np.interp(t_src, self.path["t"], self.path["x"]))
                fy = float(np.interp(t_src, self.path["t"], self.path["y"]))
                x = min(0.0, max(cw - w, cw * 0.5 - w * fx))
                y = min(0.0, max(ch - h, ch * self.face["anchor_y"] - h * fy))
            else:
                w, h = bw, bh
                x, y = (cw - w) / 2, (ch - h) / 2
            px, py = x + w * u, y + h * v
            if self.manual:
                px, py = self._manual(px, py, cw, ch, (cw, ch))
            return px / cw, py / ch
        if self.cfg is not None and (self.final != self.src or self.manual):
            fw, fh = self.final
            cover = max(fw / W, fh / H)
            px, py = fw / 2 + (u - 0.5) * W * cover, fh / 2 + (v - 0.5) * H * cover
            px, py = self._manual(px, py, fw, fh, (W * cover, H * cover))
            return px / fw, py / fh
        return u, v


def _interp(t: np.ndarray, v: np.ndarray, at: float) -> float:
    return float(np.interp(at, t, v))


def build_exprs(follow: dict[str, Any], sm: dict[str, Any], item_start: float, item_dur: float, ranges: list[dict],
                lens: list[float], start_time: float, fmap: FrameMap, frame_size: tuple[int, int]) -> dict[str, Any] | None:
    """ffmpeg for a followed item on the OUTPUT timeline: {"x", "y", "enable"} for the overlay of its full-frame video
    (x/y are the shift from the centre; enable is only true while the target is in view). None when it is never seen."""
    t = np.asarray(sm["t"])
    X, Y = np.asarray(sm["x"]), np.asarray(sm["y"])
    W, H = frame_size
    dx, dy = float(follow.get("dx") or 0.0), float(follow.get("dy") or 0.0)
    a, b = item_start, item_start + item_dur
    starts, acc = [], start_time
    for d in lens:
        starts.append(acc)
        acc += d

    x_terms: list[str] = []
    y_terms: list[str] = []
    windows: list[tuple[float, float]] = []
    for i, (r, d) in enumerate(zip(ranges, lens)):
        lo, hi = max(a, starts[i]), min(b, starts[i] + d)
        if hi - lo < 1e-3:
            continue
        s0 = float(r["start"])
        for i0, i1 in sm["runs"]:
            # the part of this run that is inside this cut AND inside the item (output times)
            rs, re_ = float(t[i0]), float(t[i1])
            o_lo = max(lo, starts[i] + (rs - s0) - 0.5 / FPS)
            o_hi = min(hi, starts[i] + (re_ - s0) + 0.5 / FPS)
            if o_hi - o_lo < 1e-3:
                continue
            src_times = [s0 + (o_lo - starts[i])]
            src_times += [float(t[k]) for k in range(i0, i1 + 1) if o_lo < starts[i] + (float(t[k]) - s0) < o_hi]
            src_times.append(s0 + (o_hi - starts[i]))
            pts: list[tuple[float, float, float]] = []
            for st in src_times:
                u, v = _interp(t[i0:i1 + 1], X[i0:i1 + 1], st), _interp(t[i0:i1 + 1], Y[i0:i1 + 1], st)
                fx, fy = fmap.point(u, v, st, i)
                pts.append((starts[i] + (st - s0), fx + dx, fy + dy))
            pts = face_track._simplify(pts, 0.0015)
            mono = [pts[0]]
            for p in pts[1:]:
                if p[0] > mono[-1][0] + 1e-4:
                    mono.append(p)
            if len(mono) < 2:
                mono.append((mono[0][0] + 0.02, mono[0][1], mono[0][2]))
            x_terms += face_track._piecewise([(tt, (xx - 0.5) * W) for tt, xx, _ in mono])
            y_terms += face_track._piecewise([(tt, (yy - 0.5) * H) for tt, _, yy in mono])
            windows.append((mono[0][0], mono[-1][0]))
    if not x_terms:
        return None
    merged: list[list[float]] = []
    for lo, hi in sorted(windows):
        if merged and lo <= merged[-1][1] + 1e-3:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    # gte*lt, like the position terms: at the very last instant of a stretch the terms are already 0
    enable = "+".join(f"gte(t,{face_track._n(lo)})*lt(t,{face_track._n(hi)})" for lo, hi in merged)
    return {"x": face_track._sum(x_terms), "y": face_track._sum(y_terms), "enable": enable, "visible_s": sum(h - l for l, h in merged)}
