"""Headline model shared by the live preview (frontend/js/headlines.js) and the render.

The headline is drawn ONCE, in the browser, on a <canvas>: the very same drawing code
paints the live preview and the transparent PNG that goes into the render, so they can
not drift apart (fonts, emoji, wrapping, shadows all come from the browser). The server
only has to place that PNG over the video with the chosen entrance/exit animation.

Style values are expressed in "reference pixels": the video's SHORT side is always 1080.
"""
from __future__ import annotations

import base64
import binascii
import io
import re
from typing import Any

REF_SHORT_SIDE = 1080
SLIDE_DISTANCE_REF = 64      # slide animations travel this many reference pixels
MAX_IMAGE_BYTES = 24 * 1024 * 1024
ANIMATIONS = ("none", "fade", "slide_up", "slide_down", "slide_left", "slide_right")

DEFAULT_STYLE: dict[str, Any] = {
    "font_family": "Montserrat",
    "font_weight": 800,
    "italic": False,
    "font_size": 64,             # reference px (em size, same meaning as CSS font-size)
    "uppercase": True,
    "letter_spacing": 0.0,
    "line_height": 1.15,         # multiple of the font size
    "text_align": "left",        # left | center | right
    "text_color": "#FFFFFF",
    "highlight_color": "#FFE600",  # words wrapped in *asterisks* use this colour
    "outline_width": 0.0,
    "outline_color": "#000000",
    "box_enabled": True,
    "box_color": "#0F172A",
    "box_opacity": 0.92,
    "box_padding_x": 40.0,
    "box_padding_y": 30.0,
    "box_radius": 28.0,
    "border_width": 4.0,
    "border_color": "#FF5A00",
    "accent_style": "none",      # none | bar (left edge) | underline
    "accent_color": "#FF5A00",
    "accent_width": 10.0,
    "tag_size": 30.0,
    "tag_text_color": "#FFFFFF",
    "tag_bg_color": "#FF5A00",
    "tag_radius": 12.0,
    "tag_uppercase": True,
    "shadow_distance": 0.0,      # drop shadow of the card (or of the text when there is no card)
    "shadow_blur": 24.0,
    "shadow_color": "#000000",
    "shadow_opacity": 0.5,
    "width_mode": "fit",         # fit (hugs the text) | full (always max_width)
    "max_width": 0.88,           # fraction of the frame width
    "position_x": 0.5,           # block centre, fraction of the frame (0 = left / top)
    "position_y": 0.14,
    "animation": "slide_down",
    "anim_duration": 0.4,
}


# Same limits as HeadlineStyle.LIMITS in the frontend
_RANGES: dict[str, tuple[float, float]] = {
    "font_weight": (100, 900), "font_size": (20, 260), "letter_spacing": (-10, 40), "line_height": (0.8, 2.2),
    "outline_width": (0, 40), "box_opacity": (0, 1), "box_padding_x": (0, 160), "box_padding_y": (0, 160),
    "box_radius": (0, 999), "border_width": (0, 24), "accent_width": (2, 60), "tag_size": (12, 90),
    "tag_radius": (0, 999), "shadow_distance": (0, 40), "shadow_blur": (0, 80), "shadow_opacity": (0, 1),
    "max_width": (0.3, 1), "position_x": (0, 1), "position_y": (0, 1), "anim_duration": (0.05, 2),
}
_ENUMS: dict[str, tuple[str, ...]] = {
    "text_align": ("left", "center", "right"),
    "accent_style": ("none", "bar", "underline"),
    "width_mode": ("fit", "full"),
    "animation": ANIMATIONS,
}
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def sanitize_style(raw: dict | None) -> dict[str, Any]:
    """Merges a client-provided headline style over the defaults, coercing and clamping every field."""
    style = dict(DEFAULT_STYLE)
    raw = raw if isinstance(raw, dict) else {}
    for key, default in DEFAULT_STYLE.items():
        val = raw.get(key)
        if val is None:
            continue
        try:
            if isinstance(default, bool):
                style[key] = bool(val)
            elif key.endswith("_color"):
                if isinstance(val, str) and _HEX_RE.match(val.strip()):
                    style[key] = val.strip().upper()
            elif key in _ENUMS:
                if val in _ENUMS[key]:
                    style[key] = val
            elif isinstance(default, str):
                style[key] = str(val).strip()[:120] or default
            else:
                style[key] = type(default)(float(val))
        except (TypeError, ValueError):
            continue
        if key in _RANGES and not isinstance(style[key], (str, bool)):
            lo, hi = _RANGES[key]
            style[key] = type(default)(min(hi, max(lo, style[key])))
    style["font_weight"] = int(round(style["font_weight"] / 100) * 100)
    return style


# ----------------------------------------------------------------------------
# Render request
# ----------------------------------------------------------------------------
def _num(raw: Any, default: float, lo: float, hi: float) -> float:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return default
    if val != val:  # NaN
        return default
    return min(hi, max(lo, val))


def parse_headline_request(cfg: dict | None) -> dict[str, Any] | None:
    """Validates the headline block of a render request.

    Returns None when there is nothing to draw; raises ValueError with a user-facing
    message when the request asks for a headline but the data is unusable.
    """
    if not cfg or not cfg.get("enabled"):
        return None

    image = cfg.get("image")
    if not image or not isinstance(image, str):
        raise ValueError(
            "o editor não enviou a imagem do headline. Recarregue a página com Ctrl+F5 "
            "(a versão do editor no navegador está desatualizada)."
        )
    if image.startswith("data:"):
        image = image.split(",", 1)[-1]
    try:
        png = base64.b64decode(image, validate=False)
    except (binascii.Error, ValueError):
        raise ValueError("imagem do headline inválida (base64).")
    if len(png) > MAX_IMAGE_BYTES:
        raise ValueError("imagem do headline grande demais.")

    from PIL import Image  # pillow is already a dependency of the project
    try:
        with Image.open(io.BytesIO(png)) as im:
            im.load()
            width, height = im.size
    except Exception:
        raise ValueError("a imagem do headline não é um PNG válido.")

    animation = cfg.get("animation") if cfg.get("animation") in ANIMATIONS else "none"
    duration = _num(cfg.get("duration"), 4.0, 0.5, 60.0)
    anim = _num(cfg.get("anim_duration"), 0.4, 0.05, 2.0)
    anim = min(anim, duration / 2)  # entrance and exit must fit in the time on screen

    return {
        "png": png,
        "width": width,
        "height": height,
        "start": _num(cfg.get("start"), 0.0, 0.0, 36000.0),
        "duration": duration,
        "animation": animation,
        "anim_duration": anim,
    }


# ----------------------------------------------------------------------------
# ffmpeg
# ----------------------------------------------------------------------------
def _f(x: float) -> str:
    return f"{x:.4f}".rstrip("0").rstrip(".") or "0"


def headline_filters(spec: dict[str, Any], video_w: int, video_h: int, input_label: str = "1:v") -> tuple[str, str, str]:
    """Filter pieces that put the headline PNG over the video.

    Returns (image_chain, overlay_options, enable) where
      image_chain     -> "[1:v]...[hl]"  (fades + timeline shift of the still image)
      overlay_options -> "x='..':y='..'" (slide animation, evaluated per frame)
      enable          -> "between(t,S,E)"
    The maths matches HeadlineStyle.animAt() in the frontend: linear fade, cubic ease
    on the slide, entrance and exit mirrored.
    """
    start, dur, anim = spec["start"], spec["duration"], spec["anim_duration"]
    end = start + dur
    kind = spec["animation"]

    chain = [f"[{input_label}]format=rgba"]
    if (spec["width"], spec["height"]) != (video_w, video_h):
        chain.append(f"scale={video_w}:{video_h}:flags=lanczos")
    if kind != "none":
        chain.append(f"fade=t=in:st=0:d={_f(anim)}:alpha=1")
        chain.append(f"fade=t=out:st={_f(dur - anim)}:d={_f(anim)}:alpha=1")
    chain.append(f"setpts=PTS-STARTPTS+{_f(start)}/TB[hl]")

    x_expr = y_expr = "0"
    if kind.startswith("slide_"):
        dist = SLIDE_DISTANCE_REF * min(video_w, video_h) / REF_SHORT_SIDE
        p_in = f"clip((t-{_f(start)})/{_f(anim)},0,1)"
        p_out = f"clip((t-{_f(end - anim)})/{_f(anim)},0,1)"
        travel = f"{_f(dist)}*(pow(1-{p_in},3)+pow({p_out},3))"
        # slide_up rises from below (+y), slide_left comes in from the right (+x)
        sign = {"slide_up": ("y", 1), "slide_down": ("y", -1), "slide_left": ("x", 1), "slide_right": ("x", -1)}[kind]
        expr = travel if sign[1] > 0 else f"-{travel}"
        if sign[0] == "y":
            y_expr = expr
        else:
            x_expr = expr

    return ",".join(chain), f"x='{x_expr}':y='{y_expr}'", f"between(t,{_f(start)},{_f(end)})"
