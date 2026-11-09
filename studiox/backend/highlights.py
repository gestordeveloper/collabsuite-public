"""Finds the best short clips inside a long recording.

Two modes:
  viral   clips of a target length (30 s, 1 min...) that work on their own: a hook, a payoff, no dependence on context
  topics  one clip per subject the speaker covers, each as long as the subject needs (within min..max)

The transcript is cut into sentences, the sentences into overlapping windows, and each window goes to the AI provider
(backend/llm.py), which answers with SENTENCE ranges. The ranges are checked and snapped to real sentence boundaries
here, and the edges are then moved onto the real edges of the speech (backend/cut_refine.py), so a wrong answer can
never produce a cut in the middle of a word. Without any AI configured a rule-based scorer gives a rough list.
"""
from __future__ import annotations

import re
import time
from typing import Any, Callable

from backend import llm
from backend.credentials import PROVIDERS
from backend.cut_refine import SpeechMap, refine_segment
from backend.llm_anthropic import LLMError
from backend.transcript_review import LANGUAGES, _real_end

MODES = ("viral", "topics")
AI_MODES = ("auto", "llm", "local")

WINDOW_WORDS = 1200          # words per request; a long recording goes in several
WINDOW_BACK_S = 45.0         # the next window starts about this far before the end of the previous one
PAUSE_SPLIT_S = 0.9          # a pause this long ends a sentence even without punctuation
MAX_SENTENCE_WORDS = 45
MIN_SENTENCE_WORDS = 4       # shorter sentences are glued to the next one
SENT_END = (".", "?", "!", "…")
MAX_GAP_EXTEND_S = 6.0       # never extend a clip across a silence longer than this
SHORTEST_CLIP_S = 8.0
OVERLAP_DROP = 0.25          # two picks that overlap more than this share of the shorter one: keep the better
TITLE_MAX = 70
TAG_MAX = 28
EXCERPT_CHARS = 420

CLIP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"clips": {"type": "array", "items": {"type": "object", "properties": {
        "from": {"type": "integer"}, "to": {"type": "integer"}, "title": {"type": "string"}, "tag": {"type": "string"},
        "score": {"type": "integer"}, "why": {"type": "string"},
    }, "required": ["from", "to", "title", "tag", "score", "why"], "additionalProperties": False}}},
    "required": ["clips"],
    "additionalProperties": False,
}

VIRAL_PROMPT = """Você é um editor de conteúdo especialista em vídeos curtos virais (Reels, TikTok, Shorts). Vai receber um TRECHO da transcrição de uma gravação longa ({language}), dividido em frases numeradas, cada uma com o tempo em que começa: [12] (03:41) texto da frase.

Sua tarefa: escolher os MELHORES CORTES para publicar sozinhos, cada um uma sequência contínua de frases.

UM BOM CORTE:
- Faz sentido sozinho, sem depender do que veio antes ("como eu falei", "isso aqui", "aquele exemplo").
- Começa com um GANCHO forte: a primeira frase prende (afirmação ousada, pergunta, promessa, número, contraste, início de uma história).
- Tem começo, meio e fim: termina numa conclusão, resposta ou frase de impacto, nunca no meio de um raciocínio.
- Entrega valor: dica prática, insight, revelação, história marcante, polêmica, humor, erro comum, passo a passo.
- Dura entre {min_s} e {max_s} segundos (alvo: cerca de {target_s}). Confira somando os tempos das frases.

EVITE: apresentações, agradecimentos, "vamos começar", propaganda, enrolação, conversa com quem grava e trechos que dependem de imagem ou tela ("como vocês veem aqui").{extra}

Devolva até {limit} cortes deste trecho, menos se não houver bons: NÃO invente cortes fracos para completar. Os cortes não podem se sobrepor.
Para cada corte:
- "from" e "to": índices das frases (inclusive) onde ele começa e termina.
- "title": headline curto em português para colocar no topo do vídeo (até {title_max} caracteres) que gere curiosidade sem enganar. Ponha *asteriscos* em volta de 1 ou 2 palavras-chave.
- "tag": etiqueta de 1 ou 2 palavras (ex.: DICA, ERRO COMUM, HISTÓRIA).
- "score": 0 a 100, potencial de retenção e de compartilhamento. Seja exigente: 90 ou mais só para cortes excepcionais; bons cortes ficam entre 60 e 80.
- "why": motivo curto em português.

Responda SOMENTE com um objeto JSON neste formato:
{{"clips": [{{"from": 12, "to": 19, "title": "O erro que trava suas *vendas*", "tag": "ERRO COMUM", "score": 82, "why": "gancho forte e conclusão clara"}}]}}"""

TOPICS_PROMPT = """Você é um editor de vídeo experiente. Vai receber um TRECHO da transcrição de uma gravação longa ({language}), dividido em frases numeradas, cada uma com o tempo em que começa: [12] (03:41) texto da frase.

Sua tarefa: identificar os ASSUNTOS distintos que a pessoa aborda e devolver um corte para CADA assunto relevante. Um assunto é uma sequência contínua de frases sobre o mesmo ponto (uma ideia, explicação, exemplo, história ou resposta).

REGRAS:
- O corte começa na frase que introduz o assunto e termina quando ele se conclui. Sem depender de contexto anterior.
- Duração entre {min_s} e {max_s} segundos. Se um assunto for maior que o máximo, escolha a parte mais completa e autônoma dele; se for menor que o mínimo, junte a frase vizinha que o completa ou ignore.
- Ignore apresentações, agradecimentos, propaganda, enrolação e conversa com quem grava.{extra}
- Devolva TODOS os assuntos relevantes deste trecho (máximo {limit}), sem se sobrepor.
Para cada um:
- "from" e "to": índices das frases (inclusive).
- "title": título curto e claro do assunto em português (até {title_max} caracteres), com *asteriscos* em volta de 1 ou 2 palavras-chave.
- "tag": nome do assunto em até 3 palavras.
- "score": 0 a 100, importância e qualidade do assunto como conteúdo independente.
- "why": resumo de uma frase do que é dito.

Responda SOMENTE com um objeto JSON neste formato:
{{"clips": [{{"from": 12, "to": 30, "title": "Como precificar seu *serviço*", "tag": "PRECIFICAÇÃO", "score": 78, "why": "explica o método passo a passo"}}]}}"""


class Cancelled(Exception):
    pass


# ----------------------------------------------------------------------------
# Parameters
# ----------------------------------------------------------------------------
def _num(raw: Any, default: float, lo: float, hi: float) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return default
    return default if v != v else min(hi, max(lo, v))


def clean_params(raw: Any) -> dict[str, Any]:
    """Whitelists and clamps what the screen sends."""
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("mode") if raw.get("mode") in MODES else "viral"
    default_min, default_max = (20.0, 40.0) if mode == "viral" else (30.0, 300.0)
    min_s = _num(raw.get("min_s"), default_min, 10.0, 600.0)
    max_s = _num(raw.get("max_s"), default_max, min_s + 5.0, 900.0)
    provider = str(raw.get("provider") or "")[:20]
    return {
        "mode": mode,
        "min_s": round(min_s), "max_s": round(max_s),
        "count": int(_num(raw.get("count"), 0 if mode == "topics" else 10, 0, 100)),   # 0 = every good one
        "language": raw.get("language") if raw.get("language") in LANGUAGES else "pt",
        "engine": str(raw.get("engine") or "auto")[:20],
        "provider": provider if provider in PROVIDERS else "",
        "model": str(raw.get("model") or "").strip()[:120],
        "ai": raw.get("ai") if raw.get("ai") in AI_MODES else "auto",
        "focus": str(raw.get("focus") or "").strip()[:200],
        "instructions": str(raw.get("instructions") or "").strip()[:600],
    }


# ----------------------------------------------------------------------------
# Sentences and windows
# ----------------------------------------------------------------------------
def clean_words(raw: Any) -> list[dict]:
    """The words of a transcript (Scribe also lists spacing and sound events), each with usable times."""
    out = []
    for w in raw or []:
        if not isinstance(w, dict) or w.get("type") not in (None, "word"):
            continue
        text = str(w.get("text") or "").strip()
        s, e = w.get("start"), w.get("end")
        if text and isinstance(s, (int, float)) and isinstance(e, (int, float)) and e >= s:
            out.append({"text": text, "start": float(s), "end": float(e)})
    return out


def split_sentences(words: list[dict]) -> list[dict]:
    """[{i, w0, w1, start, end, text}]: sentences by punctuation, by pauses, or by length when there is neither."""
    n = len(words)
    spans: list[list[int]] = []
    first = 0
    for k, w in enumerate(words):
        gap = words[k + 1]["start"] - w["end"] if k + 1 < n else 99.0
        stripped = w["text"].rstrip("\"')»”’ ")
        if stripped.endswith(SENT_END) or gap >= PAUSE_SPLIT_S or k - first + 1 >= MAX_SENTENCE_WORDS or k + 1 == n:
            spans.append([first, k])
            first = k + 1

    merged: list[list[int]] = []
    for span in spans:
        if merged:
            prev = merged[-1]
            short = prev[1] - prev[0] + 1 < MIN_SENTENCE_WORDS
            close = words[span[0]]["start"] - words[prev[1]]["end"] < PAUSE_SPLIT_S
            if short and close and span[1] - prev[0] + 1 <= MAX_SENTENCE_WORDS * 1.5:
                prev[1] = span[1]
                continue
        merged.append(span)
    if len(merged) > 1 and merged[-1][1] - merged[-1][0] + 1 < MIN_SENTENCE_WORDS:
        merged[-2][1] = merged[-1][1]
        merged.pop()

    return [{"i": i, "w0": a, "w1": b, "start": words[a]["start"], "end": words[b]["end"],
             "text": " ".join(w["text"] for w in words[a:b + 1])} for i, (a, b) in enumerate(merged)]


def make_windows(sents: list[dict]) -> list[tuple[int, int]]:
    """[(first, last+1)] ranges of sentences, about WINDOW_WORDS words each, overlapping by ~WINDOW_BACK_S seconds."""
    out: list[tuple[int, int]] = []
    n, i = len(sents), 0
    while i < n:
        j, count = i, 0
        while j < n and (count < WINDOW_WORDS or j == i):
            count += sents[j]["w1"] - sents[j]["w0"] + 1
            j += 1
        out.append((i, j))
        if j >= n:
            break
        back = sents[j - 1]["end"] - WINDOW_BACK_S
        k = j - 1
        while k - 1 > i and sents[k - 1]["start"] >= back:
            k -= 1
        i = max(k, i + 1)
    return out


def clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def _window_text(sents: list[dict], a: int, b: int) -> str:
    lines = []
    for s in sents[a:b]:
        text = s["text"] if len(s["text"]) <= 420 else s["text"][:417] + "..."
        lines.append(f"[{s['i']}] ({clock(s['start'])}) {text}")
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# Picking and validating
# ----------------------------------------------------------------------------
def _clean_title(raw: Any) -> str:
    text = re.sub(r"\s+", " ", str(raw or "")).strip().strip('"“”')
    text = re.sub(r"\*{2,}", "*", text)
    if text.count("*") % 2:            # an unpaired asterisk would swallow the rest of the headline
        text = text.replace("*", "")
    if len(text) > TITLE_MAX:
        text = text[:TITLE_MAX].rsplit(" ", 1)[0].rstrip(",;:-*") if " " in text[:TITLE_MAX] else text[:TITLE_MAX]
        if text.count("*") % 2:
            text = text.replace("*", "")
    return text


def _fit(sents: list[dict], f: int, t: int, min_s: float, max_s: float, stretch: float = 2.0) -> tuple[int, int] | None:
    """Sentence range f..t brought into the wanted length by dropping or adding whole sentences (None if impossible).
    A range more than `stretch` times the maximum is not trimmed: the model ignored the length, so the pick is refused
    instead of being cut down to some arbitrary stretch of it."""
    n = len(sents)
    hi_ok = max_s * 1.12
    lo_ok = max(SHORTEST_CLIP_S, min_s * 0.7)

    def length(a: int, b: int) -> float:
        return sents[b]["end"] - sents[a]["start"]

    if length(f, t) > max_s * stretch:
        return None
    while t > f and length(f, t) > hi_ok:
        t -= 1
    if length(f, t) > hi_ok:
        return None
    while (length(f, t) < min_s * 0.85 and t + 1 < n and length(f, t + 1) <= max_s
           and sents[t + 1]["start"] - sents[t]["end"] <= MAX_GAP_EXTEND_S):
        t += 1
    return (f, t) if length(f, t) >= lo_ok else None


def _accept(raw: Any, sents: list[dict], lo: int, hi: int, p: dict, warn: Callable[[str], None]) -> list[dict]:
    """The model's answer for one window as validated picks {f, t, title, tag, score, why}."""
    items = raw.get("clips") if isinstance(raw, dict) else None
    out = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            f, t = int(item.get("from")), int(item.get("to"))
        except (TypeError, ValueError):
            continue
        if f > t:
            f, t = t, f
        if f < lo or t >= hi:
            warn(f"a IA citou frases fora do trecho ({f}-{t}); ignorei esse corte")
            continue
        fitted = _fit(sents, f, t, p["min_s"], p["max_s"], stretch=2.0 if p["mode"] == "viral" else 4.0)
        if fitted is None:
            continue
        f, t = fitted
        try:
            score = int(round(float(item.get("score"))))
        except (TypeError, ValueError):
            score = 50
        out.append({"f": f, "t": t, "title": _clean_title(item.get("title")) or _clean_title(sents[f]["text"]),
                    "tag": re.sub(r"\s+", " ", str(item.get("tag") or "")).strip().upper()[:TAG_MAX],
                    "score": min(100, max(0, score)), "why": str(item.get("why") or "").strip()[:200]})
    return out


def _system_prompt(p: dict, limit: int) -> str:
    extra = ""
    if p["focus"]:
        extra += f"\n\nFOCO PEDIDO PELO USUÁRIO: prefira cortes sobre: {p['focus']}."
    if p["instructions"]:
        extra += f"\n\nINSTRUÇÕES EXTRAS DO USUÁRIO: {p['instructions']}"
    template = VIRAL_PROMPT if p["mode"] == "viral" else TOPICS_PROMPT
    return template.format(language=LANGUAGES.get(p["language"], "português do Brasil"), min_s=p["min_s"], max_s=p["max_s"],
                           target_s=round((p["min_s"] + p["max_s"]) / 2), limit=limit, title_max=TITLE_MAX, extra=extra)


def _ask(system: str, user: str, provider: str | None, model: str | None, log: Callable[[str], None],
         cancelled: Callable[[], bool]) -> Any:
    """One window to the model. A rate limit waits and tries again; other failures are the caller's to handle."""
    for attempt in range(1, 5):
        if cancelled():
            raise Cancelled()
        try:
            return llm.complete_json(provider, system, user, CLIP_SCHEMA, model)
        except LLMError as exc:
            if exc.kind == "rate" and attempt < 4:
                log(f"Limite de uso da IA: esperando {20 * attempt}s para tentar de novo…")
                for _ in range(20 * attempt):
                    if cancelled():
                        raise Cancelled()
                    time.sleep(1)
                continue
            if exc.kind in ("parse", "server", "network") and attempt < 3:
                time.sleep(2 * attempt)
                continue
            raise
    return None


def _overlap(a: dict, b: dict) -> float:
    inter = min(a["end"], b["end"]) - max(a["start"], b["start"])
    return max(0.0, inter) / max(0.001, min(a["end"] - a["start"], b["end"] - b["start"]))


def _select(cands: list[dict], count: int) -> list[dict]:
    """Best first, dropping picks that overlap a better one, up to `count` (0 = all); returned in video order."""
    kept: list[dict] = []
    for c in sorted(cands, key=lambda c: (-c["score"], c["start"])):
        if any(_overlap(c, k) > OVERLAP_DROP for k in kept):
            continue
        kept.append(c)
        if count and len(kept) >= count:
            break
    return sorted(kept, key=lambda c: c["start"])


# ----------------------------------------------------------------------------
# Local scorer (no AI configured)
# ----------------------------------------------------------------------------
HOOK_WORDS = ("segredo", "erro", "nunca", "ninguém", "verdade", "mentira", "cuidado", "descobri", "incrível", "pare",
              "atenção", "jamais", "dica", "truque", "fórmula", "resultado", "dinheiro", "grátis", "gratuito", "perder",
              "ganhar", "medo", "problema", "solução", "motivo", "melhor", "pior", "errado", "principal")


def _local_picks(sents: list[dict], p: dict) -> list[dict]:
    """A rough list from rules: start on a sentence with a hook, run to the target length, score by density and hooks."""
    n = len(sents)
    target = (p["min_s"] + p["max_s"]) / 2
    picks = []
    for f in range(n):
        if f and sents[f]["start"] - sents[f - 1]["end"] < 0.3 and not sents[f - 1]["text"].rstrip().endswith(SENT_END):
            continue                                   # do not start in the middle of a sentence
        t = f
        while t + 1 < n and sents[t]["end"] - sents[f]["start"] < target:
            t += 1
        fitted = _fit(sents, f, t, p["min_s"], p["max_s"])
        if fitted is None:
            continue
        f2, t2 = fitted
        head = " ".join(s["text"] for s in sents[f2:f2 + 2]).lower()
        body = " ".join(s["text"] for s in sents[f2:t2 + 1])
        seconds = max(1.0, sents[t2]["end"] - sents[f2]["start"])
        words = sum(s["w1"] - s["w0"] + 1 for s in sents[f2:t2 + 1])
        score = 35
        score += 8 if "?" in sents[f2]["text"] else 0
        score += 5 * min(3, sum(1 for h in HOOK_WORDS if h in head))
        score += min(8, len(re.findall(r"\d+", body)) * 2)
        score += min(6, body.count("!") * 2)
        score += 8 if 2.0 <= words / seconds <= 3.8 else 0        # a lively pace, not dead air
        picks.append({"f": f2, "t": t2, "title": _clean_title(sents[f2]["text"].rstrip(".,;:!? ")), "tag": "",
                      "score": min(70, score), "why": "escolhido por regras locais (sem IA)"})
    return picks


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------
def find_highlights(words_raw: list[dict], duration: float, params: dict[str, Any], speech: SpeechMap | None = None,
                    log: Callable[[str], None] = lambda m: None, progress: Callable[[float, str], None] = lambda f, m: None,
                    cancelled: Callable[[], bool] = lambda: False) -> dict[str, Any]:
    """{"candidates": [...], "engine": "llm"|"local", "warnings": [...], "windows": int}.

    Each candidate: id, start, end, duration, score, title, tag, why, text."""
    p = clean_params(params)
    words = clean_words(words_raw)
    if len(words) < 20:
        raise ValueError("A transcrição tem poucas palavras para achar cortes.")
    sents = split_sentences(words)
    windows = make_windows(sents)
    warnings: list[str] = []

    def warn(msg: str) -> None:
        if msg not in warnings and len(warnings) < 12:
            warnings.append(msg)
            log(f"Aviso: {msg}")

    engine = "llm"
    if p["ai"] == "local":
        engine = "local"
    else:
        try:
            llm.resolve(p["provider"] or None, p["model"] or None)
        except LLMError as exc:
            if p["ai"] == "llm":
                raise
            engine = "local"
            warn(f"{str(exc).rstrip('.')}: usei regras locais, que acham cortes bem menos bons")

    total = max(1.0, duration or sents[-1]["end"])
    picks: list[dict] = []
    if engine == "local":
        progress(0.5, "Procurando cortes com regras locais…")
        picks = _local_picks(sents, p)
        log(f"{len(picks)} candidato(s) pelas regras locais")
    else:
        failed = 0
        for k, (a, b) in enumerate(windows):
            if cancelled():
                raise Cancelled()
            win_s = sents[b - 1]["end"] - sents[a]["start"]
            if p["count"]:
                limit = max(2, min(8, int(-(-p["count"] * 2 * win_s // total))))
            else:
                limit = 8 if p["mode"] == "topics" else max(2, min(6, int(-(-win_s * 0.7 // 60))))
            progress(k / len(windows), f"Lendo a transcrição com a IA ({k + 1} de {len(windows)})…")
            try:
                raw = _ask(_system_prompt(p, limit), _window_text(sents, a, b), p["provider"] or None, p["model"] or None, log, cancelled)
            except LLMError as exc:
                if exc.kind == "auth":
                    raise
                failed += 1
                warn(f"a IA falhou em um trecho ({str(exc)[:120]})")
                continue
            found = _accept(raw, sents, a, b, p, warn)
            log(f"Trecho {k + 1}/{len(windows)}: {len(found)} corte(s) sugerido(s)")
            picks += found
        if windows and failed == len(windows):
            raise LLMError("A IA não conseguiu analisar nenhum trecho da transcrição.", "server")

    progress(0.93, "Ajustando as bordas dos cortes pela fala…")
    cands = []
    for pk in picks:
        first, last = sents[pk["f"]]["w0"], sents[pk["t"]]["w1"]
        prev_end = words[first - 1]["end"] if first > 0 else 0.0
        next_start = words[last + 1]["start"] if last + 1 < len(words) else max(duration or 0.0, words[last]["end"])
        start, end = refine_segment(speech, words[first]["start"], _real_end(words[last], speech), prev_end, next_start)
        end = min(end + 0.12, next_start - 0.005) if next_start - 0.005 > end else end
        if duration:
            end = min(end, duration)
        start = max(0.0, start)
        text = " ".join(w["text"] for w in words[first:last + 1])
        cands.append({"start": round(start, 2), "end": round(end, 2), "duration": round(end - start, 1),
                      "score": pk["score"], "title": pk["title"], "tag": pk["tag"], "why": pk["why"],
                      "text": text if len(text) <= EXCERPT_CHARS else text[:EXCERPT_CHARS].rsplit(" ", 1)[0] + "…"})
    chosen = _select(cands, p["count"])
    for i, c in enumerate(chosen, start=1):
        c["id"] = f"c{i:03d}"
    log(f"{len(chosen)} corte(s) escolhido(s) entre {len(cands)} candidato(s)")
    return {"candidates": chosen, "engine": engine, "warnings": warnings, "windows": len(windows)}
