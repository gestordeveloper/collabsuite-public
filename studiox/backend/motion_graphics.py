"""Motion graphics via Remotion: a small catalog of pre-built React compositions (see motion/src/
templates/) whose props the user — or an LLM, through motion_llm.suggest_props — fills in. Each item
is rendered ONCE by motion_render.py (a Node subprocess) to a cached transparent WebM, then overlaid
by ffmpeg in render_service.compose_final exactly like split_screen/headline already are: a time-
shifted input + `overlay=...:enable='between(t,a,b)'` (see split_screen.build_graph for the pattern
this mirrors).

Two states live separately on purpose:
  - `edit.motion` (this module's sanitize_motion): the EDITABLE fields the user controls (which
    template, which props, when it starts, how long it lasts). Travels through the same
    projects.sanitize_edit whitelist as music/split/zoom.
  - `state["motion_renders"]` (a sibling of `edit`, like the existing top-level `render`/`queue`
    keys — see projects.read_state/record_render): the SERVER-OWNED render status/asset path per
    item, written only by motion_render.py. Never trust a client-supplied asset path: resolve_plan
    below always rebuilds the file path itself from `edit_dir/motion/<item_id>_<cache_key>.webm`.

Armadilha medida (2026-09-30): o decoder nativo de VP8 deste build do ffmpeg (9.0.1 gyan.dev) ignora
o canal alpha de um WebM e devolve yuv420p opaco; só decodifica o alpha certo com `-c:v libvpx`
explícito ANTES do `-i`. Validado comparando um frame extraído direto (alpha 0..255 variando) contra
o mesmo frame sem a flag (alpha sempre 255). build_graph() sempre inclui essa flag.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from backend import motion_code, motion_track

MAX_ITEMS = 40
MAX_CODE = motion_code.MAX_CODE
DEFAULT_CODE = motion_code.DEFAULT_CODE
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

SCALE_PROP = {"type": "number", "min": 30, "max": 300, "default": 100}   # % of the template's natural size

MOTION_TEMPLATES: dict[str, dict[str, Any]] = {
    "kinetic-title": {
        "name": "Título cinético",
        "description": "Texto revelado palavra a palavra, com entrada em mola. Use *palavra* para destacar (igual ao headline).",
        "default_duration": 3.5,
        "trackable": True,
        "props": {
            "text": {"type": "text", "max": 300, "default": "Seu título aqui"},
            "color": {"type": "color", "default": "#ffffff"},
            "highlightColor": {"type": "color", "default": "#ff7a1a"},
            "fontSize": {"type": "number", "min": 24, "max": 220, "default": 90},
            "align": {"type": "enum", "values": ["left", "center", "right"], "default": "center"},
        },
    },
    "lower-third": {
        "name": "Lower third (nome/cargo)",
        "description": "Cartão deslizando pela esquerda embaixo da tela, com nome e um subtítulo (cargo, canal...).",
        "default_duration": 4.0,
        "props": {
            "name": {"type": "text", "max": 80, "default": "Seu Nome"},
            "subtitle": {"type": "text", "max": 100, "default": "Seu cargo ou canal"},
            "accentColor": {"type": "color", "default": "#ec1889"},
            "textColor": {"type": "color", "default": "#ffffff"},
        },
    },
    "counter": {
        "name": "Contador animado",
        "description": "Número subindo de 0 até o valor pedido, com um rótulo embaixo (ex.: \"+10.000 clientes\").",
        "default_duration": 3.0,
        "trackable": True,
        "props": {
            "value": {"type": "number", "min": 0, "max": 999999999, "default": 100},
            "prefix": {"type": "text", "max": 10, "default": ""},
            "suffix": {"type": "text", "max": 10, "default": ""},
            "label": {"type": "text", "max": 100, "default": "clientes atendidos"},
            "color": {"type": "color", "default": "#ffffff"},
            "scale": SCALE_PROP,
        },
    },
    "badge": {
        "name": "Selo/destaque",
        "description": "Selo chamativo que entra saltando (ex.: \"NOVO\", \"50% OFF\"), levemente girado.",
        "default_duration": 2.5,
        "trackable": True,
        "props": {
            "text": {"type": "text", "max": 40, "default": "NOVO"},
            "bgColor": {"type": "color", "default": "#ec1889"},
            "textColor": {"type": "color", "default": "#ffffff"},
            "scale": SCALE_PROP,
        },
    },
    "callout": {
        "name": "Etiqueta com seta",
        "description": "Etiqueta de texto com uma seta que aponta para um ponto (a ponta da seta fica no centro do quadro, ou no alvo que ela segue). Ex.: \"clique aqui\", \"olha isso\".",
        "default_duration": 3.0,
        "trackable": True,
        "props": {
            "text": {"type": "text", "max": 60, "default": "Olha isso!"},
            "direction": {"type": "enum", "values": ["up", "down", "left", "right"], "default": "up"},
            "bgColor": {"type": "color", "default": "#ec1889"},
            "textColor": {"type": "color", "default": "#ffffff"},
            "scale": SCALE_PROP,
        },
    },
    "focus-ring": {
        "name": "Anel de destaque",
        "description": "Anel pulsante que chama atenção para um ponto (no centro do quadro, ou no alvo que ele segue), com um texto curto opcional embaixo.",
        "default_duration": 3.0,
        "trackable": True,
        "props": {
            "label": {"type": "text", "max": 40, "default": ""},
            "color": {"type": "color", "default": "#ec1889"},
            "textColor": {"type": "color", "default": "#ffffff"},
            "size": {"type": "number", "min": 80, "max": 700, "default": 240},
            "scale": SCALE_PROP,
        },
    },
    "data-rain": {
        "name": "Chuva de dados (Matrix)",
        "description": "Caracteres caindo pelo quadro inteiro, estilo Matrix: números, letras ou símbolos à escolha (campo chars, ex.: \"0123456789\", \"01\", \"$%+€\"). Cobre o vídeo todo; não segue nada.",
        "default_duration": 4.0,
        "props": {
            "chars": {"type": "text", "max": 60, "default": "0123456789"},
            "color": {"type": "color", "default": "#00ff66"},
            "speed": {"type": "number", "min": 1, "max": 10, "default": 4},
            "density": {"type": "number", "min": 10, "max": 100, "default": 60},
            "fontSize": {"type": "number", "min": 18, "max": 90, "default": 34},
            "direction": {"type": "enum", "values": ["down", "up"], "default": "down"},
        },
    },
    "custom": {
        "name": "Personalizado (a IA cria)",
        "description": "Animação feita sob medida pela IA quando nenhum outro modelo serve (efeitos livres: partículas, formas, textos animados, fundos...). O código é gerado a partir do pedido; props.prompt guarda o pedido e props.code o código.",
        "default_duration": 4.0,
        "ai_generated": True,
        "props": {
            "prompt": {"type": "text", "max": 600, "default": ""},
            "code": {"type": "code", "max": MAX_CODE, "default": DEFAULT_CODE},
        },
    },
    "sticker": {
        "name": "Emoji / adesivo",
        "description": "Um emoji grande que entra animado (ex.: 🔥 👆 ⭐ ❤️). Use 1 ou 2 emojis.",
        "default_duration": 2.5,
        "trackable": True,
        "props": {
            "emoji": {"type": "text", "max": 8, "default": "🔥"},
            "animation": {"type": "enum", "values": ["pop", "bounce", "pulse", "spin"], "default": "pop"},
            "scale": SCALE_PROP,
        },
    },
}


def sanitize_props(template_id: str, raw: Any) -> dict[str, Any]:
    tpl = MOTION_TEMPLATES.get(template_id)
    if not tpl:
        return {}
    raw = raw if isinstance(raw, dict) else {}
    props: dict[str, Any] = {}
    for key, spec in tpl["props"].items():
        v = raw.get(key)
        kind = spec["type"]
        if kind == "text":
            props[key] = str(v)[: spec["max"]] if isinstance(v, (str, int, float)) and str(v).strip() else spec["default"]
        elif kind == "code":
            props[key] = v if isinstance(v, str) and motion_code.validate(v) is None else spec["default"]
        elif kind == "color":
            props[key] = v if isinstance(v, str) and HEX_RE.match(v) else spec["default"]
        elif kind == "number":
            # Always a float, whether the value came from the request or from the catalog's own
            # default: letting one path stay `int` while the other becomes `float` changes the
            # JSON string cache_key() hashes, so an unrelated field (say, a default fontSize) would
            # silently never match between the item's own render and a later re-render — found by
            # comparing pixels of a composited test video, not by reading the logs.
            try:
                n = float(v)
            except (TypeError, ValueError):
                n = float(spec["default"])
            props[key] = round(float(min(spec["max"], max(spec["min"], n))), 3)
        elif kind == "enum":
            props[key] = v if v in spec["values"] else spec["default"]
    return props


def sanitize_motion(raw: Any) -> dict[str, Any]:
    """Whitelists and clamps edit.motion before it is stored (same shape/spirit as
    music_mix.sanitize_music / split_screen.sanitize_split)."""
    raw = raw if isinstance(raw, dict) else {}
    items = []
    for i, it in enumerate((raw.get("items") or [])[:MAX_ITEMS]):
        if not isinstance(it, dict):
            continue
        template_id = str(it.get("template_id") or "")
        if template_id not in MOTION_TEMPLATES:
            continue
        start = max(0.0, min(36000.0, _as_float(it.get("start"), 0.0)))
        duration = max(0.3, min(60.0, _as_float(it.get("duration"), MOTION_TEMPLATES[template_id]["default_duration"])))
        scope = it.get("scope") if it.get("scope") in ("project", "clip") else "project"
        clip_id = str(it.get("clip_id"))[:80] if scope == "clip" and it.get("clip_id") else None
        item_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(it.get("id") or ""))[:40] or f"motion_{i + 1}"
        items.append({
            "id": item_id,
            "template_id": template_id,
            "scope": scope,
            "clip_id": clip_id,
            "start": round(start, 3),
            "duration": round(duration, 3),
            "props": sanitize_props(template_id, it.get("props")),
            "follow": (motion_track.sanitize_follow(it.get("follow")) if MOTION_TEMPLATES[template_id].get("trackable")
                       else dict(motion_track.DEFAULT_FOLLOW)),
        })
    return {"enabled": bool(raw.get("enabled", True)), "items": items}


def _as_float(raw: Any, default: float) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return default
    return default if v != v else v  # NaN


def cache_key(item: dict, width: int, height: int, fps: float) -> str:
    """Hashes everything that changes the rendered pixels, so an unrelated edit (e.g. moving the
    clip) does not force a re-render, but changing text/color/size/duration/output size does."""
    payload = json.dumps({
        "template_id": item["template_id"], "props": item["props"], "duration": item["duration"],
        "width": width, "height": height, "fps": round(fps, 3),
    }, sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def asset_path(edit_dir: Path, item_id: str, key: str) -> Path:
    return edit_dir / "motion" / f"{item_id}_{key}.webm"


def resolve_plan(motion: dict | None, motion_renders: dict | None, edit_dir: Path,
                 width: int, height: int, fps: float) -> list[dict[str, Any]] | None:
    """Items ready to composite: enabled, rendered (status == done, matching cache key) and whose
    file actually exists on disk. The file path is always rebuilt from item id + cache key here —
    never taken from client input (motion_renders is server-owned, see module docstring)."""
    if not motion or not motion.get("enabled") or not motion.get("items"):
        return None
    motion_renders = motion_renders or {}
    plan = []
    for item in motion["items"]:
        key = cache_key(item, width, height, fps)
        render = motion_renders.get(item["id"]) or {}
        if render.get("status") != "done" or render.get("cache_key") != key:
            continue
        path = asset_path(edit_dir, item["id"], key)
        if not path.exists():
            continue
        plan.append({**item, "cache_key": key, "path": path})
    return plan or None


def build_graph(plan: list[dict[str, Any]], base_label: str, first_input: int) -> dict[str, Any]:
    """ffmpeg pieces that overlay each already-rendered item at its start time, in order (same
    contract as split_screen.build_graph: returns {inputs, parts, last})."""
    inputs: list[str] = []
    parts: list[str] = []
    last = base_label
    for i, item in enumerate(plan):
        start, dur = item["start"], item["duration"]
        shift = f"setpts=PTS-STARTPTS+{start:.3f}/TB"
        # -c:v libvpx (not ffmpeg's native vp8 decoder) is required to read the alpha plane back —
        # see the module docstring's armadilha.
        inputs += ["-c:v", "libvpx", "-i", str(item["path"])]
        label = f"mo{i}"
        parts.append(f"[{first_input + i}:v]{shift}[{label}]")
        out_label = f"[mo_out{i}]" if i < len(plan) - 1 else "[motionv]"
        track = item.get("track_expr")
        if track:
            # A followed item: its full-frame video slides by (X - 0.5) * W / (Y - 0.5) * H, and only shows while the
            # target is in view (see motion_track.build_exprs)
            parts.append(f"{last}[{label}]overlay=x='{track['x']}':y='{track['y']}':eval=frame:"
                         f"enable='({track['enable']})*between(t,{start:.3f},{start + dur:.3f})'{out_label}")
        else:
            parts.append(f"{last}[{label}]overlay=0:0:enable='between(t,{start:.3f},{start + dur:.3f})'{out_label}")
        last = out_label
    return {"inputs": inputs, "parts": parts, "last": last}
