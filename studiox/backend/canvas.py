"""Frame canvas: aspect ratio and a free scale/position/rotation transform of the video within it.

The editor stores this in `edit.canvas` (see backend/projects.py). It is the FIRST visual step of the
last render pass (render_service.compose_final), right after the colour grade, so every later filter
(zoom, split screen, headline, captions) already sees the final frame size and only has to draw on it.

The preview (frontend/js/canvasframe.js) draws the exact same box with CSS: the video's rendered
left/top/width/height is `cover`-fit into the container (like `max()` below), then a `scale`/`x`/`y`
on top of that, and a plain CSS `rotate()` for the rotation. That is why the maths here is expressed
around a "cover" baseline instead of ffmpeg's usual `force_original_aspect_ratio=decrease`.

Config
    ratio       original | 16:9 | 9:16 | 1:1 | 4:5 (the canvas' own shape; "original" keeps the
                source's own, so a transform can be used to reposition/zoom/rotate without reframing)
    background  "#rrggbb" that fills the canvas where the (possibly smaller or rotated) video doesn't
    transform   {scale, x, y, rotation}: scale multiplies the "cover" fit (1 = exactly fills the
                canvas, no bars); x/y move the video's centre by a fraction of the canvas size;
                rotation is in degrees, clockwise
"""
from __future__ import annotations

import math
import re
from typing import Any

RATIOS: dict[str, tuple[int, int] | None] = {
    "original": None, "16:9": (16, 9), "9:16": (9, 16), "1:1": (1, 1), "4:5": (4, 5),
}
LONG_SIDE = 1920   # matches backend/media_processor.render_size and the headline export
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _f(raw: Any, default: float, lo: float, hi: float) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return default
    if v != v:  # NaN
        return default
    return min(hi, max(lo, v))


def _even(n: float) -> int:
    return max(2, int(round(n)) // 2 * 2)


def sanitize_transform(raw: Any) -> dict[str, float]:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "scale": round(_f(raw.get("scale"), 1.0, 0.05, 8.0), 4),
        "x": round(_f(raw.get("x"), 0.0, -3.0, 3.0), 4),
        "y": round(_f(raw.get("y"), 0.0, -3.0, 3.0), 4),
        "rotation": round(_f(raw.get("rotation"), 0.0, -180.0, 180.0), 2),
    }


def sanitize_canvas(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    ratio = raw.get("ratio")
    if ratio not in RATIOS:
        ratio = "original"
    bg = raw.get("background")
    background = bg if isinstance(bg, str) and HEX_RE.match(bg) else "#000000"
    return {"ratio": ratio, "background": background, "transform": sanitize_transform(raw.get("transform"))}


def is_identity(transform: dict[str, float]) -> bool:
    return (abs(transform["scale"] - 1.0) < 1e-4 and abs(transform["x"]) < 1e-4
            and abs(transform["y"]) < 1e-4 and abs(transform["rotation"]) < 1e-4)


def target_size(cfg: dict[str, Any], src_w: int, src_h: int) -> tuple[int, int]:
    """The canvas' own width/height: the long side fixed at LONG_SIDE, like render.py itself does
    for the source. "original" keeps the source's own (even) size, unscaled."""
    r = RATIOS.get(cfg["ratio"])
    if r is None:
        return _even(src_w), _even(src_h)
    rw, rh = r
    if rh > rw:
        return _even(LONG_SIDE * rw / rh), LONG_SIDE
    return LONG_SIDE, _even(LONG_SIDE * rh / rw)


def is_active(cfg: dict[str, Any], src_w: int, src_h: int) -> bool:
    """False = nothing to draw: the render can skip this step entirely (the common case)."""
    if not is_identity(cfg["transform"]):
        return True
    return cfg["ratio"] != "original" and target_size(cfg, src_w, src_h) != (_even(src_w), _even(src_h))


def build_filter(last: str, out_label: str, src_w: int, src_h: int, cw: int, ch: int,
                 transform: dict[str, float], bg_input: str) -> str:
    """The chain that scales/rotates the source video onto a `bg_input`-filled cw x ch canvas.

    `bg_input` is the ffmpeg input label (e.g. "3:v") of a `color=c=...:s=cwxch` source the caller
    must add as an extra -i before this filter runs; a plain colour is infinite, so the caller also
    needs to bound the whole render to the video's length ("-t") once this step is used.
    """
    cover = max(cw / src_w, ch / src_h)
    scale = cover * transform["scale"]
    sw, sh = max(2, round(src_w * scale)), max(2, round(src_h * scale))
    cx, cy = cw / 2 + transform["x"] * cw, ch / 2 + transform["y"] * ch
    rot = transform["rotation"]

    parts = [f"[{bg_input}]format=yuv420p[cv_bg]"]
    if abs(rot) < 1e-4:
        ox, oy = round(cx - sw / 2), round(cy - sh / 2)
        parts.append(f"{last}scale={sw}:{sh}:flags=lanczos,setsar=1[cv_fg]")
    else:
        rad = math.radians(rot)
        bw = _even(abs(sw * math.cos(rad)) + abs(sh * math.sin(rad)))
        bh = _even(abs(sw * math.sin(rad)) + abs(sh * math.cos(rad)))
        ox, oy = round(cx - bw / 2), round(cy - bh / 2)
        parts.append(f"{last}scale={sw}:{sh}:flags=lanczos,setsar=1,format=yuva420p,"
                     f"rotate={rad:.6f}:ow={bw}:oh={bh}:c=none[cv_fg]")
    parts.append(f"[cv_bg][cv_fg]overlay={ox}:{oy}:format=auto[cv_ov]")
    parts.append(f"[cv_ov]format=yuv420p{out_label}")
    return ";".join(parts)
