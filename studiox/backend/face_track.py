"""Face tracking: a "follow cam" that keeps the speaker's face in the middle of the frame.

Two steps, like the rest of the editor's looks:
  1. analyze():  decodes the SOURCE video at SAMPLE_FPS, finds the faces with OpenCV's YuNet detector, follows one person
                 from frame to frame and stores where the face was (fractions of the frame, in source time) in
                 <project>/face_track.json. Done once per video.
  2. build_path(): turns those raw samples into a smooth camera path (a Gaussian low-pass, so the picture glides instead
                 of shaking). The browser preview (js/facetrack.js) asks for THIS path, and the render draws the same one,
                 so what the editor shows is what gets burned in.

The render draws it as a zoom + pan: the picture is scaled by `zoom` and laid over the frame so that the face lands on
(centre, anchor_y), never showing the edge of the picture. The pan is an ffmpeg expression of t (piecewise linear, one
term per segment, like the zoom feature of backend/looks.py) over the OUTPUT timeline of the cuts.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Callable

import numpy as np

MODEL_PATH = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"
TRACK_FILE = "face_track.json"
VERSION = 1

SAMPLE_FPS = 6            # detections per second of video
DETECT_WIDTH = 640        # the frame is analysed at this width
MIN_SCORE = 0.6           # YuNet confidence below this is not a face
MAX_GAP_S = 1.5           # a face lost for longer than this is looked for again from scratch (the biggest one wins)
RELOCK_SAMPLES = 8        # another face must stay "the biggest" this many samples in a row to take over the camera
JUMP = 0.18               # a move bigger than this (fraction of the frame) between two samples is a cut, not a pan
SMOOTH_SIGMA_S = (0.12, 1.1)   # Gaussian sigma in seconds for smooth = 0 .. 1
SIMPLIFY_TOL = 0.0015     # fraction of the frame: the render keeps only the points that matter within this error

DEFAULT_TRACK: dict[str, Any] = {
    "enabled": False,
    "mode": "all",         # all: every cut | ranges: only the stretches in `ranges`
    "ranges": [],          # [[start, end], ...] in SOURCE seconds (a cut counts when its middle falls inside one)
    "zoom": 1.35,          # how close the camera is (1 = no room to move)
    "smooth": 0.5,         # 0 = follows every move | 1 = slow, cinematic
    "anchor_y": 0.45,      # where the face sits vertically (0 = top edge, 1 = bottom edge); horizontally it is centred
    "seed": None,          # {"t", "x", "y"}: the person the user clicked on (source time + place on the frame); None = the biggest face
}
ZOOM_RANGE = (1.05, 2.5)
ANCHOR_RANGE = (0.25, 0.65)
MAX_RANGES = 400


class TrackError(RuntimeError):
    pass


def _num(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if x != x:
        return default
    return min(hi, max(lo, x))


def sanitize_track(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_TRACK)
    out["enabled"] = bool(raw.get("enabled", False))
    out["mode"] = raw.get("mode") if raw.get("mode") in ("all", "ranges") else "all"
    out["zoom"] = round(_num(raw.get("zoom"), *ZOOM_RANGE, DEFAULT_TRACK["zoom"]), 3)
    out["smooth"] = round(_num(raw.get("smooth"), 0.0, 1.0, DEFAULT_TRACK["smooth"]), 3)
    out["anchor_y"] = round(_num(raw.get("anchor_y"), *ANCHOR_RANGE, DEFAULT_TRACK["anchor_y"]), 3)
    ranges: list[list[float]] = []
    for r in (raw.get("ranges") or [])[:MAX_RANGES]:
        try:
            a, b = float(r[0]), float(r[1])
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        if a == a and b == b and b - a > 0.01:
            ranges.append([round(max(0.0, a), 3), round(b, 3)])
    out["ranges"] = ranges
    seed = raw.get("seed")
    if isinstance(seed, dict):
        t, x, y = (_num(seed.get(k), lo, hi, -1.0) for k, lo, hi in (("t", 0.0, 1e6), ("x", 0.0, 1.0), ("y", 0.0, 1.0)))
        if min(t, x, y) >= 0:
            out["seed"] = {"t": round(t, 3), "x": round(x, 4), "y": round(y, 4)}
    return out


def shared_constants() -> dict[str, Any]:
    """What the browser needs to build the same controls and the same camera (sent with the template catalog)."""
    return {"defaults": dict(DEFAULT_TRACK), "zoom": list(ZOOM_RANGE), "anchor_y": list(ANCHOR_RANGE),
            "sample_fps": SAMPLE_FPS}


def is_available() -> bool:
    try:
        import cv2  # noqa: F401
    except ImportError:
        return False
    return MODEL_PATH.exists()


# ----------------------------------------------------------------------------
# Analysis
# ----------------------------------------------------------------------------
def _probe(video: Path) -> tuple[int, int, float]:
    """Displayed width/height (phone clips carry a rotation flag) and the duration of the video stream."""
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0",
           "-show_entries", "stream=width,height,duration:stream_side_data=rotation:format=duration", "-of", "json", str(video)]
    try:
        data = json.loads(subprocess.run(cmd, capture_output=True, text=True, check=True).stdout)
    except (subprocess.CalledProcessError, ValueError, OSError) as exc:
        raise TrackError(f"Não consegui ler o vídeo: {exc}") from exc
    st = (data.get("streams") or [{}])[0]
    w, h = int(st.get("width") or 0), int(st.get("height") or 0)
    rotation = 0
    for side in st.get("side_data_list", []):
        if side.get("rotation") is not None:
            rotation = int(round(float(side["rotation"])))
    if rotation % 360 in (90, 270):
        w, h = h, w
    try:
        duration = float(st.get("duration") or (data.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    if w <= 0 or h <= 0:
        raise TrackError("O arquivo não tem imagem.")
    return w, h, duration


def _pick(faces: np.ndarray, prev: tuple[float, float, float] | None, since: float, state: dict) -> np.ndarray | None:
    """Which of this frame's faces is the person being followed. `faces` rows: cx, cy, h (fractions), score."""
    if len(faces) == 0:
        return None
    biggest = faces[int(np.argmax(faces[:, 2] * faces[:, 3]))]
    if prev is None or since > MAX_GAP_S:
        state["streak"] = 0
        return biggest
    px, py, ph = prev
    dist = np.hypot(faces[:, 0] - px, faces[:, 1] - py)
    near = dist <= max(0.12, 2.5 * ph)
    if near.any():
        state["streak"] = 0
        cand = np.flatnonzero(near)
        return faces[cand[int(np.argmin(dist[cand]))]]
    # Only far-away faces: probably someone else. Switch only if that stays true for a while.
    state["streak"] = state.get("streak", 0) + 1
    if state["streak"] >= RELOCK_SAMPLES:
        state["streak"] = 0
        return biggest
    return None


def analyze(video: Path, progress: Callable[[float], None] | None = None) -> dict[str, Any]:
    """Every face of the video, SAMPLE_FPS times a second: {"fps", "duration", "frames", "faces": [[t, [[cx, cy, h, score], ...]], ...]}
    (fractions of the frame; only the samples that have a face). Who is followed is decided later by follow()."""
    if not is_available():
        raise TrackError("O rastreador de rosto não está instalado (falta o OpenCV ou o modelo de detecção).")
    import cv2

    w, h, duration = _probe(video)
    dw = min(DETECT_WIDTH, w)
    dh = max(2, int(round(dw * h / w / 2)) * 2)
    detector = cv2.FaceDetectorYN.create(str(MODEL_PATH), "", (dw, dh), MIN_SCORE, 0.3, 20)
    cmd = ["ffmpeg", "-v", "error", "-i", str(video), "-an", "-vf", f"fps={SAMPLE_FPS},scale={dw}:{dh}",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    frame_bytes = dw * dh * 3
    expected = max(1.0, duration * SAMPLE_FPS)
    faces_out: list[list[Any]] = []
    n = 0
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError as exc:
        raise TrackError(f"Não consegui abrir o ffmpeg: {exc}") from exc
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape(dh, dw, 3)
            t = n / SAMPLE_FPS
            n += 1
            _, found = detector.detect(frame)
            if found is not None and len(found):
                rows = [[round(float((f[0] + f[2] / 2) / dw), 4), round(float((f[1] + f[3] / 2) / dh), 4), round(float(f[3] / dh), 4), round(float(f[14]), 3)]
                        for f in found]
                faces_out.append([round(t, 3), rows])
            if progress and n % 12 == 0:
                progress(min(0.99, n / expected))
    finally:
        proc.stdout.close()
        proc.terminate()
        proc.wait()
    if n == 0:
        raise TrackError("Não consegui ler nenhum quadro do vídeo.")
    return {"version": VERSION, "fps": SAMPLE_FPS, "duration": round(max(duration, n / SAMPLE_FPS), 3),
            "frames": n, "faces": faces_out}


def faces_near(data: dict[str, Any], t: float) -> list[list[float]]:
    """The faces of the sample closest to time t (within half a second): [[cx, cy, h, score], ...]."""
    frames = data.get("faces") or []
    if not frames:
        return []
    times = np.array([f[0] for f in frames])
    i = int(np.argmin(np.abs(times - t)))
    return frames[i][1] if abs(times[i] - t) <= 0.5 else []


def follow(data: dict[str, Any], seed: dict[str, float] | None = None) -> list[list[float]]:
    """The positions of ONE person: [[t, cx, cy, h], ...] in time order.
    seed = {"t", "x", "y"}: the person the user pointed at (a click on the picture at source time t); the camera follows
    them forwards and backwards from there. Without a seed it starts on the biggest face of the first sample that has one.
    A face that stays lost for a while, or another face that stays closer to the camera for a while, makes it look again."""
    frames = data.get("faces") or []
    if not frames:
        return []
    arrays = [np.array(f[1], dtype=np.float64).reshape(-1, 4) for f in frames]
    times = [float(f[0]) for f in frames]

    start = 0
    first: np.ndarray | None = None
    if seed:
        k = int(np.argmin([abs(t - seed["t"]) for t in times]))
        if abs(times[k] - seed["t"]) <= 1.0:
            d = np.hypot(arrays[k][:, 0] - seed["x"], arrays[k][:, 1] - seed["y"])
            j = int(np.argmin(d))
            if d[j] <= max(0.15, 1.5 * arrays[k][j, 2]):
                start, first = k, arrays[k][j]
    seeded = first is not None
    if first is None:
        arr = arrays[0]
        first = arr[int(np.argmax(arr[:, 2] * arr[:, 3]))]

    def walk(order: range) -> list[list[float]]:
        out: list[list[float]] = []
        prev: tuple[float, float, float] | None = None
        prev_t = 0.0
        state: dict[str, Any] = {}
        for i in order:
            if i == start:
                chosen = first
            else:
                chosen = _pick(arrays[i], prev, abs(times[i] - prev_t), state)
            if chosen is not None:
                prev, prev_t = (float(chosen[0]), float(chosen[1]), float(chosen[2])), times[i]
                out.append([times[i], prev[0], prev[1], prev[2]])
        return out

    forward = walk(range(start, len(frames)))
    backward = walk(range(start, -1, -1))[1:] if seeded else []
    return backward[::-1] + forward


def save(project_dir: Path, data: dict[str, Any]) -> None:
    tmp = project_dir / (TRACK_FILE + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    tmp.replace(project_dir / TRACK_FILE)


def load(project_dir: Path) -> dict[str, Any] | None:
    try:
        data = json.loads((project_dir / TRACK_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("version") == VERSION and data.get("faces") else None


# ----------------------------------------------------------------------------
# The camera path
# ----------------------------------------------------------------------------
def build_path(data: dict[str, Any], smooth: float, seed: dict[str, float] | None = None) -> dict[str, Any] | None:
    """The smoothed camera for the person `follow(data, seed)` finds: {"fps", "coverage", "t": [...], "x": [...], "y": [...]} on a uniform grid (fractions of the
    frame). Gaps are bridged by interpolating between the last and the next detection, so the camera keeps moving
    on instead of snapping back; before the first and after the last detection it holds still. None when no face
    was ever found."""
    raw = follow(data, seed)
    if not raw:
        return None
    fps = float(data.get("fps") or SAMPLE_FPS)
    n = max(int(data.get("frames") or 0), int(round(float(raw[-1][0]) * fps)) + 1)
    idx = np.array([int(round(s[0] * fps)) for s in raw])
    xs = np.array([s[1] for s in raw])
    ys = np.array([s[2] for s in raw])
    grid = np.arange(n)
    x = np.interp(grid, idx, xs)
    y = np.interp(grid, idx, ys)

    # A big move between two neighbouring detections is a cut (or another person), not a pan: smooth each side alone
    cuts = [0]
    for k in range(1, len(idx)):
        if idx[k] - idx[k - 1] <= 2 and np.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]) > JUMP:
            cuts.append(int(idx[k]))
    cuts.append(n)
    sigma = (SMOOTH_SIGMA_S[0] + (SMOOTH_SIGMA_S[1] - SMOOTH_SIGMA_S[0]) * min(1.0, max(0.0, smooth))) * fps
    out_x, out_y = x.copy(), y.copy()
    for a, b in zip(cuts, cuts[1:]):
        if b - a >= 2:
            out_x[a:b], out_y[a:b] = _gauss(x[a:b], sigma), _gauss(y[a:b], sigma)
    return {"fps": fps, "coverage": round(len(raw) / max(1, n), 3),
            "t": [round(float(i) / fps, 4) for i in grid],
            "x": [round(float(v), 4) for v in out_x], "y": [round(float(v), 4) for v in out_y]}


def _gauss(v: np.ndarray, sigma: float) -> np.ndarray:
    if sigma < 0.3 or len(v) < 3:
        return v
    r = max(1, int(round(sigma * 3)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    padded = np.pad(v, r, mode="edge")
    return np.convolve(padded, k, mode="valid")


def at(path: dict[str, Any], t: float) -> tuple[float, float]:
    """Camera target (fx, fy) at source time t (the reference the expression and the preview are tested against)."""
    return float(np.interp(t, path["t"], path["x"])), float(np.interp(t, path["t"], path["y"]))


# ----------------------------------------------------------------------------
# What the render draws
# ----------------------------------------------------------------------------
def _n(x: float) -> str:
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def clip_is_active(cfg: dict[str, Any], start: float, end: float) -> bool:
    if not cfg["enabled"]:
        return False
    if cfg["mode"] == "all":
        return True
    mid = (start + end) / 2
    return any(a <= mid <= b for a, b in cfg["ranges"])


def _simplify(pts: list[tuple[float, float, float]], tol: float) -> list[tuple[float, float, float]]:
    """Ramer-Douglas-Peucker on (t, x, y): drops the points a straight line between their neighbours explains."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ta, xa, ya = pts[a]
        tb, xb, yb = pts[b]
        worst, at_i = 0.0, -1
        for i in range(a + 1, b):
            u = (pts[i][0] - ta) / (tb - ta) if tb > ta else 0.0
            err = max(abs(pts[i][1] - (xa + (xb - xa) * u)), abs(pts[i][2] - (ya + (yb - ya) * u)))
            if err > worst:
                worst, at_i = err, i
        if worst > tol and at_i > 0:
            keep[at_i] = True
            stack += [(a, at_i), (at_i, b)]
    return [p for p, k in zip(pts, keep) if k]


SUM_WIDTH = 24   # ffmpeg's expression parser gives up on a flat sum of ~100 terms ("Missing ')' or too many args")


def _sum(terms: list[str]) -> str:
    """The terms added up, as nested groups of at most SUM_WIDTH: a long video has hundreds of segments, which as one
    flat sum made the render fail (a 12-cut reel already has ~170 terms)."""
    while len(terms) > SUM_WIDTH:
        terms = ["(" + "+".join(terms[i:i + SUM_WIDTH]) + ")" for i in range(0, len(terms), SUM_WIDTH)]
    return "+".join(terms)


def _piecewise(points: list[tuple[float, float]], end: float | None = None) -> list[str]:
    """Terms (to be summed) of the linear interpolation through `points` [(t, v)]; each term is zero outside its segment."""
    terms = []
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t1 - t0 < 1e-4:
            continue
        slope = (v1 - v0) / (t1 - t0)
        terms.append(f"gte(t,{_n(t0)})*lt(t,{_n(t1)})*({_n(v0)}+({_n(slope)})*(t-{_n(t0)}))")
    return terms


def plan(cfg: dict[str, Any], path: dict[str, Any], ranges: list[dict], lens: list[float], start_time: float,
         edge: float) -> dict[str, Any] | None:
    """The follow cam over the cut video. `ranges` = the EDL ranges (source start/end), `lens` the MEASURED length of every
    clip in the render, `start_time` the start_time of that video. Returns None when no clip is followed.
    {"zoom", "anchor_y", "x_expr", "y_expr", "zoom_expr" (None = the same zoom all the way), "active"}."""
    if not cfg["enabled"] or not ranges or len(ranges) != len(lens):
        return None
    starts, acc = [], start_time
    for d in lens:
        starts.append(acc)
        acc += d
    active = [clip_is_active(cfg, float(r["start"]), float(r["end"])) for r in ranges]
    if not any(active):
        return None

    src_t = np.asarray(path["t"])
    src_x, src_y = np.asarray(path["x"]), np.asarray(path["y"])
    x_terms: list[str] = []
    y_terms: list[str] = []
    windows: list[tuple[float, float]] = []
    last = len(ranges) - 1
    for i, r in enumerate(ranges):
        if not active[i]:
            continue
        lo = starts[i] - edge
        hi = (starts[i + 1] - edge) if i < last else starts[i] + lens[i] + 1.0
        windows.append((lo, hi))
        s, e = float(r["start"]), float(r["end"])
        inside = (src_t > s) & (src_t < e)
        src = [s, *src_t[inside].tolist(), e]
        pts = [(starts[i] + (t - s), float(np.interp(t, src_t, src_x)), float(np.interp(t, src_t, src_y))) for t in src]
        pts = _simplify(pts, SIMPLIFY_TOL)
        pts = [(lo, pts[0][1], pts[0][2]), *pts[1:-1], (hi, pts[-1][1], pts[-1][2])]   # hold the ends up to the clip's window
        mono = [pts[0]]
        for p in pts[1:]:
            if p[0] > mono[-1][0] + 1e-4:
                mono.append(p)
        if len(mono) < 2:
            continue
        x_terms += _piecewise([(t, x) for t, x, _ in mono])
        y_terms += _piecewise([(t, y) for t, _, y in mono])
    if not x_terms:
        return None

    merged: list[list[float]] = []   # neighbouring clips share one gate
    for lo, hi in windows:
        if merged and abs(merged[-1][1] - lo) < 1e-3:
            merged[-1][1] = hi
        else:
            merged.append([lo, hi])
    everywhere = all(active)
    zoom = cfg["zoom"]
    gate = None if everywhere else _sum([f"gte(t,{_n(lo)})*lt(t,{_n(hi)})" for lo, hi in merged])
    zoom_expr = None if everywhere else "1+(" + _n(zoom - 1) + ")*(" + gate + ")"
    return {"zoom": zoom, "anchor_y": cfg["anchor_y"], "x_expr": _sum(x_terms), "y_expr": _sum(y_terms),
            "zoom_expr": zoom_expr, "gate_expr": gate, "active": sum(active)}


def _even(n: float) -> int:
    return max(2, int(round(n)) // 2 * 2)


def parts(last: str, p: dict[str, Any], tag: str = "k", src: tuple[int, int] | None = None,
          frame: tuple[int, int] | None = None) -> tuple[list[str], str]:
    """Filter-graph pieces: [last] -> the picture scaled up and panned so the face stays on (centre, anchor_y).

    `src` = size of the input, `frame` = size of the picture to produce. When they differ (a new aspect ratio, e.g. a
    horizontal video in a 9:16 frame) the input is first scaled to COVER the frame, and the camera pans that wider
    picture inside the frame, so the face stays in the middle of what is actually shown. Without them the output has the
    input's own size, as before."""
    dynamic = p["zoom_expr"] is not None
    z = p["zoom_expr"] if dynamic else _n(p["zoom"])
    scale = f"scale=w='trunc(iw*({z})/2)*2':h=-2" + (":eval=frame" if dynamic else "")
    x = f"min(0,max(W-w,W*0.5-w*({p['x_expr']})))"
    y = f"min(0,max(H-h,H*{_n(p['anchor_y'])}-h*({p['y_expr']})))"
    gate = p.get("gate_expr")
    if gate:   # clips the camera does not follow keep the picture centred in the frame
        x = f"if(gt({gate},0.5),{x},(W-w)/2)"
        y = f"if(gt({gate},0.5),{y},(H-h)/2)"
    if not (src and frame and tuple(src) != tuple(frame)):
        return [
            f"{last}split[{tag}b][{tag}s]",
            f"[{tag}s]{scale}[{tag}z]",
            f"[{tag}b][{tag}z]overlay=x='{x}':y='{y}':eval=frame,format=yuv420p[{tag}o]",
        ], f"[{tag}o]"
    sw, sh = src
    cw, ch = frame
    cover = max(cw / sw, ch / sh)
    bw, bh = max(cw, _even(sw * cover)), max(ch, _even(sh * cover))
    return [
        f"{last}scale={bw}:{bh}:flags=lanczos,setsar=1,split[{tag}c][{tag}s]",
        f"[{tag}c]crop={cw}:{ch}[{tag}b]",
        f"[{tag}s]{scale}[{tag}z]",
        f"[{tag}b][{tag}z]overlay=x='{x}':y='{y}':eval=frame,format=yuv420p[{tag}o]",
    ], f"[{tag}o]"
