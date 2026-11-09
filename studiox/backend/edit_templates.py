"""Edit templates: a ready-made look (subtitle style + headline + colour grade + LUT + transition + zoom on the
cuts) plus what the automatic queue should do with a new video.

Three built-in templates ship with the app. They behave like the user's own: they can be edited (the edited
copy is stored as an override and the original can be restored) and deleted (hidden, and brought back with
"restore"). The user's own templates and those overrides live in storage/edit_templates.json.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from typing import Any

from backend import headlines as hl
from backend import transitions as tr
from backend.config import STORAGE_DIR
from backend.fsutil import replace_file
from backend.credentials import PROVIDERS
from backend.looks import DEFAULT_ZOOM
from backend.projects import _s, now_iso, sanitize_edit
from backend.subtitles import sanitize_style as sanitize_subtitle_style
from backend.templates import (
    COLOR_GRADE_PRESETS, HEADLINE_TEMPLATES, SUBTITLE_TEMPLATES, TRANSITION_TEMPLATES, sanitize_grade_adjust,
)

TEMPLATES_PATH = STORAGE_DIR / "edit_templates.json"
_lock = threading.RLock()
PROVIDER_IDS = tuple(PROVIDERS)

DEFAULT_PIPELINE: dict[str, Any] = {
    "auto_cut": True,        # cut the silences (the first cut list made at upload)
    "transcribe": True,      # transcribe (needed for subtitles)
    # Review of the transcript, which decides the final cuts (recording errors, retakes, stutters):
    #   off | local (rules, free) | llm (AI provider) | auto (llm when a key is configured, else local)
    "ai_review": "off",
    "ai_provider": "",       # "" = the default provider of the settings screen
    "ai_model": "",          # "" = that provider's saved model
    "ai_fix_words": True,    # also correct mis-heard words in the transcript (better subtitles)
    "language": "pt",
    "engine": "auto",        # auto | elevenlabs | groq | groq_turbo | whisper (see backend/transcriber.py)
    "render_mode": "final",  # final | preview
}
ENGINES = ("auto", "elevenlabs", "groq", "groq_turbo", "whisper")
# What older templates (saved before these features) get for the fields they do not have
LOOK_DEFAULTS: dict[str, Any] = {"lut": {"id": "", "intensity": 1.0}, "zoom": dict(DEFAULT_ZOOM), "transition_scale": 1.0,
                                 "transition_sound": {"id": "", "volume": 0.8, "offset": 0.0}}
LOOK_KEYS = tuple(LOOK_DEFAULTS)
AI_MODES = ("off", "local", "llm", "auto")
RENDER_MODES = ("final", "preview")


def _by_id(items: list[dict], item_id: str) -> dict:
    return next(i for i in items if i["id"] == item_id)


def _look(subtitle_id: str, headline_id: str, grade: str, headline_on: bool, headline_tag: str = "") -> dict:
    sub = _by_id(SUBTITLE_TEMPLATES, subtitle_id)
    head = _by_id(HEADLINE_TEMPLATES, headline_id)
    return {
        "subtitles": {"enabled": True, "preset_id": sub["id"], "style": sanitize_subtitle_style(sub["style"])},
        "headline": {
            "enabled": headline_on, "preset_id": head["id"], "style": hl.sanitize_style(head["style"]),
            "text": "", "tag": headline_tag, "start": 0.0, "duration": 4.0,
        },
        "grade": grade,
        "transition": "micro_fade_30ms",
        **LOOK_DEFAULTS,
    }


def builtin_templates() -> list[dict]:
    return [
        {"id": "builtin_viral", "name": "Viral Social", "builtin": True,
         "description": "Legenda TikTok em caixa alta, banner de retenção no topo e grade quente.",
         **_look("tiktok_bold", "top_hook_banner", "warm_cinematic", True),
         "pipeline": {**DEFAULT_PIPELINE, "ai_review": "auto"}},
        {"id": "builtin_clean", "name": "Clean Profissional", "builtin": True,
         "description": "Legenda minimalista sobre caixa translúcida, sem headline, cores naturais.",
         **_look("minimal_clean", "lower_third", "neutral_punch", False),
         "pipeline": {**DEFAULT_PIPELINE, "ai_review": "auto"}},
        {"id": "builtin_cinema", "name": "Cinema Storytelling", "builtin": True,
         "description": "Legenda serifada itálica e headline editorial, com grade cinematográfica.",
         **_look("cinematic_serif", "editorial_serif", "warm_cinematic", True),
         "pipeline": {**DEFAULT_PIPELINE, "ai_review": "auto"}},
    ]


def sanitize_pipeline(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    p = dict(DEFAULT_PIPELINE)
    for key in ("auto_cut", "transcribe", "ai_fix_words"):
        if key in raw:
            p[key] = bool(raw[key])
    if raw.get("ai_review") in AI_MODES:
        p["ai_review"] = raw["ai_review"]
    elif raw.get("ai_cleanup"):  # templates saved before the AI review existed
        p["ai_review"] = "local"
    prov = _s(raw.get("ai_provider"), 20)
    p["ai_provider"] = prov if prov in PROVIDER_IDS else ""
    p["ai_model"] = _s(raw.get("ai_model"), 120)
    p["language"] = _s(raw.get("language"), 12, "pt") or "pt"
    p["engine"] = raw.get("engine") if raw.get("engine") in ENGINES else "auto"
    p["render_mode"] = raw.get("render_mode") if raw.get("render_mode") in RENDER_MODES else "final"
    return p


def sanitize_template(raw: Any, template_id: str | None = None, fallback: dict | None = None) -> dict[str, Any]:
    """Validates a template coming from the client (or from the editor's current state).
    `fallback` is the template being edited: a field the client did not send (a screen from before LUT / zoom
    existed) keeps its saved value instead of going back to the default."""
    raw = dict(raw) if isinstance(raw, dict) else {}
    for key in LOOK_KEYS:
        if raw.get(key) is None and fallback and fallback.get(key) is not None:
            raw[key] = fallback[key]
    look = sanitize_edit({
        "clips": [], "grade": raw.get("grade"), "transition": raw.get("transition"),
        "subtitles": raw.get("subtitles"), "headline": raw.get("headline"), "grade_adjust": raw.get("grade_adjust"),
        "lut": raw.get("lut"), "zoom": raw.get("zoom"), "transition_scale": raw.get("transition_scale"),
        "transition_sound": raw.get("transition_sound"),
    }) or {}
    grade_ids = {g["id"] for g in COLOR_GRADE_PRESETS}
    if look["grade"] not in grade_ids:
        look["grade"] = "warm_cinematic"
    if not tr.is_known(look["transition"]):
        look["transition"] = "micro_fade_30ms"
    name = _s(raw.get("name"), 60) or "Meu template"
    return {
        "id": template_id or f"tpl_{uuid.uuid4().hex[:8]}",
        "name": name,
        "description": _s(raw.get("description"), 200),
        "builtin": False,
        "subtitles": look["subtitles"],
        "headline": look["headline"],
        "grade": look["grade"],
        "grade_adjust": look["grade_adjust"],
        "transition": look["transition"],
        "transition_scale": look["transition_scale"],
        "transition_sound": look["transition_sound"],
        "lut": look["lut"],
        "zoom": look["zoom"],
        "pipeline": sanitize_pipeline(raw.get("pipeline")),
    }


def _with_defaults(t: dict) -> dict:
    """A template saved before LUT / zoom existed reads as having them switched off."""
    return {**{k: (dict(v) if isinstance(v, dict) else v) for k, v in LOOK_DEFAULTS.items()}, **t}


# ----------------------------------------------------------------------------
# Storage
# ----------------------------------------------------------------------------
def _load() -> dict:
    try:
        data = json.loads(TEMPLATES_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("templates", [])
            return data
    except (OSError, ValueError):
        pass
    return {"templates": [], "default_id": None}


def _builtin_ids() -> set[str]:
    return {t["id"] for t in builtin_templates()}


def _save(data: dict) -> None:
    tmp = TEMPLATES_PATH.with_name(f"{TEMPLATES_PATH.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    replace_file(tmp, TEMPLATES_PATH)


def list_all() -> dict:
    """{"templates": [...], "default_id", "hidden": [ids of built-ins that were deleted]}.
    A built-in carries builtin=True (a "ready-made" badge) and customized=True when the user edited it."""
    with _lock:
        data = _load()
    hidden = [i for i in (data.get("hidden") or []) if i in _builtin_ids()]
    overrides = data.get("overrides") if isinstance(data.get("overrides"), dict) else {}
    templates: list[dict] = []
    for t in builtin_templates():
        if t["id"] in hidden:
            continue
        ov = overrides.get(t["id"])
        if isinstance(ov, dict):
            t = {**t, **ov, "id": t["id"], "builtin": True, "customized": True,
                 "description": ov.get("description") or t["description"]}
        templates.append(_with_defaults(t))
    templates += [_with_defaults(t) for t in data["templates"] if isinstance(t, dict) and t.get("id")]
    ids = [t["id"] for t in templates]
    default_id = data.get("default_id") if data.get("default_id") in ids else (ids[0] if ids else None)
    return {"templates": templates, "default_id": default_id, "hidden": hidden}


def get(template_id: str | None) -> dict | None:
    everything = list_all()
    wanted = template_id or everything["default_id"]
    return next((t for t in everything["templates"] if t["id"] == wanted), None)


def save(raw: Any, template_id: str | None = None, make_default: bool = False) -> dict:
    """Creates a template, or replaces the template `template_id`. Saving a built-in stores an override of it."""
    with _lock:
        data = _load()
        if template_id in _builtin_ids():
            return _save_builtin(data, raw, template_id, make_default)
        existing = next((t for t in data["templates"] if t.get("id") == template_id), None) if template_id else None
        if existing is None and not template_id:
            # Saving again under the same name updates that template (the way to refine one)
            wanted = _s((raw or {}).get("name"), 60).lower()
            existing = next((t for t in data["templates"] if t.get("name", "").strip().lower() == wanted), None) if wanted else None
        tpl = sanitize_template(raw, existing["id"] if existing else None, fallback=existing)
        if existing and (raw or {}).get("description") is None:
            tpl["description"] = existing.get("description", "")   # editing must not wipe the description
        stamp = now_iso()
        tpl["created_at"] = existing.get("created_at", stamp) if existing else stamp
        tpl["updated_at"] = stamp
        if existing:
            data["templates"] = [tpl if t.get("id") == tpl["id"] else t for t in data["templates"]]
        else:
            data["templates"].append(tpl)
        if make_default:
            data["default_id"] = tpl["id"]
        _save(data)
        return tpl


def _save_builtin(data: dict, raw: Any, template_id: str, make_default: bool) -> dict:
    original = next(t for t in builtin_templates() if t["id"] == template_id)
    current = (data.get("overrides") or {}).get(template_id) or original
    tpl = sanitize_template(raw, template_id, fallback=current)
    if (raw or {}).get("description") is None:
        tpl["description"] = original["description"]
    tpl["updated_at"] = now_iso()
    data.setdefault("overrides", {})[template_id] = tpl
    data["hidden"] = [i for i in (data.get("hidden") or []) if i != template_id]
    if make_default:
        data["default_id"] = template_id
    _save(data)
    return {**original, **tpl, "id": template_id, "builtin": True, "customized": True}


def delete(template_id: str) -> str:
    """"deleted" | "missing" | "last" (the queue always needs one template, so the last one stays).
    A built-in is hidden, not destroyed: restore() brings it back."""
    with _lock:
        data = _load()
        current = list_all()["templates"]
        if template_id not in {t["id"] for t in current}:
            return "missing"
        if len(current) <= 1:
            return "last"
        if template_id in _builtin_ids():
            data["hidden"] = sorted(set(data.get("hidden") or []) | {template_id})
            (data.get("overrides") or {}).pop(template_id, None)
        else:
            data["templates"] = [t for t in data["templates"] if t.get("id") != template_id]
        if data.get("default_id") == template_id:
            data["default_id"] = None
        _save(data)
        return "deleted"


def restore(template_id: str | None = None) -> int:
    """Back to the original built-in: undoes an edit and a deletion. Without an id, restores all of them.
    Returns how many were touched."""
    with _lock:
        data = _load()
        ids = [template_id] if template_id else sorted(_builtin_ids())
        if template_id and template_id not in _builtin_ids():
            return 0
        touched = 0
        overrides = data.get("overrides") if isinstance(data.get("overrides"), dict) else {}
        hidden = list(data.get("hidden") or [])
        for i in ids:
            if i in overrides or i in hidden:
                touched += 1
            overrides.pop(i, None)
            if i in hidden:
                hidden.remove(i)
        data["overrides"], data["hidden"] = overrides, hidden
        _save(data)
        return touched


def set_default(template_id: str) -> bool:
    with _lock:
        if template_id not in {t["id"] for t in list_all()["templates"]}:
            return False
        data = _load()
        data["default_id"] = template_id
        _save(data)
        return True
