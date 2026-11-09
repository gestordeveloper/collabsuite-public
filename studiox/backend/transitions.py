"""Transitions between cuts.

A transition here is an effect drawn AROUND the cut, not a crossfade of two overlapping clips: the video keeps
exactly the same length, so the subtitles, the headline, the music and the split-screen scenes (all timed on the
output timeline) stay in sync. The sound is never touched (the micro-fades of render.py already keep the cuts free
of pops).

Each transition is a list of effects ("fx"), all measured from the cut time T:
    veil    black/white pulse:  pre seconds fading in before T, post seconds fading out after it
    still   the last frame of the previous clip stays over the new clip from T to T+dur, then fades ("fade") or
            slides away ("slide", towards `dir`: left/right/up/down, with `blur` px of motion blur)
    zoom    the new clip starts `amount` zoomed in and settles to 1x over `dur` seconds
    rgb     RGB channel split (`amount` = fraction of the width) from T-pre to T+post
    blur    gaussian blur pulse (`sigma` px on a 1080 px frame) from T-pre to T+post
    overlay a video/image the user imported (backend/transition_library.py) drawn over the cut for `dur` seconds,
            placed by `align` (start | center | end of the cut), keyed by `mode` (alpha | screen | green)

A transition can be one of the ready-made ones below or one the user built (stored in the library, with its own
`fx`). On top of the picture, every cut can play a sound (backend/sfx.py): the video's own, a default for all the
cuts, or one chosen for a single cut. `resolve_cuts` turns all of that into one plan per cut.

These parameters are the single source of truth: backend/looks.py turns them into ffmpeg filters and js/fx.js draws
the same effects in the preview, so an edit here changes both. The user can stretch every duration with
`transition_scale`.
"""
from __future__ import annotations

import re
from typing import Any, Callable

DEFAULT_ID = "micro_fade_30ms"
SCALE_RANGE = (0.5, 2.0)
MIN_SPAN = 0.02   # seconds: shorter than this is not an effect, it is a glitch of the maths

TRANSITIONS: list[dict[str, Any]] = [
    {"id": "micro_fade_30ms", "name": "Corte seco (padrão)", "icon": "⚡", "recommended": True, "duration": 0.03,
     "description": "Sem efeito visual: corte direto com micro-fade de 30 ms no áudio, sem estalos e sem custo de render.",
     "fx": []},
    {"id": "cross_dissolve", "name": "Fusão (dissolve)", "icon": "🌊", "recommended": False, "duration": 0.4,
     "description": "O último quadro do clipe anterior se dissolve sobre o novo: suaviza o salto entre dois takes.",
     "fx": [{"type": "still", "mode": "fade", "dur": 0.4}]},
    {"id": "dip_black", "name": "Fade para preto", "icon": "🌑", "recommended": False, "duration": 0.3,
     "description": "A imagem escurece até o preto no corte e volta: marca uma mudança de assunto ou de cena.",
     "fx": [{"type": "veil", "color": "black", "pre": 0.15, "post": 0.15}]},
    {"id": "dip_white", "name": "Flash branco", "icon": "✨", "recommended": False, "duration": 0.24,
     "description": "Clarão branco rápido no corte: energia alta, muito usado em vídeos de ritmo acelerado.",
     "fx": [{"type": "veil", "color": "white", "pre": 0.07, "post": 0.17}]},
    {"id": "whip_slide", "name": "Whip lateral", "icon": "⏩", "recommended": False, "duration": 0.28,
     "description": "O clipe anterior é varrido para a esquerda, borrado pela velocidade, revelando o novo.",
     "fx": [{"type": "still", "mode": "slide", "dir": "left", "dur": 0.28, "blur": 26}]},
    {"id": "slide_up", "name": "Deslize para cima", "icon": "⬆️", "recommended": False, "duration": 0.32,
     "description": "O clipe anterior sobe e sai da tela, como virar a página de um stories.",
     "fx": [{"type": "still", "mode": "slide", "dir": "up", "dur": 0.32, "blur": 14}]},
    {"id": "zoom_punch", "name": "Zoom de impacto", "icon": "🔍", "recommended": False, "duration": 0.32,
     "description": "O novo clipe entra 30% ampliado e assenta em 1x: dá um soco de energia a cada corte.",
     "fx": [{"type": "zoom", "amount": 0.3, "dur": 0.32}]},
    {"id": "flash_zoom", "name": "Flash com zoom", "icon": "💥", "recommended": False, "duration": 0.3,
     "description": "Clarão branco curto somado a um zoom de impacto: o combo mais agressivo, para hooks e batidas.",
     "fx": [{"type": "veil", "color": "white", "pre": 0.04, "post": 0.14}, {"type": "zoom", "amount": 0.2, "dur": 0.3}]},
    {"id": "glitch_rgb", "name": "Glitch RGB", "icon": "📺", "recommended": False, "duration": 0.21,
     "description": "As cores se separam por um instante no corte, como sinal de TV falhando. Bom para tech e gaming.",
     "fx": [{"type": "rgb", "amount": 0.018, "pre": 0.05, "post": 0.16}]},
    {"id": "blur_dip", "name": "Desfoque", "icon": "🌫️", "recommended": False, "duration": 0.4,
     "description": "A imagem desfoca até o corte e volta a focar: transição suave e elegante entre takes.",
     "fx": [{"type": "blur", "sigma": 14, "pre": 0.2, "post": 0.2}]},
    {"id": "whip_right", "name": "Whip para a direita", "icon": "⏪", "recommended": False, "duration": 0.28,
     "description": "O clipe anterior é varrido para a direita, borrado pela velocidade.",
     "fx": [{"type": "still", "mode": "slide", "dir": "right", "dur": 0.28, "blur": 26}]},
    {"id": "slide_down", "name": "Deslize para baixo", "icon": "⬇️", "recommended": False, "duration": 0.32,
     "description": "O clipe anterior desce e sai da tela, revelando o novo por cima.",
     "fx": [{"type": "still", "mode": "slide", "dir": "down", "dur": 0.32, "blur": 14}]},
    {"id": "dissolve_long", "name": "Fusão lenta", "icon": "🌅", "recommended": False, "duration": 0.8,
     "description": "Dissolve longo e suave: bom para trocas de cena calmas.",
     "fx": [{"type": "still", "mode": "fade", "dur": 0.8}]},
    {"id": "dip_black_slow", "name": "Fade preto lento", "icon": "🎬", "recommended": False, "duration": 0.7,
     "description": "A imagem some no preto devagar e volta: fim de cena ou capítulo.",
     "fx": [{"type": "veil", "color": "black", "pre": 0.35, "post": 0.35}]},
    {"id": "zoom_soft", "name": "Zoom suave", "icon": "🔎", "recommended": False, "duration": 0.5,
     "description": "O novo clipe entra levemente ampliado e assenta devagar.",
     "fx": [{"type": "zoom", "amount": 0.12, "dur": 0.5}]},
    {"id": "glitch_flash", "name": "Glitch com flash", "icon": "⚡", "recommended": False, "duration": 0.25,
     "description": "Cores se separam e um clarão rápido estoura no corte.",
     "fx": [{"type": "rgb", "amount": 0.03, "pre": 0.05, "post": 0.18}, {"type": "veil", "color": "white", "pre": 0.03, "post": 0.1}]},
    {"id": "blur_zoom", "name": "Desfoque com zoom", "icon": "🌀", "recommended": False, "duration": 0.4,
     "description": "A imagem desfoca até o corte e o novo clipe entra ampliado, focando.",
     "fx": [{"type": "blur", "sigma": 16, "pre": 0.15, "post": 0.25}, {"type": "zoom", "amount": 0.15, "dur": 0.4}]},
    {"id": "whip_blur_zoom", "name": "Whip com zoom", "icon": "🌪️", "recommended": False, "duration": 0.3,
     "description": "Varre o clipe anterior para a esquerda e o novo entra com impacto.",
     "fx": [{"type": "still", "mode": "slide", "dir": "left", "dur": 0.3, "blur": 30}, {"type": "zoom", "amount": 0.2, "dur": 0.3}]},
    {"id": "strobe_white", "name": "Flash com glitch", "icon": "💡", "recommended": False, "duration": 0.3,
     "description": "Clarão forte com uma leve separação de cores: energia máxima para batidas.",
     "fx": [{"type": "veil", "color": "white", "pre": 0.1, "post": 0.2}, {"type": "rgb", "amount": 0.012, "pre": 0.03, "post": 0.1}]},
]

BY_ID: dict[str, dict[str, Any]] = {t["id"]: t for t in TRANSITIONS}


# ----------------------------------------------------------------------------
# The user's own transitions (backend/transition_library.py registers itself here)
# ----------------------------------------------------------------------------
_custom_lookup: Callable[[str], dict[str, Any] | None] = lambda _tid: None
_custom_list: Callable[[], list[dict[str, Any]]] = lambda: []


def register_library(lookup: Callable[[str], dict[str, Any] | None], listing: Callable[[], list[dict[str, Any]]]) -> None:
    global _custom_lookup, _custom_list
    _custom_lookup, _custom_list = lookup, listing


def get(transition_id: Any) -> dict[str, Any] | None:
    if not isinstance(transition_id, str):
        return None
    return BY_ID.get(transition_id) or _custom_lookup(transition_id)


def all_transitions() -> list[dict[str, Any]]:
    """The ready-made transitions followed by the user's own."""
    return [*TRANSITIONS, *_custom_list()]


def is_known(transition_id: Any) -> bool:
    return get(transition_id) is not None


def sanitize_id(transition_id: Any) -> str:
    return transition_id if is_known(transition_id) else DEFAULT_ID


def sanitize_scale(raw: Any) -> float:
    """How much to stretch (>1) or shorten (<1) the effect's durations."""
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return 1.0
    if v != v:
        return 1.0
    return round(min(SCALE_RANGE[1], max(SCALE_RANGE[0], v)), 3)


def effects(transition_id: str, scale: float = 1.0) -> list[dict[str, Any]]:
    """The effects of a transition with every duration multiplied by `scale` (an imported overlay keeps its own length)."""
    out = []
    for fx in (get(sanitize_id(transition_id)) or BY_ID[DEFAULT_ID])["fx"]:
        fx = dict(fx)
        if fx.get("type") != "overlay":
            for key in ("pre", "post", "dur"):
                if key in fx:
                    fx[key] = round(max(MIN_SPAN, fx[key] * scale), 4)
        out.append(fx)
    return out


# ----------------------------------------------------------------------------
# Validation of what the user builds
# ----------------------------------------------------------------------------
FX_TYPES = ("veil", "still", "zoom", "rgb", "blur", "overlay")
MAX_FX = 6
MEDIA_ID_RE = re.compile(r"^[a-z0-9_]{1,60}$")
OVERLAY_MODES = ("alpha", "screen", "green")
OVERLAY_ALIGN = ("start", "center", "end")
OVERLAY_MAX_DUR = 6.0


def _num(raw: Any, lo: float, hi: float, default: float) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return default
    if v != v:
        return default
    return round(min(hi, max(lo, v)), 4)


def sanitize_fx(raw: Any) -> dict[str, Any] | None:
    """One effect from the browser, clamped to what the render and the preview can draw. None = not an effect."""
    if not isinstance(raw, dict) or raw.get("type") not in FX_TYPES:
        return None
    kind = raw["type"]
    if kind == "veil":
        return {"type": "veil", "color": "white" if raw.get("color") == "white" else "black",
                "pre": _num(raw.get("pre"), 0.0, 1.5, 0.15), "post": _num(raw.get("post"), 0.0, 1.5, 0.15)}
    if kind == "still":
        mode = "slide" if raw.get("mode") == "slide" else "fade"
        out: dict[str, Any] = {"type": "still", "mode": mode, "dur": _num(raw.get("dur"), 0.05, 2.0, 0.3)}
        if mode == "slide":
            out["dir"] = raw.get("dir") if raw.get("dir") in ("left", "right", "up", "down") else "left"
            out["blur"] = _num(raw.get("blur"), 0.0, 60.0, 20.0)
        return out
    if kind == "zoom":
        return {"type": "zoom", "amount": _num(raw.get("amount"), 0.02, 1.0, 0.25), "dur": _num(raw.get("dur"), 0.05, 1.5, 0.3)}
    if kind == "rgb":
        return {"type": "rgb", "amount": _num(raw.get("amount"), 0.002, 0.08, 0.02),
                "pre": _num(raw.get("pre"), 0.0, 1.0, 0.05), "post": _num(raw.get("post"), 0.0, 1.0, 0.15)}
    if kind == "blur":
        return {"type": "blur", "sigma": _num(raw.get("sigma"), 1.0, 40.0, 14.0),
                "pre": _num(raw.get("pre"), 0.0, 1.0, 0.2), "post": _num(raw.get("post"), 0.0, 1.0, 0.2)}
    media = raw.get("media")
    if not isinstance(media, str) or not MEDIA_ID_RE.match(media):
        return None
    return {"type": "overlay", "media": media, "mode": raw.get("mode") if raw.get("mode") in OVERLAY_MODES else "alpha",
            "dur": _num(raw.get("dur"), 0.1, OVERLAY_MAX_DUR, 1.0),
            "align": raw.get("align") if raw.get("align") in OVERLAY_ALIGN else "center",
            "fade": _num(raw.get("fade"), 0.0, 1.0, 0.0)}


def sanitize_fx_list(raw: Any) -> list[dict[str, Any]]:
    out = []
    for item in (raw if isinstance(raw, list) else [])[:MAX_FX]:
        fx = sanitize_fx(item)
        if fx:
            out.append(fx)
    return out


def span_of(fx_list: list[dict[str, Any]]) -> float:
    """The longest time any effect of the list takes (shown on the cards)."""
    longest = 0.0
    for fx in fx_list:
        longest = max(longest, fx.get("dur") or 0.0, (fx.get("pre") or 0.0) + (fx.get("post") or 0.0))
    return round(longest, 3)


# ----------------------------------------------------------------------------
# One plan per cut: the transition (all cuts, or one chosen for a cut) and its sound
# ----------------------------------------------------------------------------
SOUND_VOLUME = (0.0, 1.5)
SOUND_OFFSET = (-0.6, 0.6)
SOUND_ID_RE = re.compile(r"^[a-z0-9_]{1,60}$")
MAX_OVERRIDES = 600
KEY_RE = re.compile(r"^[0-9]{1,7}(\.[0-9]{1,3})?$")


def cut_key(source_start: float) -> str:
    """How a cut is named: the source start (3 decimals) of the clip that FOLLOWS it. Splitting or moving other
    clips keeps the choice; a cut that did not exist before simply has none (it follows the video's default)."""
    return f"{round(float(source_start), 3):.3f}"


def sanitize_sound(raw: Any) -> dict[str, Any] | None:
    """{"id", "volume", "offset"}: id "" = nothing chosen here (the next level decides), "none" = silence.
    None when `raw` is not a sound at all."""
    if not isinstance(raw, dict):
        return None
    sid = raw.get("id")
    if sid == "none":
        sound_id = "none"
    elif isinstance(sid, str) and SOUND_ID_RE.match(sid):
        sound_id = sid
    else:
        sound_id = ""
    return {"id": sound_id, "volume": _num(raw.get("volume"), *SOUND_VOLUME, 0.8),
            "offset": _num(raw.get("offset"), *SOUND_OFFSET, 0.0)}


def sanitize_overrides(raw: Any) -> dict[str, dict[str, Any]]:
    """edit.cut_transitions: {cut_key: {"transition": id | "", "scale": x | None, "sound": {...} | None}}."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return out
    for key, item in list(raw.items())[:MAX_OVERRIDES]:
        if not isinstance(key, str) or not KEY_RE.match(key) or not isinstance(item, dict):
            continue
        tid = item.get("transition")
        entry: dict[str, Any] = {"transition": tid if isinstance(tid, str) and is_known(tid) else ""}
        scale = item.get("scale")
        entry["scale"] = sanitize_scale(scale) if scale is not None else None
        entry["sound"] = sanitize_sound(item.get("sound"))
        if entry["transition"] or entry["scale"] is not None or (entry["sound"] and entry["sound"]["id"]):
            out[f"{float(key):.3f}"] = entry
    return out


def resolve_cuts(transition_id: str, scale: float, sound: Any, overrides: Any, keys: list[str]) -> list[dict[str, Any]]:
    """What every cut gets. `keys` = cut_key() of the clip after each cut. Each entry:
    {"id", "scale", "effects", "sound": {"id", "volume", "offset"} | None, "custom": bool (chosen for this cut)}.
    The sound of a cut: the one chosen for it, else the video's default one, else the one the transition carries."""
    base_id = sanitize_id(transition_id)
    base_scale = sanitize_scale(scale)
    default_sound = sanitize_sound(sound)
    over = sanitize_overrides(overrides)
    out = []
    for key in keys:
        o = over.get(key) or {}
        tid = o.get("transition") or base_id
        sc = o["scale"] if o.get("scale") is not None else base_scale
        chosen = o.get("sound")
        if chosen and chosen["id"]:
            snd = chosen
        elif default_sound and default_sound["id"]:
            snd = default_sound
        else:
            own = (get(tid) or {}).get("sound")
            snd = sanitize_sound(own) if own else None
        if snd and snd["id"] in ("", "none"):
            snd = None
        out.append({"id": tid, "scale": sc, "effects": effects(tid, sc), "sound": snd, "custom": bool(o)})
    return out


from backend import transition_library  # noqa: E402,F401  (registers the user's own transitions here)
