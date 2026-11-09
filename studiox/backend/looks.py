"""The look settings (LUT, zoom on the cuts, transitions) as pieces of the ffmpeg filter graph that
render_service.compose_final assembles. The formulas below are mirrored, one for one, by js/fx.js (the preview).

Time in every expression is `t`, the timestamp of the frame in the video being composed. The video render.py
produces does not start at 0 (its start_time is ~0.02 s), and its cuts fall on whole frames, so callers pass cut
times that were MEASURED on the real file (render_service.measure_clips), already shifted by that start time.

    clip i covers [starts[i], starts[i] + lens[i]);  the cut between clip i and i+1 is at T_i = starts[i + 1].
Clip windows use a half-frame margin (`edge`) so that no frame time can land exactly on a boundary.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from backend import transitions as tr

ZOOM_STYLES = ("alternate", "punch", "push")
ZOOM_AMOUNT = (1.03, 1.5)
DEFAULT_ZOOM: dict[str, Any] = {"enabled": False, "style": "alternate", "amount": 1.15, "focus": 0.4}
ALT_EASE = 0.12      # seconds the "alternate" style takes to move between its two framings
PUNCH_SETTLE = 0.8   # seconds the "punch" style takes to settle back to 1x
BLUR_LEVELS = 3      # the blur pulse is stepped (gblur has no per-frame radius)


def sanitize_zoom(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_ZOOM)
    out["enabled"] = bool(raw.get("enabled", False))
    if raw.get("style") in ZOOM_STYLES:
        out["style"] = raw["style"]
    for key, (lo, hi) in (("amount", ZOOM_AMOUNT), ("focus", (0.0, 1.0))):
        try:
            v = float(raw.get(key, DEFAULT_ZOOM[key]))
        except (TypeError, ValueError):
            v = DEFAULT_ZOOM[key]
        if v != v:
            v = DEFAULT_ZOOM[key]
        out[key] = round(min(hi, max(lo, v)), 3)
    return out


def shared_constants() -> dict[str, Any]:
    """The numbers the browser preview needs to draw the same curves (sent with the template catalog)."""
    return {"zoom_styles": list(ZOOM_STYLES), "zoom_amount": list(ZOOM_AMOUNT), "zoom_defaults": dict(DEFAULT_ZOOM),
            "alt_ease": ALT_EASE, "punch_settle": PUNCH_SETTLE, "blur_levels": BLUR_LEVELS,
            "transition_scale": list(tr.SCALE_RANGE)}


SUM_WIDTH = 24   # ffmpeg's expression parser gives up on a flat sum of ~100 terms ("Missing ')' or too many args")


def _sum(terms: list[str]) -> str:
    """The terms added up as nested groups of at most SUM_WIDTH, so a video with hundreds of cuts still parses."""
    while len(terms) > SUM_WIDTH:
        terms = ["(" + "+".join(terms[i:i + SUM_WIDTH]) + ")" for i in range(0, len(terms), SUM_WIDTH)]
    return "+".join(terms)


def _n(x: float) -> str:
    """A number for an expression: short, never in scientific notation."""
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


# ----------------------------------------------------------------------------
# Where the clips and the cuts are
# ----------------------------------------------------------------------------
def timeline(lens: list[float], start: float) -> list[float]:
    """Start time of every clip, given the measured lengths and the start_time of the video."""
    out, acc = [], start
    for d in lens:
        out.append(acc)
        acc += d
    return out


def _clamped_cuts(starts: list[float], lens: list[float]) -> list[dict[str, float]]:
    return [{"t": starts[i + 1], "len_a": lens[i], "len_b": lens[i + 1]} for i in range(len(starts) - 1)]


# ----------------------------------------------------------------------------
# Zoom on the cuts
# ----------------------------------------------------------------------------
def _zoom_clip_expr(cfg: dict[str, Any], i: int, start: float, length: float) -> str:
    z = cfg["amount"]
    if cfg["style"] == "alternate":
        level = z if i % 2 else 1.0
        if i == 0:
            return _n(level)
        prev = z if (i - 1) % 2 else 1.0
        return f"{_n(level)}+({_n(prev - level)})*pow(max(0,1-(t-{_n(start)})/{_n(ALT_EASE)}),3)"
    if cfg["style"] == "punch":
        return f"1+({_n(z - 1)})*pow(max(0,1-(t-{_n(start)})/{_n(PUNCH_SETTLE)}),2)"
    return f"1+({_n(z - 1)})*min(1,max(0,(t-{_n(start)})/{_n(max(length, 0.05))}))"   # push


def zoom_level(cfg: dict[str, Any], starts: list[float], lens: list[float], t: float, edge: float = 1 / 60) -> float:
    """The zoom feature's factor at time t (the reference the expression and the preview are tested against).
    A clip starts half a frame (`edge`) before its first frame time, like the gates of the expression."""
    i = max(0, min(len(starts) - 1, next((k for k in range(len(starts) - 1, -1, -1) if t >= starts[k] - edge), 0)))
    z, s, length = cfg["amount"], starts[i], lens[i]
    if cfg["style"] == "alternate":
        level = z if i % 2 else 1.0
        if i == 0:
            return level
        prev = z if (i - 1) % 2 else 1.0
        return level + (prev - level) * max(0.0, 1 - (t - s) / ALT_EASE) ** 3
    if cfg["style"] == "punch":
        return 1 + (z - 1) * max(0.0, 1 - (t - s) / PUNCH_SETTLE) ** 2
    return 1 + (z - 1) * min(1.0, max(0.0, (t - s) / max(length, 0.05)))


def zoom_feature_expr(cfg: dict[str, Any], starts: list[float], lens: list[float], edge: float) -> str | None:
    """The zoom factor as a function of t: one gated term per clip, summed (a flat sum, because ffmpeg's expression
    parser refuses deeply nested if()s)."""
    if not cfg["enabled"] or not starts:
        return None
    terms = []
    last = len(starts) - 1
    for i in range(len(starts)):
        gates = []
        if i > 0:
            gates.append(f"gte(t,{_n(starts[i] - edge)})")
        if i < last:
            gates.append(f"lt(t,{_n(starts[i + 1] - edge)})")
        expr = _zoom_clip_expr(cfg, i, starts[i], lens[i])
        terms.append(f"{'*'.join(gates)}*({expr})" if gates else f"({expr})")
    return _sum(terms)


def zoom_transition_expr(fx: dict[str, Any], cuts: list[dict[str, float]], edge: float) -> str | None:
    """1 + the punch of every cut: starts `amount` zoomed in on the new clip and settles to 1x over `dur`.
    `edge` (half a frame) keeps the first frame of the new clip inside the window despite rounding."""
    terms = []
    for c in cuts:
        d = min(fx["dur"], c["len_b"])
        if d < tr.MIN_SPAN:
            continue
        terms.append(f"gte(t,{_n(c['t'] - edge)})*{_n(fx['amount'])}*pow(max(0,1-(t-{_n(c['t'])})/{_n(d)}),2)")
    return f"1+{_sum(terms)}" if terms else None


def zoom_parts(last: str, expr: str, focus: float, tag: str) -> tuple[list[str], str]:
    """The picture scaled by expr (a factor of t) about the point (centre, `focus` of the height), and laid over
    itself: the scaled copy always covers the frame, so no black canvas is needed."""
    parts = [
        f"{last}split[zb{tag}][zs{tag}]",
        f"[zs{tag}]scale=w='trunc(iw*({expr})/2)*2':h=-2:eval=frame[zz{tag}]",
        f"[zb{tag}][zz{tag}]overlay=x='(W-w)*0.5':y='(H-h)*{_n(focus)}':eval=frame,format=yuv420p[zo{tag}]",
    ]
    return parts, f"[zo{tag}]"


# ----------------------------------------------------------------------------
# LUT + colour chain
# ----------------------------------------------------------------------------
def color_parts(last: str, out: str, lut: dict[str, Any] | None, lut_rel: str, preset_filter: str,
                adjust_filter: str, tags: dict[str, str]) -> list[str]:
    """[last] -> LUT -> the grade preset -> the fine adjustments -> [out].
    A LUT goes first (it is the base look, the preview draws it first too); its file is `lut_rel`, relative to
    the render folder (a Windows drive letter cannot go into a filtergraph). `intensity` < 1 mixes it with the
    untouched picture. A video without colour tags is tagged before the LUT so ffmpeg reads its RGB right."""
    parts: list[str] = []
    cur = last
    if lut:
        tag = ""
        if not tags.get("colorspace") or tags["colorspace"] in ("unknown", "unspecified"):
            tag = (f"setparams=colorspace={tags['assume']}:color_primaries={tags['assume_prim']}:"
                   f"color_trc={tags['assume_trc']}:range=tv,")
        body = f"{tag}lut3d=file='{lut_rel}',format=yuv420p"
        if lut["intensity"] >= 0.995:
            parts.append(f"{cur}{body}[lutd]")
        else:
            parts += [f"{cur}split[lo][lb]", f"[lb]{body}[ll]",
                      f"[ll][lo]blend=all_mode=normal:all_opacity={lut['intensity']:.3f},format=yuv420p[lutd]"]
        cur = "[lutd]"
    chain = ",".join(x for x in (preset_filter, adjust_filter) if x)
    parts.append(f"{cur}{chain or 'null'}{out}")
    return parts


# ----------------------------------------------------------------------------
# Effects around the cut
# ----------------------------------------------------------------------------
def veil_filter(color: str, cuts: list[dict[str, float]], pre: float, post: float) -> str:
    """Black/white pulse: contrast and saturation fall towards 0 (black) and the brightness moves to the target."""
    terms = []
    windows = []
    for c in cuts:
        a, b = max(tr.MIN_SPAN, min(pre, c["len_a"])), max(tr.MIN_SPAN, min(post, c["len_b"]))
        t = _n(c["t"])
        terms.append(f"if(lt(t,{t}),max(0,1-({t}-t)/{_n(a)}),max(0,1-(t-{t})/{_n(b)}))")
        windows.append(f"between(t,{_n(c['t'] - a)},{_n(c['t'] + b)})")
    p = f"min(1,{_sum(terms)})"
    shift = f"0.5*({p})" if color == "white" else f"-0.5*({p})"
    return (f"eq=contrast='1-({p})':brightness='{shift}':saturation='1-({p})':eval=frame:"
            f"enable='{_sum(windows)}'")


def rgb_filters(fx: dict[str, Any], cuts: list[dict[str, float]], width: int) -> list[str]:
    shift = max(2, int(round(fx["amount"] * width)))
    out = []
    for c in cuts:
        a, b = min(fx["pre"], c["len_a"]), min(fx["post"], c["len_b"])
        out.append(f"rgbashift=rh=-{shift}:bh={shift}:enable='between(t,{_n(c['t'] - a)},{_n(c['t'] + b)})'")
    return out


def blur_bands(fx: dict[str, Any], cut: dict[str, float], shift: float = 0.0) -> list[tuple[float, float, int]]:
    """(from, to, level) time bands of the stepped blur around one cut. Level k (1..BLUR_LEVELS) is where the
    triangular pulse is in ((k-1)/L, k/L]; the two middle bands are merged into one window. The bands are half-open
    [from, to) and moved by `shift` (a quarter frame) so that no frame time falls exactly on a boundary."""
    L = BLUR_LEVELS
    pre, post, t = min(fx["pre"], cut["len_a"]), min(fx["post"], cut["len_b"]), cut["t"] + shift
    bands = []
    for k in range(1, L):
        bands.append((t - pre * (1 - (k - 1) / L), t - pre * (1 - k / L), k))
        bands.append((t + post * (1 - k / L), t + post * (1 - (k - 1) / L), k))
    bands.append((t - pre * (1 - (L - 1) / L), t + post * (1 - (L - 1) / L), L))
    return bands


def blur_filters(fx: dict[str, Any], cuts: list[dict[str, float]], height_ref: float, shift: float) -> list[str]:
    out = []
    for c in cuts:
        for a, b, k in blur_bands(fx, c, shift):
            sigma = fx["sigma"] * (k / BLUR_LEVELS) * height_ref
            out.append(f"gblur=sigma={_n(max(0.1, sigma))}:steps=2:enable='gte(t,{_n(a)})*lt(t,{_n(b)})'")
    return out


def pulse_chain(groups: list[tuple[dict[str, Any], list[dict[str, float]]]], width: int, height: int, edge: float) -> list[str]:
    """Whole-frame effects (they go after the split screen, before the headline and the captions).
    `groups` = [(effect, the cuts it applies to)] (see group_effects)."""
    ref = min(width, height) / 1080.0
    chain: list[str] = []
    for fx, cuts in groups:
        if not cuts:
            continue
        if fx["type"] == "veil":
            chain.append(veil_filter(fx["color"], cuts, fx["pre"], fx["post"]))
        elif fx["type"] == "rgb":
            chain += rgb_filters(fx, cuts, width)
        elif fx["type"] == "blur":
            chain += blur_filters(fx, cuts, ref, edge / 2)
    return chain


def per_cut_effects(effects: Any, n_cuts: int) -> list[list[dict[str, Any]]]:
    """One list of effects per cut. `effects` is either that already (a list of lists, one per cut) or a flat list of
    effects that applies to every cut."""
    if effects and isinstance(effects[0], dict):
        return [list(effects) for _ in range(n_cuts)]
    out = [list(e or []) for e in (effects or [])][:n_cuts]
    return out + [[] for _ in range(n_cuts - len(out))]


def group_effects(per_cut: list[list[dict[str, Any]]], cuts: list[dict[str, float]]) -> list[tuple[dict[str, Any], list[dict[str, float]]]]:
    """[(effect, the cuts that use exactly that effect)]: cuts that share a transition share one filter."""
    order: list[str] = []
    found: dict[str, tuple[dict[str, Any], list[dict[str, float]]]] = {}
    for fxs, cut in zip(per_cut, cuts):
        for fx in fxs:
            key = json.dumps(fx, sort_keys=True)
            if key not in found:
                found[key] = (fx, [])
                order.append(key)
            found[key][1].append(cut)
    return [found[k] for k in order]


# ----------------------------------------------------------------------------
# Stills: the last frame of the previous clip, held over the new one
# ----------------------------------------------------------------------------
def still_plan(groups: list[tuple[dict[str, Any], list[dict[str, float]]]], starts: list[float], lens: list[float],
               zoom_cfg: dict[str, Any], fps: float, start_time: float) -> list[dict[str, Any]]:
    """One entry per (cut, still effect): when it runs, its motion and the frame number to freeze."""
    plan = []
    for fx, cuts in groups:
        if fx["type"] != "still":
            continue
        for c in cuts:
            d = min(fx["dur"], c["len_b"])
            if d < tr.MIN_SPAN:
                continue
            frame = max(0, int(round((c["t"] - start_time) * fps)) - 2)   # two frames before the cut: always inside the old clip
            level = zoom_level(zoom_cfg, starts, lens, c["t"] - 1.5 / fps) if zoom_cfg["enabled"] else 1.0
            plan.append({"t": c["t"], "dur": d, "mode": fx["mode"], "dir": fx.get("dir", "left"), "blur": fx.get("blur", 0),
                         "frame": frame, "zoom": level})
    plan.sort(key=lambda e: e["t"])
    return plan


def extract_stills(cmd_prefix: list[str], color_graph: list[str], color_out: str, frames: list[int], edit_dir: Path,
                   fps: float, matrix: str) -> list[Path]:
    """Writes the frames to freeze as PNGs (after the colour treatment, so they match the live picture)."""
    for stale in edit_dir.glob("still_*.png"):   # a file of an earlier render must never pass for one of this render
        stale.unlink(missing_ok=True)
    select = _sum([f"eq(n,{f})" for f in frames])
    graph = ";".join(color_graph + [f"{color_out}select='{select}',scale=in_color_matrix={matrix}:in_range=tv:out_range=pc,format=rgb24[st]"])
    cmd = [*cmd_prefix, "-filter_complex", graph, "-map", "[st]", "-fps_mode", "passthrough",
           "-f", "image2", "still_%03d.png"]
    proc = subprocess.run(cmd, cwd=str(edit_dir), capture_output=True, text=True)
    paths = [edit_dir / f"still_{k + 1:03d}.png" for k in range(len(frames))]
    if proc.returncode != 0 or not all(p.exists() for p in paths):
        raise RuntimeError("Falha ao extrair os quadros das transições:\n" + proc.stderr[-800:])
    return paths


def _slide_expr(direction: str, t0: float, dur: float) -> tuple[str, str]:
    prog = f"pow(min(1,max(0,(t-{_n(t0)})/{_n(dur)})),2)"
    return {
        "left": (f"-W*{prog}", "0"), "right": (f"W*{prog}", "0"),
        "up": ("0", f"-H*{prog}"), "down": ("0", f"H*{prog}"),
    }.get(direction, (f"-W*{prog}", "0"))


def still_parts(last: str, plan: list[dict[str, Any]], first_input: int, width: int, height: int, focus: float,
                matrix: str, edge: float) -> tuple[list[str], str]:
    """The overlay chain of the stills. Input `first_input + k` is the k-th still (a looped PNG, see compose_final)."""
    parts: list[str] = []
    ref = min(width, height) / 1080.0
    cur = last
    for k, s in enumerate(plan):
        idx = first_input + k
        chain = [f"scale=out_color_matrix={matrix}:out_range=tv", "format=yuva420p"]   # RGB -> YUV here, with the video's own matrix
        if s["zoom"] > 1.0005:
            chain.append(f"scale=w='trunc(iw*{_n(s['zoom'])}/2)*2':h=-2,crop={width}:{height}:(iw-{width})*0.5:(ih-{height})*{_n(focus)}")
        if s["mode"] == "slide" and s["blur"] > 0:
            sg = max(0.1, s["blur"] * ref)
            chain.append(f"gblur=sigma={_n(sg)}:sigmaV=0:steps=2" if s["dir"] in ("left", "right") else f"gblur=sigma=0:sigmaV={_n(sg)}:steps=2")
        chain.append(f"setpts=PTS-STARTPTS+{_n(s['t'])}/TB")
        if s["mode"] == "fade":
            chain.append(f"fade=t=out:st={_n(s['t'] - edge)}:d={_n(s['dur'])}:alpha=1")
            pos = ""
        else:
            x, y = _slide_expr(s["dir"], s["t"], s["dur"])
            pos = f"x='{x}':y='{y}':"
        parts.append(f"[{idx}:v]{','.join(chain)}[stl{k}]")
        parts.append(f"{cur}[stl{k}]overlay={pos}enable='between(t,{_n(s['t'] - edge)},{_n(s['t'] + s['dur'] + edge)})':eof_action=pass,format=yuv420p[stv{k}]")
        cur = f"[stv{k}]"
    return parts, cur


# ----------------------------------------------------------------------------
# Imported overlays: a video or an image laid over the cut
# ----------------------------------------------------------------------------
MAX_OVERLAYS = 60   # every one is an input of the render: past this the rest is skipped


def overlay_plan(groups: list[tuple[dict[str, Any], list[dict[str, float]]]], start_time: float) -> list[dict[str, Any]]:
    """One entry per (cut, overlay effect): {"media", "mode", "fade", "start", "dur", "t"}. `start` is when it appears,
    placed by `align` around the cut time `t` (and never before the video starts)."""
    out = []
    for fx, cuts in groups:
        if fx["type"] != "overlay":
            continue
        for c in cuts:
            dur = fx["dur"]
            start = {"start": c["t"], "end": c["t"] - dur}.get(fx["align"], c["t"] - dur / 2)
            out.append({"media": fx["media"], "mode": fx["mode"], "fade": fx["fade"], "dur": dur,
                        "start": round(max(start_time, start), 4), "t": c["t"]})
    out.sort(key=lambda e: e["start"])
    return out[:MAX_OVERLAYS]


def overlay_inputs(entries: list[dict[str, Any]], fps: float) -> list[str]:
    """The -i arguments of the overlays. `-itsoffset` puts every file on the time of its cut, so ffmpeg reads it only when it
    is needed (decoding all of them from t=0 would pile the frames up in memory). Each entry carries `path`, `kind`
    (video | image) and `codec`."""
    args: list[str] = []
    for e in entries:
        args += ["-itsoffset", f"{e['start']:.4f}"]
        if e["kind"] == "image":
            args += ["-loop", "1", "-framerate", f"{fps:.5f}", "-t", f"{e['dur']:.3f}"]
        elif e.get("codec") in ("vp8", "vp9") and str(e["path"]).lower().endswith(".webm"):
            args += ["-c:v", "libvpx-vp9" if e["codec"] == "vp9" else "libvpx"]   # the native decoders drop the alpha channel
        args += ["-i", str(e["path"])]
    return args


def overlay_parts(last: str, entries: list[dict[str, Any]], first_input: int, width: int, height: int,
                  edge: float) -> tuple[list[str], str]:
    parts: list[str] = []
    cur = last
    for k, e in enumerate(entries):
        idx = first_input + k
        chain = []
        if e["mode"] == "green":
            chain.append("chromakey=0x00FF00:0.22:0.1")
        elif e["mode"] == "screen":
            chain.append("lumakey=threshold=0.05:tolerance=0.2:softness=0.2")
        chain += [f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=bicubic,crop={width}:{height}",
                  "setsar=1", "format=yuva420p", f"setpts=PTS-STARTPTS+{_n(e['start'])}/TB"]
        if e["fade"] > 0:
            f = max(0.03, min(e["dur"] / 2, e["fade"] * e["dur"]))
            chain.append(f"fade=t=in:st={_n(e['start'])}:d={_n(f)}:alpha=1")
            chain.append(f"fade=t=out:st={_n(e['start'] + e['dur'] - f)}:d={_n(f)}:alpha=1")
        parts.append(f"[{idx}:v]{','.join(chain)}[ovl{k}]")
        parts.append(f"{cur}[ovl{k}]overlay=enable='between(t,{_n(e['start'] - edge)},{_n(e['start'] + e['dur'] + edge)})':"
                     f"eof_action=pass:format=auto,format=yuv420p[ovv{k}]")
        cur = f"[ovv{k}]"
    return parts, cur


# ----------------------------------------------------------------------------
# Everything in one place
# ----------------------------------------------------------------------------
def plan(zoom_cfg: dict[str, Any], effects: Any, lens: list[float], start_time: float, fps: float,
         width: int, height: int) -> dict[str, Any]:
    """What the render has to draw for these clips: the zoom expression, the stills to hold, the whole-frame pulses and
    the imported overlays. `effects` = one list of effects per cut (or one flat list for all of them); `lens` are the
    MEASURED clip lengths and `start_time` the start_time of the video they were measured in."""
    starts = timeline(lens, start_time)
    cuts = _clamped_cuts(starts, lens)
    groups = group_effects(per_cut_effects(effects, len(cuts)), cuts)
    exprs = []
    feature = zoom_feature_expr(zoom_cfg, starts, lens, 0.5 / fps)
    if feature:
        exprs.append(feature)
    for fx, fx_cuts in groups:
        if fx["type"] == "zoom":
            e = zoom_transition_expr(fx, fx_cuts, 0.5 / fps)
            if e:
                exprs.append(e)
    return {
        "starts": starts, "cuts": cuts,
        "zoom_expr": "*".join(f"({e})" for e in exprs) or None, "zoom_focus": zoom_cfg["focus"],
        "stills": still_plan(groups, starts, lens, zoom_cfg, fps, start_time),
        "pulses": pulse_chain(groups, width, height, 0.5 / fps),
        "overlays": overlay_plan(groups, start_time),
    }
