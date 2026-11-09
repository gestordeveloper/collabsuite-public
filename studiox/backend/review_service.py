"""The single way a transcript gets reviewed, used by the queue AND by the editor's "Analisar com IA".

They used to call the review with different settings (the queue skipped the review when no AI key was
configured, never sent instructions, the editor did), so the same recording was cut differently depending on
where it was started. Everything that decides HOW to review lives here now:

  * the editor's standing instructions (Configurações), added to every review;
  * the copy (the script the person was reading) and whether off-script speech is cut;
  * `review_words`, which both callers use.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Callable

from backend import llm
from backend.config import STORAGE_DIR
from backend.fsutil import replace_file
from backend.transcript_review import build_system_prompt, review_transcript

PREFS_PATH = STORAGE_DIR / "review_prefs.json"
MAX_INSTRUCTIONS = 1500
MAX_COPY = 20000


# ----------------------------------------------------------------------------
# Standing instructions (Configurações)
# ----------------------------------------------------------------------------
def _load() -> dict:
    try:
        data = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get_instructions() -> str:
    return str(_load().get("instructions") or "")[:MAX_INSTRUCTIONS]


def set_instructions(text: str) -> str:
    text = (text or "").replace("\r", "").strip()[:MAX_INSTRUCTIONS]
    data = _load()
    data["instructions"] = text
    tmp = PREFS_PATH.with_name(f"{PREFS_PATH.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    replace_file(tmp, PREFS_PATH)
    return text


def merged_instructions(extra: str | None = None) -> str | None:
    """Standing instructions first, then the ones given for this one run."""
    parts = [p.strip() for p in (get_instructions(), extra or "") if p and p.strip()]
    return "\n".join(parts)[:MAX_INSTRUCTIONS] or None


def prompt_preview(language: str = "pt") -> dict[str, str]:
    """What the model is told (without the copy), for the settings screen."""
    return {"review": build_system_prompt("review", language), "verify": build_system_prompt("verify", language)}


# ----------------------------------------------------------------------------
# Copy
# ----------------------------------------------------------------------------
def clean_copy(text: str | None) -> str:
    return (text or "").replace("\r", "").strip()[:MAX_COPY]


def copy_signature(copy: str | None, strict: bool = True) -> str:
    """Identifies the copy + strictness a review was made with (a retry only reuses a review of the same copy)."""
    text = clean_copy(copy)
    if not text:
        return ""
    return hashlib.sha1(f"{int(bool(strict))}\n{text}".encode("utf-8")).hexdigest()[:12]


# ----------------------------------------------------------------------------
# Review
# ----------------------------------------------------------------------------
def effective_mode(mode: str, provider: str | None, has_copy: bool) -> str:
    """off | local | llm. "auto" is the AI when a key is configured and the local analysis otherwise
    (the same analysis the editor's button runs), so a queued video is never cut worse than an edited one.
    A copy always gets at least the copy-driven analysis, which needs no key."""
    from backend import credentials  # local import: credentials pulls in the DPAPI helpers

    if mode == "auto":
        chosen = provider or credentials.default_provider()
        mode = "llm" if chosen and credentials.get_key(chosen) else "local"
    if mode == "off" and has_copy:
        mode = "local"
    return mode


def review_words(
    words: list[dict[str, Any]],
    *,
    mode: str,
    provider: str | None = None,
    model: str | None = None,
    language: str = "pt",
    fix_words: bool = True,
    copy: str | None = None,
    strict_copy: bool = True,
    instructions: str | None = None,
    video_path: Path | None = None,
    duration: float | None = None,
    log: Callable[[str], None] = print,
    call: Callable[..., dict] = llm.complete_json,
) -> dict[str, Any]:
    return review_transcript(
        words, mode=mode, provider=provider, model=model, language=language,
        instructions=merged_instructions(instructions), fix_words=fix_words, verify=True,
        copy=clean_copy(copy) or None, strict_copy=strict_copy, video_path=video_path, duration=duration,
        log=log, call=call,
    )
