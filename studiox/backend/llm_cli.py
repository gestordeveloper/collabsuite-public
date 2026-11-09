"""Claude Code, Codex, Antigravity (agy) and OpenCode used as language models: the CLI the user already has installed and logged in to is run
as a subprocess (text only, no tools, an empty working directory), so no API key is needed and the usage goes
through the user's own subscription.

The prompt goes through stdin (the Windows command line is limited to ~32k characters) and the JSON schema is
written into the prompt: the providers' native schema modes are stricter than the schemas the app uses.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from backend.llm_anthropic import LLMError
from backend.llm_openai_compat import parse_json_text

# id -> (executable names for PATH, env var that overrides the path)
CLI_BINARIES: dict[str, tuple[tuple[str, ...], str]] = {
    "claude_cli": (("claude",), "STUDIOX_CLAUDE_PATH"),
    "codex_cli": (("codex",), "STUDIOX_CODEX_PATH"),
    "antigravity_cli": (("agy",), "STUDIOX_ANTIGRAVITY_PATH"),
    "opencode_cli": (("opencode",), "STUDIOX_OPENCODE_PATH"),
}
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _known_locations(provider: str) -> list[Path]:
    home = Path.home()
    found: list[Path] = []
    if provider == "claude_cli":
        found.append(home / ".local" / "bin" / "claude.exe")
        ext_dir = home / ".vscode" / "extensions"
        if ext_dir.is_dir():  # the VS Code extension ships its own copy of the CLI
            for ext in sorted(ext_dir.glob("anthropic.claude-code-*"), reverse=True):
                found.append(ext / "resources" / "native-binary" / "claude.exe")
    elif provider == "antigravity_cli":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            found.append(Path(local) / "agy" / "bin" / "agy.exe")
    elif provider == "codex_cli":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            found.append(Path(local) / "Programs" / "OpenAI" / "Codex" / "bin" / "codex.exe")
    return found


def find_cli(provider: str) -> str | None:
    """Full path of the installed CLI, or None."""
    names, env = CLI_BINARIES[provider]
    override = (os.environ.get(env) or "").strip().strip('"')
    if override and Path(override).is_file():
        return override
    for name in names:
        hit = shutil.which(name)  # on Windows this honours PATHEXT, so it finds the .cmd/.exe and not the extensionless shim
        if hit:
            return hit
    for path in _known_locations(provider):
        if path.is_file():
            return str(path)
    return None


def _run(args: list[str], stdin: str | None, timeout: float, cwd: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            args, input=stdin, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, cwd=cwd, creationflags=_NO_WINDOW if sys.platform == "win32" else 0,
        )
    except subprocess.TimeoutExpired as exc:
        raise LLMError("A IA demorou demais para responder (tempo esgotado).", "network") from exc
    except OSError as exc:
        raise LLMError(f"Não consegui executar o programa da IA: {exc}", "bad_request") from exc


def _compose(system: str, user: str) -> str:
    return (
        f"{system}\n\n{user}\n\n"
        "Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois e sem blocos de código."
    )


def _schema_note(schema: dict | None) -> str:
    if not schema:
        return ""
    return "\n\nO JSON deve seguir este JSON Schema:\n" + json.dumps(schema, ensure_ascii=False)


def _fail(name: str, proc: subprocess.CompletedProcess) -> LLMError:
    text = ((proc.stderr or "") + "\n" + (proc.stdout or "")).lower()
    if "subscription is required" in text:
        return LLMError(f"O modelo escolhido no {name} exige uma assinatura que esta conta não tem. Escolha um modelo gratuito (rode «opencode models»).", "auth")
    if any(w in text for w in ("not logged in", "log in", "login", "unauthorized", "authentication", "401", "/login")):
        return LLMError(f"O {name} não está logado. Abra um terminal e faça login nele (comando de login do próprio {name}).", "auth")
    if "rate limit" in text or "usage limit" in text or "limit reached" in text or "429" in text:
        return LLMError(f"Limite de uso do {name} atingido. Tente de novo mais tarde.", "rate")
    tail = (proc.stderr or proc.stdout or "").strip().splitlines()
    detail = tail[-1][:200] if tail else f"código {proc.returncode}"
    return LLMError(f"O {name} falhou: {detail}", "server")


def _claude(exe: str, model: str, system: str, user: str, schema: dict | None, timeout: float, cwd: str) -> str:
    args = [exe, "-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
            "--disable-slash-commands", "--setting-sources", "", "--system-prompt", system]
    if model:
        args += ["--model", model]
    proc = _run(args, _compose("", user) + _schema_note(schema), timeout, cwd)
    try:
        data = json.loads(proc.stdout or "")
    except ValueError:
        raise _fail("Claude Code", proc) from None
    if proc.returncode != 0 or data.get("is_error"):
        text = str(data.get("result") or "")
        raise _fail("Claude Code", subprocess.CompletedProcess(args, proc.returncode or 1, "", text))
    return json.dumps(data["structured_output"]) if data.get("structured_output") else str(data.get("result") or "")


def _codex(exe: str, model: str, system: str, user: str, schema: dict | None, timeout: float, cwd: str) -> str:
    out = Path(cwd) / "answer.txt"
    args = [exe, "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-rules", "-s", "read-only",
            "--color", "never", "-C", cwd, "-o", str(out)]
    if model:
        args += ["-m", model]
    args.append("-")
    proc = _run(args, _compose(system, user) + _schema_note(schema), timeout, cwd)
    text = out.read_text(encoding="utf-8", errors="replace") if out.is_file() else ""
    if proc.returncode != 0 or not text.strip():
        raise _fail("Codex", proc)
    return text


def _antigravity(exe: str, model: str, system: str, user: str, schema: dict | None, timeout: float, cwd: str) -> str:
    # agy ignores stdin in plain print mode, so the prompt goes as a stream-json message (no size limit).
    # `--print=` (empty value) only switches to print mode; the last "result" event holds the answer.
    prompt = _compose(system, user) + _schema_note(schema)
    args = [exe, "--input-format", "stream-json", "--output-format", "stream-json", "--print="]
    if model:
        args += ["--model", model]
    message = json.dumps({"event": "user", "message": {"content": prompt}}, ensure_ascii=False) + "\n"
    proc = _run(args, message, timeout, cwd)
    result = None
    for line in (proc.stdout or "").splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("event") == "result":
            result = ev.get("result") or {}
    if result is None:
        raise _fail("Antigravity", proc)
    if proc.returncode != 0 or result.get("status") != "SUCCESS" or not str(result.get("response") or "").strip():
        raise _fail("Antigravity", subprocess.CompletedProcess(args, proc.returncode or 1, "", str(result.get("error") or "") + "\n" + (proc.stderr or "")))
    return str(result["response"])


def _opencode(exe: str, model: str, system: str, user: str, schema: dict | None, timeout: float, cwd: str) -> str:
    args = [exe, "run", "--format", "json", "--dir", cwd]
    if model:
        args += ["-m", model]
    proc = _run(args, _compose(system, user) + _schema_note(schema), timeout, cwd)
    texts, error = [], ""
    for line in (proc.stdout or "").splitlines():  # one JSON event per line
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "text":
            texts.append(str((ev.get("part") or {}).get("text") or ""))
        elif ev.get("type") == "error":
            data = (ev.get("error") or {}).get("data") or {}
            error = str(data.get("message") or (ev.get("error") or {}).get("name") or "")
    if error and not texts:
        raise _fail("OpenCode", subprocess.CompletedProcess(args, proc.returncode or 1, "", error))
    if proc.returncode != 0 or not "".join(texts).strip():
        raise _fail("OpenCode", proc)
    return "".join(texts)


_RUNNERS = {"claude_cli": _claude, "codex_cli": _codex, "antigravity_cli": _antigravity, "opencode_cli": _opencode}


def complete_json(provider: str, exe: str, model: str, system: str, user: str, schema: dict | None = None,
                  timeout: float = 300.0) -> dict:
    run = _RUNNERS[provider]
    last: LLMError | None = None
    for _attempt in range(2):  # the format is not enforced by the provider: one more try when it is not JSON
        with tempfile.TemporaryDirectory(prefix="studiox-cli-") as cwd:
            text = run(exe, model, system, user, schema, timeout, cwd)
        try:
            out = parse_json_text(text)
        except LLMError as exc:
            last = exc
            continue
        if isinstance(out, dict):
            return out
        last = LLMError("A IA devolveu um JSON que não é um objeto.", "parse")
    raise last or LLMError("A IA não devolveu uma resposta válida.", "parse")


def test_connection(provider: str, exe: str, name: str, model: str = "") -> dict:
    """Checks the CLI is installed and logged in with one tiny real call (it uses a few tokens of the subscription)."""
    try:
        out = complete_json(provider, exe, model, "Você responde somente JSON.", 'Responda {"ok": true}.', timeout=120.0)
    except LLMError as exc:
        return {"ok": False, "message": str(exc)}
    return {"ok": bool(out), "message": f"{name} funcionando ({exe})."}
