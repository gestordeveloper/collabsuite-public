from __future__ import annotations
import json
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from backend.config import URL_BASE, HELPERS_DIR, ensure_ffmpeg, script_command
from backend.fonts import FontUnavailable, ensure_font
from backend import projects
from backend import canvas as canvas_frame
from backend.headlines import headline_filters, parse_headline_request
from backend.subtitles import build_ass, build_cues, cues_to_srt, sanitize_style
from backend import audio_timeline, face_track, looks, luts, media_library, motion_graphics, motion_render, motion_track, music_library, music_mix, sfx, split_screen
from backend import transition_library
from backend import transitions as tr
from backend.templates import grade_adjust_filter, grade_to_edl

ensure_ffmpeg()

# Active jobs tracker
JOBS: dict[str, dict[str, Any]] = {}

def build_edl(project_dir: Path, info: dict, clips: list[dict], grade_id: str | None, subtitles: bool) -> dict:
    """The EDL render.py reads: one source, the cut list, the grade and (optionally) master.srt."""
    source_name = info["source_name"]
    ranges = [{
        "source": source_name,
        "start": float(c["start"]),
        "end": float(c["end"]),
        "beat": c.get("beat") or f"CLIP {i + 1}",
        "quote": c.get("quote", ""),
    } for i, c in enumerate(clips)]
    return {
        "version": 1,
        "sources": {source_name: str((project_dir / source_name).resolve())},
        "ranges": ranges,
        "grade": grade_to_edl(grade_id),
        "overlays": [],
        "subtitles": "master.srt" if subtitles else None,
        "total_duration_s": round(sum(r["end"] - r["start"] for r in ranges), 2),
    }

def probe_video_size(path: Path) -> tuple[int, int]:
    """Width/height of the first video stream as it will be displayed."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    w, h = out.split("x")[:2]
    return int(w), int(h)

def probe_duration(path: Path) -> float:
    """Container duration in seconds."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)

def probe_has_audio(path: Path) -> bool:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip()
    return bool(out)


def write_subtitle_files(
    edit_dir: Path,
    cues: list,
    style: dict,
    width: int,
    height: int,
    log: Callable[[str], None],
) -> None:
    """Writes master.srt/master.ass (styled captions, Google Fonts) next to the render."""
    font = None
    try:
        log(f"Preparando fonte {style['font_family']} {style['font_weight']}"
            f"{' itálico' if style['italic'] else ''} (Google Fonts)...")
        font = ensure_font(style["font_family"], style["font_weight"], style["italic"])
    except FontUnavailable as exc:
        log(f"Aviso: {exc}. Usando Arial no lugar.")

    # Only the needed font goes in the per-render folder, so libass can't pick another file
    fonts_dir = edit_dir / "fonts"
    shutil.rmtree(fonts_dir, ignore_errors=True)
    fonts_dir.mkdir(parents=True, exist_ok=True)
    if font:
        shutil.copy2(font.path, fonts_dir / font.path.name)

    (edit_dir / "master.srt").write_text(cues_to_srt(cues), encoding="utf-8")
    (edit_dir / "master.ass").write_text(build_ass(cues, style, width, height, font), encoding="utf-8")


def probe_fps(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate",
         "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip()
    try:
        num, _, den = out.partition("/")
        return float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        return 30.0


def probe_video_stream(path: Path) -> dict[str, float]:
    """start_time and duration of the video stream (the container's duration also counts the audio)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=start_time,duration",
         "-of", "json", str(path)], capture_output=True, text=True).stdout
    try:
        st = json.loads(out)["streams"][0]
    except (ValueError, KeyError, IndexError):
        return {"start": 0.0, "duration": 0.0}

    def num(v: Any) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0
    return {"start": num(st.get("start_time")), "duration": num(st.get("duration"))}


def probe_color_tags(path: Path, width: int, height: int) -> dict[str, str]:
    """The colour tags of the video (a phone clip is bt709; a file without tags is assumed to be, when it is HD)
    and the matrix name ffmpeg's scale wants ("bt709" | "bt601")."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_space,color_primaries,color_transfer",
         "-of", "json", str(path)], capture_output=True, text=True).stdout
    try:
        st = json.loads(out)["streams"][0]
    except (ValueError, KeyError, IndexError):
        st = {}
    space = st.get("color_space") or ""
    hd = min(width, height) >= 700
    assume = "bt709" if hd else "smpte170m"
    matrix = "bt709" if (space == "bt709" or (space in ("", "unknown", "unspecified") and hd)) else "bt601"
    return {"colorspace": space, "assume": assume, "assume_prim": assume, "assume_trc": assume, "matrix": matrix}


def measure_clips(edit_dir: Path, count: int, is_preview: bool) -> list[float] | None:
    """How long each clip REALLY is in the video render.py made (a whole number of frames, rounded on the running
    total, so it can differ from the EDL by up to a frame). None when a segment cannot be measured."""
    clips_dir = edit_dir / ("clips_preview" if is_preview else "clips_graded")
    lens: list[float] = []
    for i in range(count):
        files = sorted([*clips_dir.glob(f"seg_{i:02d}_*.mov"), *clips_dir.glob(f"seg_{i:02d}_*.mp4")],
                       key=lambda f: f.stat().st_mtime, reverse=True)
        if not files:
            return None
        d = probe_video_stream(files[0])["duration"]
        if d <= 0:
            return None
        lens.append(d)
    return lens


_FFMPEG_MAJOR: int | None = None


def _ffmpeg_major() -> int:
    global _FFMPEG_MAJOR
    if _FFMPEG_MAJOR is None:
        out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
        m = re.search(r"version\D*(\d+)", out)
        _FFMPEG_MAJOR = int(m.group(1)) if m else 6
    return _FFMPEG_MAJOR


def filter_args(graph: str, edit_dir: Path) -> list[str]:
    """`-filter_complex graph`, or the graph in a file when it is long (a zoom or transitions on a video with
    many cuts makes a graph of tens of KB, and Windows limits a command line to 32 KB)."""
    if len(graph) <= 6000:
        return ["-filter_complex", graph]
    (edit_dir / "filter_graph.txt").write_text(graph, encoding="utf-8")
    # ffmpeg 7 replaced -filter_complex_script by -/filter_complex
    return ["-/filter_complex", "filter_graph.txt"] if _ffmpeg_major() >= 7 else ["-filter_complex_script", "filter_graph.txt"]


def attach_follow_paths(plan: list[dict], ctx: dict | None, lens: list[float] | None, src_wh: tuple[int, int],
                        canvas_cfg: dict, canvas_size: tuple[int, int] | None, face_ctx: dict | None,
                        frame_size: tuple[int, int], project_dir: Path, cut_video: Path, log: Callable[[str], None]) -> list[dict]:
    """For every motion item that follows something, finds the target (cached analysis, or one done now) and adds
    item["track_expr"] = the ffmpeg expressions that slide its full-frame video onto the target. An item whose target is
    never seen is dropped (with a warning) instead of sitting in the middle of the frame."""
    if not any(motion_track.is_following(it.get("follow")) for it in plan):
        return plan
    ranges = (ctx or {}).get("ranges")
    source = (ctx or {}).get("source_video")
    if not ranges or not lens or len(lens) != len(ranges) or not source:
        log("Aviso: não consegui ligar os motion graphics que seguem algo ao vídeo (cortes sem medida): eles foram ignorados.")
        return [it for it in plan if not motion_track.is_following(it.get("follow"))]
    start_time = probe_video_stream(cut_video)["start"]
    face_path = None
    if face_ctx:
        face_data = face_track.load(project_dir)
        face_path = face_track.build_path(face_data, face_ctx["cfg"]["smooth"], face_ctx["cfg"].get("seed")) if face_data else None
    fmap = motion_track.FrameMap(src_wh, canvas_cfg, canvas_size, face_ctx["cfg"] if face_path else None, face_path, ranges)
    out: list[dict] = []
    for it in plan:
        follow = it.get("follow")
        if not motion_track.is_following(follow):
            out.append(it)
            continue
        wanted = motion_track.source_ranges(it["start"], it["duration"], ranges, lens, start_time)
        data = motion_track.ensure(project_dir, it["id"], source, follow, wanted, log)
        sm = motion_track.smoothed(data, follow["part"], follow["smooth"]) if data else None
        exprs = motion_track.build_exprs(follow, sm, it["start"], it["duration"], ranges, lens, start_time, fmap, frame_size) if sm else None
        if not exprs:
            log(f"Aviso: o alvo do motion graphic ({follow['target']}) não apareceu enquanto ele estaria na tela: ele foi ignorado.")
            continue
        log(f"Motion graphic seguindo {follow['target']}: visível em {exprs['visible_s']:.1f}s de {it['duration']:.1f}s.")
        out.append({**it, "track_expr": exprs})
    return out


def compose_final(
    src_video: Path,
    out_path: Path,
    edit_dir: Path,
    cues: list,
    style: dict,
    headline: dict | None,
    is_preview: bool,
    log: Callable[[str], None],
    grade_filter: str = "",
    split: dict | None = None,
    music: dict | None = None,
    look: dict | None = None,
    canvas: dict | None = None,
    motion: dict | None = None,
    motion_renders: dict | None = None,
    track: dict | None = None,
    motion_ctx: dict | None = None,
) -> None:
    """Last pass over the already-cut video: the LUT, fine colour adjustments, the aspect-ratio/position canvas,
    zoom on the cuts, transitions, split screen, motion graphics, the animated headline image, the captions on
    top of everything, and the background music under the voice.

    One encode for all of it, so the picture only goes through x264 once more (Rule 1: subtitles LAST); when
    only music is added the picture is copied untouched and only the audio is re-encoded.
    `split` = {"segments", "layout", "ratio", "focus"} from split_screen.resolve_segments;
    `music` = the music config (music_mix.sanitize_music), clamped here to the real length of the video;
    `look` = {"lut", "preset_filter", "zoom", "effects", "lens"}: see prepare_look;
    `canvas` = the aspect-ratio/transform config (backend/canvas.py::sanitize_canvas);
    `motion` = the sanitized edit.motion (backend/motion_graphics.py::sanitize_motion); `motion_renders` =
    state["motion_renders"], the SERVER-OWNED render status per item (backend/motion_render.py writes it) —
    resolve_plan() below only uses items whose rendered file actually exists on disk.

    `motion_ctx` = {"ranges", "source_video"}: what a motion graphic that FOLLOWS something (a face, a hand, a point) needs to
    find where it is on the final frame (backend/motion_track.py).

    `track` = {"cfg", "data", "ranges"}: the follow-the-face camera (backend/face_track.py); it pans/zooms the picture
    on the SOURCE frame, right after the colour and before the canvas, so the face fractions still mean the same thing.

    Order of the picture: LUT -> grade preset -> fine adjustments -> face tracking -> canvas (aspect ratio + scale/position/
    rotation) -> zoom -> held frames of the transitions -> split screen -> whole-frame transition pulses ->
    motion graphics -> headline -> captions. Everything from the canvas step on draws on the NEW frame size,
    once it changes it (headline and the captions are positioned on it, split screen lays its boxes out on
    it). The preview draws the same order.
    """
    width, height = probe_video_size(src_video)
    src_wh = (width, height)       # before the face camera / canvas change it: what a followed motion graphic maps from
    face_ctx: dict | None = None
    total = probe_duration(src_video)
    fps = probe_fps(src_video)

    inputs = ["-i", str(src_video)]
    parts: list[str] = []
    last = "[0:v]"
    limit: list[str] = []
    next_input = 1

    lk = look or {}
    lut = lk.get("lut")
    preset_filter = lk.get("preset_filter") or ""
    zoom_cfg = lk.get("zoom") or looks.sanitize_zoom(None)
    effects = lk.get("effects") or []          # every effect of every cut (only to know whether there is any)
    per_cut = lk.get("per_cut") or []         # one list of effects per cut
    tags = probe_color_tags(src_video, width, height) if (lut or effects or zoom_cfg["enabled"]) else {}
    lut_rel = ""
    if lut:
        (edit_dir / "luts").mkdir(exist_ok=True)
        lut_rel = f"luts/{lut['id']}.cube"
        shutil.copyfile(lut["path"], edit_dir / lut_rel)

    color_present = bool(lut or preset_filter or grade_filter)
    if color_present:
        parts += looks.color_parts(last, "[graded]", lut, lut_rel, preset_filter, grade_filter, tags)
        last = "[graded]"

    canvas_cfg = canvas_frame.sanitize_canvas(canvas)
    canvas_on = canvas_frame.is_active(canvas_cfg, width, height)
    canvas_size = canvas_frame.target_size(canvas_cfg, width, height) if canvas_on else None

    def add_canvas(last: str, next_input: int, width: int, height: int):
        cw, ch = canvas_frame.target_size(canvas_cfg, width, height)
        bg_hex = canvas_cfg["background"]
        inputs.extend(["-f", "lavfi", "-i", f"color=c=0x{bg_hex[1:]}:s={cw}x{ch}:r={fps:.3f}"])
        parts.append(canvas_frame.build_filter(last, "[framed]", width, height, cw, ch,
                                               canvas_cfg["transform"], f"{next_input}:v"))
        log(f"Enquadramento: {canvas_cfg['ratio']} ({cw}x{ch}).")
        return "[framed]", next_input + 1, cw, ch

    if track and lk.get("lens"):
        stream = probe_video_stream(src_video)
        if abs(sum(lk["lens"]) - stream["duration"]) > max(0.3, 0.01 * stream["duration"]):
            log(f"Aviso: os cortes medidos ({sum(lk['lens']):.2f}s) não batem com o vídeo ({stream['duration']:.2f}s): "
                "o rastreio do rosto foi ignorado.")
        else:
            path = face_track.build_path(track["data"], track["cfg"]["smooth"], track["cfg"].get("seed"))
            tplan = face_track.plan(track["cfg"], path, track["ranges"], lk["lens"], stream["start"], 0.5 / fps) if path else None
            if tplan:
                face_ctx = {"cfg": track["cfg"], "path": path}
                # With a new aspect ratio the camera follows the face INSIDE the new frame (a vertical crop of a horizontal
                # video has to slide sideways with the person), so it draws straight onto the canvas-sized picture.
                tp, last = face_track.parts(last, tplan, src=(width, height), frame=canvas_size)
                parts += tp
                limit = ["-t", f"{total:.3f}"]
                if canvas_size:
                    width, height = canvas_size
                    canvas_on = canvas_frame.is_active(canvas_cfg, width, height)  # only a manual scale/position/rotation is left
                log(f"Câmera seguindo o rosto em {tplan['active']} de {len(track['ranges'])} corte(s) (zoom {tplan['zoom']:g}×).")
            else:
                log("Aviso: não achei o rosto nos trechos escolhidos; o rastreio foi ignorado.")

    if canvas_on:
        last, next_input, width, height = add_canvas(last, next_input, width, height)
        limit = ["-t", f"{total:.3f}"]  # the colour plate is an infinite source

    # Cut-based effects (zoom, transitions) need the real clip lengths; if they do not add up, skip them
    fx_plan = None
    if (zoom_cfg["enabled"] or effects) and lk.get("lens"):
        stream = probe_video_stream(src_video)
        if abs(sum(lk["lens"]) - stream["duration"]) > max(0.3, 0.01 * stream["duration"]):
            log(f"Aviso: os cortes medidos ({sum(lk['lens']):.2f}s) não batem com o vídeo ({stream['duration']:.2f}s): "
                "zoom e transições foram ignorados.")
        else:
            fx_plan = looks.plan(zoom_cfg, per_cut, lk["lens"], stream["start"], fps, width, height)

    if fx_plan and fx_plan["zoom_expr"]:
        zp, last = looks.zoom_parts(last, fx_plan["zoom_expr"], fx_plan["zoom_focus"], "1")
        parts += zp
        limit = ["-t", f"{total:.3f}"]

    if fx_plan and fx_plan["stills"]:
        # The frame to hold is taken from the same colour treatment as the live picture, then looped as an image
        extract_graph = looks.color_parts("[0:v]", "[xc]", lut, lut_rel, preset_filter, grade_filter, tags) if color_present else []
        frames = [s["frame"] for s in fx_plan["stills"]]
        pngs = looks.extract_stills(["ffmpeg", "-y", "-i", str(src_video)], extract_graph, "[xc]" if color_present else "[0:v]",
                                    frames, edit_dir, fps, tags["matrix"])
        for k, s in enumerate(fx_plan["stills"]):
            inputs += ["-loop", "1", "-framerate", f"{fps:.5f}", "-t", f"{s['dur'] + 0.3:.3f}", "-i", pngs[k].name]
        sp, last = looks.still_parts(last, fx_plan["stills"], next_input, width, height, zoom_cfg["focus"], tags["matrix"], 0.5 / fps)
        parts += sp
        next_input += len(fx_plan["stills"])
        limit = ["-t", f"{total:.3f}"]

    if split and split["segments"]:
        split_screen.prepare_cuts(split["segments"], width, height, split["layout"], split["ratio"], fps,
                                  edit_dir / "split_cuts", log)
        g = split_screen.build_graph(split["segments"], width, height, split["layout"], split["ratio"], split["focus"],
                                     fps, last, next_input)
        inputs += g["inputs"]
        parts += g["parts"]
        last = g["last"]
        next_input += len(split["segments"])
        limit = ["-t", f"{total:.3f}"]  # looped stills/clips must not stretch the file

    if fx_plan and fx_plan["pulses"]:
        parts.append(f"{last}{','.join(fx_plan['pulses'])}[pulses]")
        last = "[pulses]"

    if fx_plan and fx_plan["overlays"]:
        entries = []
        for o in fx_plan["overlays"]:
            info = transition_library.media_info(o["media"])
            path = transition_library.media_path(o["media"])
            if not info or not path:
                continue
            entries.append({**o, "path": path, "kind": info.get("kind", "video"), "codec": info.get("codec", "")})
        if len(entries) < len(fx_plan["overlays"]):
            log("Aviso: uma transição importada não existe mais na biblioteca e foi ignorada.")
        if entries:
            inputs += looks.overlay_inputs(entries, fps)
            op, last = looks.overlay_parts(last, entries, next_input, width, height, 0.5 / fps)
            parts += op
            next_input += len(entries)
            limit = ["-t", f"{total:.3f}"]
            log(f"Transições importadas: {len(entries)} sobreposição(ões).")

    motion_plan = None
    if motion and motion.get("enabled") and motion.get("items"):
        # Items that were never rendered (or went stale after an edit) are rendered right now: a motion graphic must not
        # silently miss the video just because "Renderizar" was not clicked on it.
        motion_renders = motion_render.ensure_rendered(edit_dir.parent.name, motion, motion_renders, width, height, fps, edit_dir, log)
        motion_plan = motion_graphics.resolve_plan(motion, motion_renders, edit_dir, width, height, fps)
    if motion_plan:
        motion_plan = attach_follow_paths(motion_plan, motion_ctx, lk.get("lens"), src_wh, canvas_cfg,
                                          canvas_frame.target_size(canvas_cfg, *src_wh) if canvas_frame.is_active(canvas_cfg, *src_wh) else None,
                                          face_ctx, (width, height), edit_dir.parent, src_video, log)
    if motion_plan:
        g = motion_graphics.build_graph(motion_plan, last, next_input)
        inputs += g["inputs"]
        parts += g["parts"]
        last = g["last"]
        next_input += len(motion_plan)
        limit = ["-t", f"{total:.3f}"]
        log(f"Motion graphics: {len(motion_plan)} item(ns).")

    if headline:
        if headline["start"] >= total:
            log(f"Aviso: o headline começa em {headline['start']:.1f}s, depois do fim do vídeo "
                f"({total:.1f}s), então não aparece. Ajuste o campo 'Aparece em'.")
            headline = None
        elif headline["start"] + headline["duration"] > total:
            log(f"Aviso: o headline termina depois do fim do vídeo ({total:.1f}s); será cortado ali.")

    if headline:
        # A still that outlasts the video would make ffmpeg freeze the last frame and stretch the file
        limit = ["-t", f"{total:.3f}"]
        (edit_dir / "headline.png").write_bytes(headline["png"])
        # A looped still: -t bounds it to the time on screen, -framerate keeps fades/slides smooth
        inputs += ["-loop", "1", "-framerate", "60", "-t", f"{headline['duration']:.3f}", "-i", "headline.png"]
        image_chain, overlay_opts, enable = headline_filters(headline, width, height, input_label=f"{next_input}:v")
        parts.append(image_chain)
        parts.append(f"{last}[hl]overlay={overlay_opts}:enable='{enable}'[vh]")
        last = "[vh]"
        next_input += 1

    if cues:
        write_subtitle_files(edit_dir, cues, style, width, height, log)
        parts.append(f"{last}ass=master.ass:fontsdir=fonts[outv]")
        last = "[outv]"

    video_parts = list(parts)
    audio_parts: list[str] = []
    audio_map = ["-map", "0:a?"]
    audio_codec = ["-c:a", "copy"]
    if music:
        mplan = music_mix.plan(music, total, music_library.lookup(), log)
        if mplan["clips"]:
            g = music_mix.build_graph(mplan["clips"], total, mplan["duck"], next_input, probe_has_audio(src_video))
            inputs += g["inputs"]
            audio_parts = g["parts"]
            audio_map = ["-map", g["last"]]
            audio_codec = ["-c:a", "aac", "-b:a", "192k", "-ar", str(music_mix.SAMPLE_RATE)]
            limit = ["-t", f"{total:.3f}"]  # the mix is as long as the video, and no longer
            next_input += len(mplan["clips"])
            duck_note = f", abaixando {mplan['duck']['db']:g} dB quando há fala" if mplan["duck"] else ""
            log(f"Música: {len(mplan['clips'])} trecho(s) de {len({c['audio_id'] for c in mplan['clips']})} faixa(s){duck_note}.")

    # Sound effects of the cuts: over the voice (and the music), at the moment of each transition
    cuts_plan = lk.get("cuts") or []
    lens = lk.get("lens")
    if lk.get("sfx") and lens and len(lens) == len(cuts_plan) + 1:
        stream = probe_video_stream(src_video)
        if abs(sum(lens) - stream["duration"]) > max(0.3, 0.01 * stream["duration"]):
            log("Aviso: os cortes medidos não batem com o vídeo: os sons das transições foram ignorados.")
        else:
            cut_times = looks.timeline(lens, stream["start"])[1:]
            sounds = sfx.plan(cut_times, cuts_plan, total, stream["start"], sfx.lookup(), log)
            if sounds:
                base = audio_map[1] if audio_parts else ("[0:a]" if probe_has_audio(src_video) else None)
                g = sfx.build_graph(sounds, base, total, next_input)
                inputs += g["inputs"]
                audio_parts += g["parts"]
                audio_map = ["-map", g["last"]]
                audio_codec = ["-c:a", "aac", "-b:a", "192k", "-ar", str(sfx.SAMPLE_RATE)]
                limit = ["-t", f"{total:.3f}"]
                next_input += len(sounds)
                log(f"Sons nas transições: {len(sounds)}.")

    if not video_parts and not audio_parts:  # nothing to draw or mix (headline skipped, no captions/split/adjustments/music): keep the cut as is
        shutil.copy2(src_video, out_path)
        return

    if video_parts:
        video_map = ["-map", last]
        video_codec = ["-c:v", "libx264", "-preset", "veryfast" if is_preview else "fast",
                       "-crf", "22" if is_preview else "18", "-pix_fmt", "yuv420p"]
    else:  # only the sound changes: the picture is not touched (no second x264 generation)
        video_map = ["-map", "0:v"]
        video_codec = ["-c:v", "copy"]

    # Relative paths + cwd keep Windows drive colons out of the filtergraph
    cmd = [
        "ffmpeg", "-y", *inputs,
        *filter_args(";".join(video_parts + audio_parts), edit_dir),
        *video_map, *audio_map, *limit,
        *video_codec, *audio_codec, "-movflags", "+faststart",
        str(out_path),
    ]
    proc = subprocess.run(cmd, cwd=str(edit_dir), capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError("Falha ao aplicar headline/legendas/música:\n" + proc.stderr[-1500:])


def prepare_look(post: dict, edl_data: dict, log: Callable[[str], None]) -> dict:
    """Reads the look settings (LUT, zoom, transition) of a render request.

    With a LUT the grade preset moves out of render.py and into compose_final, so that the order is LUT -> preset
    -> adjustments (what the preview draws). The preset "auto" (per-clip analysis) has to stay in render.py, so
    with it the LUT comes after the preset.
    Returns {"lut", "preset_filter", "zoom", "effects", "transition"}; "lens" is added once the cuts are measured."""
    wanted = luts.sanitize_lut(post.get("lut"))
    lut = luts.resolve(wanted)
    if wanted["id"] and wanted["intensity"] >= 0.005 and not lut:
        log("Aviso: o LUT escolhido não existe mais (foi excluído?): o vídeo será renderizado sem ele.")
    preset_filter = ""
    if lut:
        raw = grade_to_edl(post.get("grade"))
        if raw not in ("none", "auto"):
            preset_filter = raw
            edl_data["grade"] = "none"
        elif raw == "auto":
            log("Aviso: com o grade automático o LUT é aplicado depois dele.")
        log(f"LUT “{lut['name']}” a {round(lut['intensity'] * 100)}%.")
    zoom = looks.sanitize_zoom(post.get("zoom"))
    transition = tr.sanitize_id(post.get("transition"))
    ranges = edl_data.get("ranges") or []
    keys = [tr.cut_key(r["start"]) for r in ranges[1:]]
    cuts = tr.resolve_cuts(transition, tr.sanitize_scale(post.get("transition_scale", 1.0)),
                           post.get("transition_sound"), post.get("cut_transitions"), keys)
    per_cut = [c["effects"] for c in cuts]
    effects = [fx for c in cuts for fx in c["effects"]]
    chosen = sum(1 for c in cuts if c["custom"])
    if zoom["enabled"]:
        log(f"Zoom nos cortes: {zoom['style']}, {round((zoom['amount'] - 1) * 100)}%.")
    if effects:
        log(f"Transição entre cortes: {tr.get(transition)['name']}"
            + (f" ({chosen} corte(s) com transição ou som escolhidos à mão)." if chosen else "."))
    sounds = sum(1 for c in cuts if c["sound"])
    return {"lut": lut, "preset_filter": preset_filter, "zoom": zoom, "effects": effects, "per_cut": per_cut, "cuts": cuts,
            "sfx": sounds > 0, "transition": transition}


def run_render_job(
    job_id: str,
    project_dir: Path,
    edl_data: dict,
    subtitle_style: dict | None,
    enable_subtitles: bool,
    headline_config: dict | None,
    is_preview: bool = False,
    post: dict | None = None,
) -> None:
    """Execute rendering pipeline in background thread and update JOBS dictionary.

    `post` = {"grade": id, "grade_adjust": {...}, "split": {...}, "music": {...}, "lut": {...}, "zoom": {...},
    "transition": id, "transition_scale": x, "canvas": {...}}: what the last pass adds (see compose_final)."""
    job = JOBS[job_id]
    job["status"] = "processing"
    job["progress"] = 5
    job["logs"].append("Iniciando pipeline de renderização...")

    try:
        edit_dir = project_dir / "edit"
        edit_dir.mkdir(parents=True, exist_ok=True)
        
        # Save edl.json
        edl_path = edit_dir / "edl.json"
        edl_path.write_text(json.dumps(edl_data, indent=2), encoding="utf-8")
        job["logs"].append(f"EDL salva com {len(edl_data['ranges'])} corte(s)")
        job["progress"] = 15

        # 1. Subtitles: cues + style now, burned in after the cuts are rendered (Rule 1: last)
        style = sanitize_style(subtitle_style)
        cues = []
        if enable_subtitles:
            audio_timeline.ensure_project_transcripts(project_dir)   # captions must be on the same clock as the cuts
            cues = build_cues(edl_data["ranges"], edit_dir / "transcripts", style)
            if cues:
                job["logs"].append(
                    f"Legendas geradas: {len(cues)} frases em {style['font_family']} {style['font_weight']}"
                )
            else:
                job["logs"].append("Nenhuma palavra transcrita nos cortes: legendas ignoradas (transcreva o vídeo primeiro).")
        job["progress"] = 30

        # 2. Headline: the editor sends the finished PNG (drawn by the same code as the live
        # preview). It goes over the video in the final pass, so render.py gets no overlays.
        try:
            headline = parse_headline_request(headline_config)
        except ValueError as exc:
            job["logs"].append(f"Erro no headline: {exc}")
            job["status"] = "error"
            job["error"] = f"Headline: {exc}"
            return
        if headline:
            job["logs"].append(
                f"Headline recebido ({headline['width']}x{headline['height']}): aparece em "
                f"{headline['start']:.1f}s por {headline['duration']:.1f}s, animação '{headline['animation']}'"
            )
        edl_data["overlays"] = []
        edl_path.write_text(json.dumps(edl_data, indent=2), encoding="utf-8")
        job["progress"] = 45

        # 2b. Fine colour adjustments and split screen are drawn in the last pass too
        post = post or {}
        grade_filter = grade_adjust_filter(post.get("grade_adjust"))
        if grade_filter:
            job["logs"].append("Ajuste fino de cor será aplicado na passada final.")
        look = prepare_look(post, edl_data, job["logs"].append)
        track_cfg = face_track.sanitize_track(post.get("track"))
        track = None
        if track_cfg["enabled"]:
            track_data = face_track.load(project_dir)
            if track_data:
                track = {"cfg": track_cfg, "data": track_data, "ranges": edl_data["ranges"]}
            else:
                job["logs"].append("Aviso: o rastreio de rosto está ligado, mas o vídeo ainda não foi analisado (aba Rastrear): ignorado.")
        look_active = bool(look["lut"]) or look["zoom"]["enabled"] or bool(look["effects"]) or look["sfx"] or track is not None
        canvas_cfg = canvas_frame.sanitize_canvas(post.get("canvas"))
        canvas_wanted = canvas_cfg["ratio"] != "original" or not canvas_frame.is_identity(canvas_cfg["transform"])
        if look["preset_filter"]:   # the grade preset moved to the last pass (after the LUT): render.py must not apply it too
            edl_path.write_text(json.dumps(edl_data, indent=2), encoding="utf-8")
        split_cfg = split_screen.sanitize_split(post.get("split"))
        split_plan = None
        if split_cfg["mode"] != "off":
            segments, warns = split_screen.resolve_segments(
                split_cfg, float(edl_data.get("total_duration_s") or 0), media_library.lookup(project_dir.name))
            job["logs"] += [f"Aviso: {w}" for w in warns]
            if segments:
                split_plan = {"segments": segments, "layout": split_cfg["layout"], "ratio": split_cfg["ratio"], "focus": split_cfg["focus"]}
                job["logs"].append(
                    f"Tela dividida ({'vídeo inteiro' if split_cfg['mode'] == 'full' else 'por cenas'}, mídia "
                    f"{ {'top': 'em cima', 'bottom': 'embaixo', 'left': 'à esquerda', 'right': 'à direita'}[split_cfg['layout']] }): "
                    f"{len(segments)} trecho(s)")

        motion_cfg = motion_graphics.sanitize_motion(post.get("motion")) if post.get("motion") else None
        motion_renders = projects.read_state(project_dir.name).get("motion_renders") if motion_cfg else None

        music_cfg = music_mix.sanitize_music(post.get("music")) if post.get("music") else None
        if music_cfg and not music_mix.is_audible(music_cfg):
            music_cfg = None
        if music_cfg:
            n_clips = sum(len(t["clips"]) for t in music_cfg["tracks"] if not t["muted"])
            job["logs"].append(f"Música de fundo: {n_clips} trecho(s) em {sum(1 for t in music_cfg['tracks'] if not t['muted'] and t['clips'])} camada(s) "
                               f"serão mixados na passada final.")

        motion_active = bool(motion_cfg and motion_cfg.get("enabled") and motion_cfg.get("items"))
        motion_follows = bool(motion_active and any(motion_track.is_following(i.get("follow")) for i in motion_cfg["items"]))

        # 3. Cut, grade and normalise with render.py (never with its own subtitles/overlays)
        out_filename = "preview.mp4" if is_preview else "final.mp4"
        out_path = edit_dir / out_filename
        compose = (bool(cues) or headline is not None or bool(grade_filter) or split_plan is not None or music_cfg is not None
                   or look_active or canvas_wanted or motion_active)
        cut_path = out_path.with_name(f"{out_path.stem}.nosub.mp4") if compose else out_path

        render_py = HELPERS_DIR / "render.py"
        job["logs"].append("Extraindo cortes com micro-fades de 30ms e aplicando color grade...")
        job["progress"] = 60

        cmd = [*script_command(), str(render_py), str(edl_path), "-o", str(cut_path), "--no-subtitles"]
        if is_preview:
            cmd.append("--preview")

        job["logs"].append(f"Executando FFmpeg: {' '.join(cmd)}")
        proc = subprocess.run(
            cmd,
            cwd=str(HELPERS_DIR.parent),
            capture_output=True,
            text=True
        )

        if proc.returncode != 0:
            job["logs"].append("Erro no FFmpeg:\n" + proc.stderr)
            job["status"] = "error"
            job["error"] = proc.stderr
            return

        job["logs"].append("Normalização de áudio para -14 LUFS concluída!")
        job["progress"] = 80

        # 4. Headline + styled captions in one last pass
        if compose:
            if look["zoom"]["enabled"] or look["effects"] or look["sfx"] or track or motion_follows:
                # render.py cuts on whole frames: measure how long each clip really came out
                look["lens"] = measure_clips(edit_dir, len(edl_data["ranges"]), is_preview)
                if not look["lens"]:
                    look["lens"] = [float(r["end"]) - float(r["start"]) for r in edl_data["ranges"]]
                    job["logs"].append("Aviso: não consegui medir os clipes; usei as durações da EDL para o zoom, as transições e o rastreio.")
            what = " e ".join(x for x in ("enquadramento" if canvas_wanted else "", "LUT" if look["lut"] else "",
                                           "ajuste de cor" if grade_filter else "",
                                           "câmera seguindo o rosto" if track else "",
                                           "zoom nos cortes" if look["zoom"]["enabled"] else "",
                                           "transições" if look["effects"] else "", "sons nas transições" if look["sfx"] else "",
                                           "tela dividida" if split_plan else "",
                                           "motion graphics" if motion_active else "",
                                           "headline" if headline else "", "legendas" if cues else "",
                                           "música de fundo" if music_cfg else "") if x)
            job["logs"].append(f"Aplicando {what}...")
            compose_final(cut_path, out_path, edit_dir, cues, style, headline, is_preview, job["logs"].append,
                          grade_filter=grade_filter, split=split_plan, music=music_cfg, look=look, canvas=canvas_cfg,
                          motion=motion_cfg, motion_renders=motion_renders, track=track,
                          motion_ctx={"ranges": edl_data["ranges"], "source_video": project_dir / projects.read_info(project_dir.name)["source_name"]}
                          if motion_follows else None)
            cut_path.unlink(missing_ok=True)

        job["logs"].append(f"Vídeo final renderizado com sucesso: {out_path.name}")
        projects.record_render(project_dir.name, out_path, is_preview)
        job["progress"] = 100
        job["status"] = "completed"
        job["output_url"] = f"{URL_BASE}/api/projects/{project_dir.name}/video/{out_filename}"
        job["output_path"] = str(out_path)

    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        job["logs"].append(f"Exceção durante a renderização: {exc}")

def start_render(
    project_dir: Path,
    edl_data: dict,
    subtitle_style: dict | None,
    enable_subtitles: bool,
    headline_config: dict | None,
    is_preview: bool = False,
    post: dict | None = None,
) -> str:
    """Start asynchronous render job and return job_id."""
    job_id = f"render_{int(time.time())}"
    JOBS[job_id] = {
        "id": job_id,
        "status": "pending",
        "progress": 0,
        "logs": [],
        "created_at": time.time(),
        "is_preview": is_preview
    }
    
    t = threading.Thread(
        target=run_render_job,
        args=(job_id, project_dir, edl_data, subtitle_style, enable_subtitles, headline_config, is_preview, post),
        daemon=True
    )
    t.start()
    return job_id
