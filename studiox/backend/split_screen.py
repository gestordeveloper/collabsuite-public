"""Split screen: the speaker keeps one half of the frame and an image or video (uploaded or made by AI)
fills the other half, for the whole video or only for chosen scenes.

The editor stores a small config in the editing state (`edit.split`); this module cleans it, turns it into
time ranges on the OUTPUT timeline (after the cuts) and builds the ffmpeg filters. The filters are added to
the last render pass (render_service.compose_final), so the picture is encoded only once more.

Config
    mode        off | full (the whole video) | scenes (only the listed scenes)
    layout      where the MEDIA goes: top | bottom | left | right (the speaker takes the other side)
    ratio       share of the frame the media takes (0.3 .. 0.7)
    focus       which part of the speaker's frame stays visible in his half (0 = top/left .. 1 = bottom/right)
    media_ids   full mode: library items shown one after the other, each for an equal share of the video
    items       scenes mode: [{id, media_id, start, end, keep?}] in output-timeline seconds
    keep        full mode: {media_id: [[a, b], ...]} the parts of a VIDEO to show (seconds of the file)

`keep` (also on each scene item) is what the user chose to present from a video: the listed parts play one
after the other; when they are shorter than the scene they repeat from the first, when longer the end is cut.
No `keep` = the whole file, looped.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Callable

LAYOUTS = ("top", "bottom", "left", "right")
MODES = ("off", "full", "scenes")
MIN_SCENE_S = 0.5
MAX_ITEMS = 40
MIN_KEEP_S = 0.2          # shortest part of a video that can be kept
MAX_KEEP = 30             # parts per video
IMAGE_PAN = 1.12          # stills are scaled this much larger than their box and pan slowly across it


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


def sanitize_keep(raw: Any) -> list[list[float]]:
    """Parts of a video to show: [[start, end], ...] sorted, without overlaps, each at least MIN_KEEP_S long.
    An empty list means the whole video."""
    pairs: list[list[float]] = []
    for r in (raw if isinstance(raw, (list, tuple)) else [])[:MAX_KEEP * 2]:
        if not isinstance(r, (list, tuple)) or len(r) != 2:
            continue
        a, b = _f(r[0], -1.0, 0.0, 36000.0), _f(r[1], -1.0, 0.0, 36000.0)
        if a >= 0 and b - a >= MIN_KEEP_S:     # -1 = not a number: the whole pair is dropped
            pairs.append([a, b])
    pairs.sort()
    merged: list[list[float]] = []
    for a, b in pairs:
        if merged and a <= merged[-1][1] + 0.02:   # overlapping or touching parts are one part
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [[round(a, 3), round(b, 3)] for a, b in merged[:MAX_KEEP]]


def sanitize_split(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    media_ids: list[str] = []
    for m in raw.get("media_ids") or []:
        mid = _id(m)
        if mid and mid not in media_ids:
            media_ids.append(mid)
    items: list[dict[str, Any]] = []
    for i, it in enumerate((raw.get("items") or [])[:MAX_ITEMS]):
        if not isinstance(it, dict) or not _id(it.get("media_id")):
            continue
        start = _f(it.get("start"), 0.0, 0.0, 36000.0)
        end = _f(it.get("end"), 0.0, 0.0, 36000.0)
        if end - start < 0.1:
            continue
        item = {"id": _id(it.get("id")) or f"s{i + 1}", "media_id": _id(it.get("media_id")),
                "start": round(start, 3), "end": round(end, 3)}
        keep = sanitize_keep(it.get("keep"))
        if keep:
            item["keep"] = keep
        items.append(item)
    keeps: dict[str, list[list[float]]] = {}
    raw_keeps = raw.get("keep") if isinstance(raw.get("keep"), dict) else {}
    for key, value in list(raw_keeps.items())[:MAX_ITEMS]:
        keep = sanitize_keep(value)
        if _id(key) and keep:
            keeps[_id(key)] = keep
    return {
        "mode": raw.get("mode") if raw.get("mode") in MODES else "off",
        "layout": raw.get("layout") if raw.get("layout") in LAYOUTS else "top",
        "ratio": round(_f(raw.get("ratio"), 0.5, 0.3, 0.7), 3),
        "focus": round(_f(raw.get("focus"), 0.3, 0.0, 1.0), 3),
        "media_ids": media_ids[:MAX_ITEMS],
        "items": items,
        "keep": keeps,
    }


def remove_media(split: dict[str, Any] | None, media_id: str) -> dict[str, Any]:
    """The config without any reference to a deleted library item."""
    s = sanitize_split(split)
    s["media_ids"] = [m for m in s["media_ids"] if m != media_id]
    s["items"] = [i for i in s["items"] if i["media_id"] != media_id]
    s["keep"].pop(media_id, None)
    return s


def effective_keep(keep: list[list[float]] | None, duration: float | None) -> list[list[float]]:
    """The parts of `keep` that exist in a file `duration` seconds long. [] = play the whole file (no keep, the keep
    already covers all of it, or nothing of it is left inside the file)."""
    parts = sanitize_keep(keep)
    if not parts:
        return []
    if duration and duration > 0:
        parts = [[a, min(b, duration)] for a, b in parts if a < duration]
        parts = [[a, b] for a, b in parts if b - a >= MIN_KEEP_S]
        if len(parts) == 1 and parts[0][0] <= 0.05 and parts[0][1] >= duration - 0.05:
            return []
    return parts


def kept_length(keep: list[list[float]]) -> float:
    return sum(b - a for a, b in keep)


def resolve_segments(split: dict[str, Any] | None, total: float, media: dict[str, dict[str, Any]]) -> tuple[list[dict], list[str]]:
    """Time ranges of the OUTPUT timeline with the media that fills each one, plus warnings for the render log.

    `media` maps library id -> {"path": Path, "kind": "image" | "video", "name": str, "duration": float | None}.
    Each segment also carries `keep`: the parts of the video chosen to be shown ([] = the whole file).
    """
    s = sanitize_split(split)
    warnings: list[str] = []
    if s["mode"] == "off" or total <= 0:
        return [], warnings

    def keep_of(mid: str, wanted: list[list[float]] | None) -> list[list[float]]:
        item = media[mid]
        if item["kind"] != "video" or not wanted:
            return []
        duration = item.get("duration")
        keep = effective_keep(wanted, duration)
        if not keep and duration and all(a >= duration for a, _ in wanted):
            warnings.append(f"Os trechos escolhidos de “{item.get('name') or mid}” estão depois do fim do vídeo "
                            f"({duration:.1f}s): ele aparece inteiro.")
        return keep

    segments: list[dict] = []
    if s["mode"] == "full":
        usable = [m for m in s["media_ids"] if m in media]
        for m in s["media_ids"]:
            if m not in media:
                warnings.append("Uma mídia da tela dividida não existe mais e foi ignorada.")
        if not usable:
            warnings.append("Tela dividida ligada, mas sem nenhuma imagem ou vídeo escolhido: o vídeo segue em tela cheia.")
            return [], warnings
        share = total / len(usable)
        for i, mid in enumerate(usable):
            segments.append({"start": round(i * share, 3), "end": round(total if i == len(usable) - 1 else (i + 1) * share, 3),
                             "media": media[mid], "media_id": mid, "keep": keep_of(mid, s["keep"].get(mid))})
    else:
        last_end = 0.0
        for it in sorted(s["items"], key=lambda x: x["start"]):
            if it["media_id"] not in media:
                warnings.append("Uma cena da tela dividida usa uma mídia que não existe mais e foi ignorada.")
                continue
            start, end = max(it["start"], last_end), min(it["end"], total)
            if end - start < MIN_SCENE_S:
                if it["start"] >= total:
                    warnings.append(f"Uma cena da tela dividida começa em {it['start']:.1f}s, depois do fim do vídeo "
                                    f"({total:.1f}s), e foi ignorada.")
                continue
            segments.append({"start": round(start, 3), "end": round(end, 3), "media": media[it["media_id"]],
                             "media_id": it["media_id"], "keep": keep_of(it["media_id"], it.get("keep"))})
            last_end = end
        if not segments:
            warnings.append("Tela dividida ligada, mas nenhuma cena cabe no vídeo: ele segue em tela cheia.")
    return segments, warnings


def plan_pieces(keep: list[list[float]], dur: float) -> list[tuple[float, float]]:
    """The parts of `keep` that fit in `dur` seconds of screen time: the end is cut off when they are longer than
    the scene; when they are shorter all of them are returned (the clip then repeats)."""
    out: list[tuple[float, float]] = []
    used = 0.0
    for a, b in keep:
        take = min(b - a, dur - used)
        if take < 0.04:
            break
        out.append((a, round(a + take, 3)))
        used += take
        if used >= dur - 1e-6:
            break
    return out


def prepare_cuts(segments: list[dict], width: int, height: int, layout: str, ratio: float, fps: float,
                 workdir: Path, log: Callable[[str], None]) -> None:
    """Cuts and joins the chosen parts of every video segment that has a `keep`, into one small clip per segment
    (already the size of the media box). The segment's media then points to that clip, which build_graph loops as
    usual, so everything after this works exactly as with a whole file."""
    g = geometry(width, height, layout, ratio)
    fps = fps if 1 < fps <= 120 else 30.0
    workdir.mkdir(parents=True, exist_ok=True)
    for i, seg in enumerate(segments):
        keep = seg.get("keep")
        media = seg["media"]
        if not keep or media["kind"] != "video":
            continue
        dur = max(0.1, seg["end"] - seg["start"])
        pieces = plan_pieces(keep, dur)
        if not pieces:
            continue
        out = workdir / f"cut_{i}.mp4"
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
        for a, b in pieces:
            cmd += ["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(media["path"])]
        chains = "".join(f"[{k}:v]setpts=PTS-STARTPTS[c{k}];" for k in range(len(pieces)))
        joined = "".join(f"[c{k}]" for k in range(len(pieces)))
        graph = (f"{chains}{joined}concat=n={len(pieces)}:v=1:a=0,"
                 f"scale={g['mw']}:{g['mh']}:force_original_aspect_ratio=increase,crop={g['mw']}:{g['mh']},"
                 f"setsar=1,fps={fps:.3f},format=yuv420p[out]")
        cmd += ["-filter_complex", graph, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "14", "-movflags", "+faststart", str(out)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if proc.returncode != 0 or not out.exists():
            raise RuntimeError(f"Falha ao cortar o vídeo “{media.get('name') or seg['media_id']}” da tela dividida:\n"
                               + proc.stderr[-1200:])
        seg["media"] = {**media, "path": out}
        shown = sum(b - a for a, b in pieces)
        note = "se repete até o fim da cena" if kept_length(keep) < dur - 0.05 else "o fim que passa da cena é cortado"
        log(f"Tela dividida: “{media.get('name') or seg['media_id']}” com {len(keep)} trecho(s) escolhido(s), "
            f"{kept_length(keep):.1f}s de {media.get('duration') or 0:.1f}s ({note}; usados {shown:.1f}s).")


def _even(n: float) -> int:
    return max(2, int(round(n)) // 2 * 2)


def geometry(width: int, height: int, layout: str, ratio: float) -> dict[str, int]:
    """Boxes of the two halves (media and speaker) inside a width x height frame."""
    if layout in ("top", "bottom"):
        mh = _even(height * ratio)
        sh = height - mh
        my, sy = (0, mh) if layout == "top" else (sh, 0)   # top: media at y=0, speaker under it
        return {"mw": width, "mh": mh, "mx": 0, "my": my, "sw": width, "sh": sh, "sx": 0, "sy": sy}
    mw = _even(width * ratio)
    sw = width - mw
    if layout == "left":
        mx, sx = 0, mw
    else:
        mx, sx = sw, 0
    return {"mw": mw, "mh": height, "mx": mx, "my": 0, "sw": sw, "sh": height, "sx": sx, "sy": 0}


def build_graph(segments: list[dict], width: int, height: int, layout: str, ratio: float, focus: float,
                fps: float, base_label: str, first_input: int) -> dict[str, Any]:
    """ffmpeg pieces that put the media of each segment beside the speaker.

    Returns {"inputs": [...-i args], "parts": [filter chains], "last": "[label]"}. The media inputs take the
    input numbers first_input, first_input + 1, ... in the order of `segments`.
    """
    g = geometry(width, height, layout, ratio)
    fps = fps if 1 < fps <= 120 else 30.0
    focus = min(1.0, max(0.0, focus))
    if layout in ("top", "bottom"):
        crop = f"crop={g['sw']}:{g['sh']}:0:{int(round(focus * (height - g['sh'])))}"
    else:
        crop = f"crop={g['sw']}:{g['sh']}:{int(round(focus * (width - g['sw'])))}:0"

    inputs: list[str] = []
    parts: list[str] = []
    speaker_on = "+".join(f"between(t,{s['start']:.3f},{s['end']:.3f})" for s in segments)
    parts.append(f"{base_label}split=2[sp_base][sp_src]")
    parts.append(f"[sp_src]{crop}[sp_half]")
    parts.append(f"[sp_base][sp_half]overlay={g['sx']}:{g['sy']}:enable='{speaker_on}'[sp0]")

    last = "[sp0]"
    for i, seg in enumerate(segments):
        idx = first_input + i
        dur = max(0.1, seg["end"] - seg["start"])
        path = str(seg["media"]["path"])
        shift = f"setpts=PTS-STARTPTS+{seg['start']:.3f}/TB"
        if seg["media"]["kind"] == "image":
            inputs += ["-loop", "1", "-framerate", f"{fps:.3f}", "-t", f"{dur:.3f}", "-i", path]
            bw, bh = _even(g["mw"] * IMAGE_PAN), _even(g["mh"] * IMAGE_PAN)
            t = f"min(1,t/{dur:.3f})"
            x = f"(iw-ow)*{t}" if i % 2 == 0 else f"(iw-ow)*(1-{t})"
            chain = (f"[{idx}:v]scale={bw}:{bh}:force_original_aspect_ratio=increase,"
                     f"crop={g['mw']}:{g['mh']}:x='{x}':y='(ih-oh)/2',setsar=1,format=yuv420p,{shift}")
        else:
            inputs += ["-stream_loop", "-1", "-t", f"{dur:.3f}", "-i", path]
            chain = (f"[{idx}:v]scale={g['mw']}:{g['mh']}:force_original_aspect_ratio=increase,"
                     f"crop={g['mw']}:{g['mh']},setsar=1,fps={fps:.3f},format=yuv420p,{shift}")
        parts.append(f"{chain}[md{i}]")
        parts.append(f"{last}[md{i}]overlay={g['mx']}:{g['my']}:enable='between(t,{seg['start']:.3f},{seg['end']:.3f})'[sp{i + 1}]")
        last = f"[sp{i + 1}]"
    return {"inputs": inputs, "parts": parts, "last": last}


def media_aspect(width: int, height: int, layout: str, ratio: float) -> float:
    """width / height of the media box, used to ask the AI for a picture of the right shape."""
    g = geometry(width, height, layout, ratio)
    return g["mw"] / g["mh"]
