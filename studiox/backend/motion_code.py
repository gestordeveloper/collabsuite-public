"""Validation of the code the AI writes for the "Personalizado" motion graphic (motion/src/templates/Custom.tsx).

The code is the BODY of a function that receives React, useCurrentFrame, useVideoConfig, interpolate, spring, random,
AbsoluteFill and Easing and must `return` a component made with React.createElement (no JSX). It is written by a model, so
it is untrusted: this module is the first gate (nothing that names the network, the DOM, storage, eval/import, timers or
Math.random is ever stored or rendered); Custom.tsx adds a CSP, and the editor's preview runs it in a sandboxed iframe.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from typing import Any

MAX_CODE = 24000

DEFAULT_CODE = (
    "function Scene() {\n"
    "  const frame = useCurrentFrame();\n"
    "  const o = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });\n"
    "  return React.createElement(AbsoluteFill, { style: { justifyContent: 'center', alignItems: 'center', opacity: o } },\n"
    "    React.createElement('div', { style: { color: '#fff', fontSize: 80, fontWeight: 800 } }, 'Descreva o efeito e gere com IA'));\n"
    "}\n"
    "return Scene;"
)

NAMES = "React,useCurrentFrame,useVideoConfig,interpolate,spring,random,AbsoluteFill,Easing"

_BANNED = re.compile(
    r"\b(window|document|globalThis|self|fetch|XMLHttpRequest|WebSocket|EventSource|navigator|"
    r"localStorage|sessionStorage|indexedDB|caches|cookie|eval|Function|import|require|process|constructor|__proto__|prototype|"
    r"postMessage|Worker|SharedWorker|importScripts|setTimeout|setInterval|requestAnimationFrame|Date|Reflect|Proxy|WebAssembly|"
    r"innerHTML|outerHTML|dangerouslySetInnerHTML|srcdoc|createElementNS|alert|confirm)\b"
    r"|Math\s*\.\s*random|\blocation\s*[.=\[]|\b(open|close|prompt)\s*\(|\bnew\s+(Image|Audio)\b|(?i:<\s*script)|\bon[a-z]+\s*:|\[\s*['\"`]\s*(constructor|__proto__|prototype)",
)


def validate(code: Any) -> str | None:
    """None when the code passes the first gate, otherwise the reason (Portuguese: it is shown to the user and to the model)."""
    if not isinstance(code, str) or not code.strip():
        return "o código está vazio"
    if len(code) > MAX_CODE:
        return f"o código passa de {MAX_CODE} caracteres"
    if "return" not in code:
        return "o código precisa terminar com `return Scene;` (devolver o componente)"
    m = _BANNED.search(code)
    if m:
        return f"o código usa algo não permitido: {m.group(0).strip()[:30]!r}"
    return None


_SYNTAX_SCRIPT = (
    "const c=require('fs').readFileSync(0,'utf8');"
    "try{new Function(...'" + NAMES + "'.split(','),'\"use strict\";\\n'+c);}"
    "catch(e){console.log(String(e.message));process.exit(2)}"
)


def check_syntax(code: str) -> str | None:
    """Compiles the code with node WITHOUT calling it: None when it parses, otherwise the syntax error. Skipped without node."""
    node = shutil.which("node")
    if not node:
        return None
    try:
        proc = subprocess.run([node, "-e", _SYNTAX_SCRIPT], input=code, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return (proc.stdout or proc.stderr).strip()[:300] if proc.returncode == 2 else None


def problem(code: Any) -> str | None:
    """Everything that can be wrong with the code, checked statically: the gate first, then the syntax."""
    return validate(code) or check_syntax(code)
