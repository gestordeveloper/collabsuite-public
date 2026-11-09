"""Subtitle model shared by the live preview (frontend/js/subtitles.js) and the render.

The same rules run on both sides so what the editor shows is what gets burned in:
  * style values are expressed in "reference pixels": the video's SHORT side is
    always 1080 (a 1080x1920 reel and a 1920x1080 clip use the same numbers);
  * words are grouped into cues per EDL range, breaking on punctuation;
  * inside a cue the spoken word is highlighted, one ASS event per word window.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.fonts import FontFile

REF_SHORT_SIDE = 1080
PUNCT_BREAK = ".,!?;:"
STRIP_PUNCT_RE = re.compile(r'[.,;:!?…"“”()]')
ASS_UNSAFE_RE = re.compile(r"[{}\\]")
MIN_CUE_S = 0.35
ENTER_MS = 140       # a word entering fades in over this long ...
ENTER_FROM = 80      # ... growing from this % of its size (mirrored by .sub-enter in css/subtitles.css)

DEFAULT_STYLE: dict[str, Any] = {
    "font_family": "Montserrat",
    "font_weight": 800,
    "italic": False,
    "font_size": 78,            # reference px (em size, same meaning as CSS font-size)
    "uppercase": True,
    "letter_spacing": 0.0,      # reference px
    "words_per_cue": 2,
    "strip_punctuation": False,
    "text_color": "#FFFFFF",
    "highlight_enabled": True,
    "highlight_color": "#FFE600",
    "border_style": "outline",  # outline | box | none
    "outline_color": "#000000",
    "outline_width": 6.0,
    "box_color": "#000000",
    "box_opacity": 0.6,
    "box_padding": 14.0,
    "shadow_distance": 0.0,
    "shadow_color": "#000000",
    "shadow_opacity": 0.6,
    "position_y": 0.7,          # caption centre, fraction of frame height (0 = top)
    "margin_x": 0.08,           # side margin, fraction of frame width
    "text_align": "center",     # left | center | right: where the caption sits between the side margins
    "layout": "inline",         # inline: one block of text | stack: one line per group, the emphasised word on its own
    "emphasis": "keyword",      # stack only: keyword (longest word of the phrase) | spoken (word being said) | none
    "emphasis_scale": 2.4,      # stack only: size of the emphasised word relative to the others
    "reveal": "phrase",         # phrase: the whole cue at once | word: each word enters when it is spoken
}

_RANGES: dict[str, tuple[float, float]] = {
    "font_weight": (100, 900),
    "font_size": (16, 260),
    "letter_spacing": (-10, 40),
    "words_per_cue": (1, 12),
    "outline_width": (0, 40),
    "box_opacity": (0, 1),
    "box_padding": (0, 80),
    "shadow_distance": (0, 30),
    "shadow_opacity": (0, 1),
    "position_y": (0, 1),
    "margin_x": (0, 0.45),
    "emphasis_scale": (1.0, 4.0),
}
_COLOR_KEYS = ("text_color", "highlight_color", "outline_color", "box_color", "shadow_color")
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def sanitize_style(raw: dict | None) -> dict[str, Any]:
    """Merges a client-provided style over the defaults, coercing and clamping every field."""
    style = dict(DEFAULT_STYLE)
    raw = raw or {}
    for key, default in DEFAULT_STYLE.items():
        if key not in raw or raw[key] is None:
            continue
        val = raw[key]
        try:
            if isinstance(default, bool):
                style[key] = bool(val)
            elif key in _COLOR_KEYS:
                if isinstance(val, str) and _HEX_RE.match(val.strip()):
                    style[key] = val.strip().upper()
            elif isinstance(default, str):
                style[key] = str(val).strip() or default
            elif isinstance(default, int):
                style[key] = int(round(float(val)))
            else:
                style[key] = float(val)
        except (TypeError, ValueError):
            continue
        if key in _RANGES:
            lo, hi = _RANGES[key]
            style[key] = type(default)(min(hi, max(lo, style[key])))
    if style["border_style"] not in ("outline", "box", "none"):
        style["border_style"] = "outline"
    if style["text_align"] not in ("left", "center", "right"):
        style["text_align"] = "center"
    if style["reveal"] not in ("phrase", "word"):
        style["reveal"] = "phrase"
    if style["layout"] not in ("inline", "stack"):
        style["layout"] = "inline"
    if style["emphasis"] not in ("keyword", "spoken", "none"):
        style["emphasis"] = "keyword"
    style["font_weight"] = int(round(style["font_weight"] / 100) * 100)
    return style


# ----------------------------------------------------------------------------
# Cues
# ----------------------------------------------------------------------------
@dataclass
class Word:
    start: float
    end: float
    text: str


@dataclass
class Cue:
    start: float
    end: float
    words: list[Word]


def _clean_word(text: str, style: dict, is_last: bool) -> str:
    if style["strip_punctuation"]:
        text = STRIP_PUNCT_RE.sub("", text)
    elif is_last:
        text = text.rstrip(",;:")
    text = ASS_UNSAFE_RE.sub("", text).strip()
    return text.upper() if style["uppercase"] else text


def build_cues(edl_ranges: list[dict], transcripts_dir: Path, style: dict) -> list[Cue]:
    """Output-timeline cues (word-level timing) from the transcripts and the EDL cuts."""
    per_cue = max(1, int(style["words_per_cue"]))
    cues: list[Cue] = []
    seg_offset = 0.0

    for r in edl_ranges:
        src_name = r["source"]
        seg_start = float(r["start"])
        seg_end = float(r["end"])
        seg_dur = seg_end - seg_start

        tr_path = transcripts_dir / f"{src_name}.json"
        if not tr_path.exists():
            tr_path = transcripts_dir / f"{Path(src_name).stem}.json"
        if not tr_path.exists():
            seg_offset += seg_dur
            continue
        try:
            tr_data = json.loads(tr_path.read_text(encoding="utf-8"))
        except Exception:
            seg_offset += seg_dur
            continue

        words = [
            w for w in tr_data.get("words", [])
            if w.get("type", "word") == "word"
            and (w.get("text") or "").strip()
            and float(w.get("end", 0)) > seg_start
            and float(w.get("start", 0)) < seg_end
        ]

        chunks: list[list[dict]] = []
        current: list[dict] = []
        for w in words:
            current.append(w)
            if len(current) >= per_cue or (w["text"].strip()[-1] in PUNCT_BREAK):
                chunks.append(current)
                current = []
        if current:
            chunks.append(current)

        for chunk in chunks:
            shown: list[Word] = []
            for i, w in enumerate(chunk):
                text = _clean_word(w["text"].strip(), style, i == len(chunk) - 1)
                if not text:
                    continue
                ws = max(seg_start, float(w.get("start", seg_start)))
                we = min(seg_end, float(w.get("end", seg_end)))
                shown.append(Word(
                    round(ws - seg_start + seg_offset, 3),
                    round(we - seg_start + seg_offset, 3),
                    text,
                ))
            if not shown:
                continue
            c_start, c_end = shown[0].start, shown[-1].end
            if c_end <= c_start:
                c_end = c_start + MIN_CUE_S
            cues.append(Cue(c_start, c_end, shown))

        seg_offset += seg_dur

    cues.sort(key=lambda c: c.start)
    # Never let two cues sit on screen at the same time (loose word timestamps overlap)
    for cur, nxt in zip(cues, cues[1:]):
        if nxt.start > cur.start and cur.end > nxt.start:
            cur.end = nxt.start
    return cues


def emphasis_index(texts: list[str], style: dict, active: int | None) -> int | None:
    """Which word of a stacked caption is drawn big. Same rule as SubtitleStyle.emphasisIndex in subtitles.js."""
    if style["layout"] != "stack" or style["emphasis"] == "none" or style["emphasis_scale"] <= 1.0 or not texts:
        return None
    if style["emphasis"] == "spoken":
        return active
    letters = [len(re.sub(r"\W", "", t)) for t in texts]
    return letters.index(max(letters))  # the first of the longest words


def word_boundaries(cue: Cue) -> list[float]:
    """Start time of each word's highlight window, plus the cue end as the last item."""
    bounds = [cue.start]
    for w in cue.words[1:]:
        bounds.append(max(bounds[-1], w.start))
    bounds.append(max(cue.end, bounds[-1] + 0.02))
    return bounds


# ----------------------------------------------------------------------------
# Writers
# ----------------------------------------------------------------------------
def _srt_timestamp(seconds: float) -> str:
    total_ms = int(round(seconds * 1000))
    h, rem = divmod(total_ms, 3600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def cues_to_srt(cues: list[Cue]) -> str:
    lines: list[str] = []
    for idx, cue in enumerate(cues, start=1):
        lines += [
            str(idx),
            f"{_srt_timestamp(cue.start)} --> {_srt_timestamp(cue.end)}",
            " ".join(w.text for w in cue.words),
            "",
        ]
    return "\n".join(lines)


def _ass_time(seconds: float) -> str:
    cs = max(0, int(round(seconds * 100)))
    h, cs = divmod(cs, 360_000)
    m, cs = divmod(cs, 6_000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_color(hex_color: str, transparency: float = 0.0) -> str:
    """#RRGGBB (+ 0..1 transparency) -> ASS &HAABBGGRR."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    a = min(255, max(0, int(round(transparency * 255))))
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"


def _ass_rgb(hex_color: str) -> str:
    """#RRGGBB -> the &HBBGGRR& form used by inline colour overrides."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return f"&H{b:02X}{g:02X}{r:02X}&"


def play_resolution(width: int, height: int) -> tuple[int, int]:
    """ASS canvas where the short side is REF_SHORT_SIDE, keeping the frame's aspect."""
    if width <= height:
        return REF_SHORT_SIDE, max(1, round(REF_SHORT_SIDE * height / width))
    return max(1, round(REF_SHORT_SIDE * width / height)), REF_SHORT_SIDE


def build_ass(cues: list[Cue], style: dict, width: int, height: int, font: FontFile | None) -> str:
    res_x, res_y = play_resolution(width, height)

    if font is not None:
        font_name, cell, bold, italic = font.ass_name, font.cell_factor, 0, 0
    else:  # Google font unavailable: fall back to a system font, keep weight/italic by flags
        font_name, cell = "Arial", 1.117
        bold = -1 if style["font_weight"] >= 600 else 0
        italic = -1 if style["italic"] else 0

    box = style["border_style"] == "box"
    outline = style["box_padding"] if box else (style["outline_width"] if style["border_style"] == "outline" else 0)
    outline_colour = _ass_color(style["box_color"], 1 - style["box_opacity"]) if box else _ass_color(style["outline_color"])
    back_colour = _ass_color(style["shadow_color"], 1 - style["shadow_opacity"])
    margin_x = round(style["margin_x"] * res_x)
    # an4/an5/an6 = middle-left / centre / middle-right: the text block is anchored on the matching margin
    an, anchor_x = {"left": (4, margin_x), "right": (6, res_x - margin_x)}.get(style["text_align"], (5, res_x // 2))

    style_line = ",".join(str(v) for v in [
        "Default", font_name, f"{style['font_size'] * cell:.2f}",
        _ass_color(style["text_color"]), _ass_color(style["text_color"]), outline_colour, back_colour,
        bold, italic, 0, 0, 100, 100, f"{style['letter_spacing']:.2f}", 0,
        3 if box else 1, f"{outline:.2f}", f"{style['shadow_distance']:.2f}",
        an, margin_x, margin_x, 0, 1,
    ])

    pos = f"{{\\an{an}\\pos({anchor_x},{round(style['position_y'] * res_y)})}}"
    text_rgb = _ass_rgb(style["text_color"])
    hl_rgb = _ass_rgb(style["highlight_color"])

    events: list[str] = []

    def add(start: float, end: float, text: str) -> None:
        events.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{pos}{text}")

    base_fs = f"{style['font_size'] * cell:.2f}"
    big_fs = f"{style['font_size'] * cell * style['emphasis_scale']:.2f}"

    def compose(texts: list[str], active: int | None, emph: int | None, shown: int | None = None) -> str:
        parts = [f"{{\\1c{hl_rgb}}}{t}{{\\1c{text_rgb}}}" if j == active else t for j, t in enumerate(texts)]
        if shown is not None:
            # word by word: the words still to come keep their place but are invisible (the lines never jump),
            # and the one entering fades in with a small pop
            for j in range(len(parts)):
                if j >= shown:
                    parts[j] = f"{{\\alpha&HFF&}}{parts[j]}{{\\alpha&H00&}}"
                elif j == shown - 1:
                    parts[j] = (f"{{\\alpha&HFF&\\fscx{ENTER_FROM}\\fscy{ENTER_FROM}\\t(0,{ENTER_MS},\\alpha&H00&\\fscx100\\fscy100)}}"
                                f"{parts[j]}{{\\fscx100\\fscy100}}")
        if emph is None:
            return " ".join(parts)
        # stack: what comes before, the emphasised word alone, what comes after
        lines = [" ".join(parts[:emph]), f"{{\\fs{big_fs}}}{parts[emph]}{{\\fs{base_fs}}}", " ".join(parts[emph + 1:])]
        return "\\N".join(line for line in lines if line)

    highlight = style["highlight_enabled"] and hl_rgb != text_rgb
    by_word = style["reveal"] == "word"
    follow_speech = style["layout"] == "stack" and style["emphasis"] == "spoken" and style["emphasis_scale"] > 1.0

    for cue in cues:
        texts = [w.text for w in cue.words]
        if not highlight and not follow_speech and not by_word:
            add(cue.start, cue.end, compose(texts, None, emphasis_index(texts, style, None)))
            continue
        bounds = word_boundaries(cue)
        for i in range(len(cue.words)):
            s, e = bounds[i], bounds[i + 1]
            if round(e * 100) <= round(s * 100):
                continue  # window too short to be visible at ASS's 10 ms resolution
            add(s, e, compose(texts, i if highlight else None, emphasis_index(texts, style, i), i + 1 if by_word else None))

    return "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {res_x}",
        f"PlayResY: {res_y}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: {style_line}",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events,
        "",
    ])
