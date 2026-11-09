"""Reviews a transcript so the cut comes out clean: recording mistakes, retakes, stutters and
noises are removed, mis-heard words are corrected, and every cut point lands on the real edge of
the speech (see backend/cut_refine.py).

Modes
    local  rules on the transcript only (backend/ai_editor.py), free and offline
    llm    a language model (Groq / OpenAI / OpenRouter / Anthropic, see backend/llm.py) judges the
           transcript. Its answer is a proposal: every index is validated, absurd answers (cutting
           most of the video, huge ranges, invented rewrites) are discarded, and any chunk the model
           fails to answer falls back to the local rules. Nothing the model says can crash a render.
"""
from __future__ import annotations

import difflib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Callable

from backend import llm
from backend.ai_editor import analyze_transcript_locally
from backend.cut_refine import SpeechMap, load_speech_map, refine_segment
from backend.llm import LLMError
from backend.script_align import ScriptPlan, align_script, split_copy

CHUNK_WORDS = 700            # words per request; long videos are reviewed in several calls
CHUNK_OVERLAP = 30           # words of the previous chunk repeated as context
MAX_CUT_RUN = 150            # a single cut longer than this many words is not believable
MAX_CUT_FRACTION = 0.45      # more than this share of a chunk cut -> the answer is discarded
MIN_KEPT_FRACTION = 0.20     # keeping less than this of the whole video -> the LLM is discarded
FLOOR_MAX_RUN = 18           # a failed attempt is short: the rules never remove a longer run in one go
                             # (in continuous speech they would flag a whole phrase for a single "errei")
VERIFY_MAX_FRACTION = 0.30   # the final read-through may remove at most this share of what is left
VERIFY_MAX_RUN = 60
MIN_SEGMENT_S = 0.15
SPLIT_GAP_S = 0.45           # silences at least this long between kept words are cut out (same as the silence cutter)
KINDS = ("retake", "error", "false_start", "stutter", "filler", "off_topic", "noise")
KIND_LABEL = {
    "retake": "Take refeito", "error": "Erro de gravação", "false_start": "Começo abandonado",
    "stutter": "Gagueira / repetição", "filler": "Hesitação", "off_topic": "Fora do conteúdo",
    "noise": "Ruído / não é fala",
}
KIND_UI = {"retake": "retake", "error": "retake", "false_start": "retake", "off_topic": "retake",
           "noise": "retake", "stutter": "stutter", "filler": "filler"}
LANGUAGES = {"pt": "português do Brasil", "en": "inglês", "es": "espanhol"}

REVIEW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "cuts": {"type": "array", "items": {"type": "object", "properties": {
            "from": {"type": "integer"}, "to": {"type": "integer"},
            "kind": {"type": "string", "enum": list(KINDS)}, "why": {"type": "string"},
        }, "required": ["from", "to", "kind", "why"], "additionalProperties": False}},
        "fixes": {"type": "array", "items": {"type": "object", "properties": {
            "index": {"type": "integer"}, "text": {"type": "string"},
        }, "required": ["index", "text"], "additionalProperties": False}},
        "notes": {"type": "string"},
    },
    "required": ["cuts", "fixes", "notes"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """Você é um editor de vídeo experiente. Vai revisar a transcrição palavra a palavra de uma gravação em que uma pessoa fala para a câmera ({language}). Quem grava costuma errar e REFAZER a mesma fala várias vezes. O vídeo final deve ler como um ROTEIRO CONTÍNUO e correto: só a melhor versão de cada fala, sem erros de gravação e sem restos de tentativas abandonadas.

Cada palavra vem numerada assim: [12]palavra. Marcas como {{pausa 1.4s}} indicam silêncio entre palavras. As palavras do "contexto anterior" ajudam a entender o começo do trecho; você só decide sobre os índices do trecho a revisar (e pode cortar palavras do contexto se elas fizerem parte de uma tentativa que continua no trecho).

COMO PENSAR: pessoas erram e depois de uma pausa recomeçam do início da frase. Cada tentativa que ficou pelo caminho deve sair INTEIRA, do primeiro erro até o ponto em que a pessoa recomeça. Nunca corte só a palavra interrompida ou só a reação: isso deixa um pedaço solto da tentativa que falhou, que é o pior resultado. Mantenha a última versão completa e boa.

DECIDA O QUE CORTAR (campo "cuts"). Cada corte é um intervalo contínuo de índices, from..to inclusive, com um "kind":
- retake: a fala foi refeita. Corte a(s) tentativa(s) anterior(es) inteira(s), mesmo que sejam versões mais curtas ou incompletas da fala final, e MANTENHA só a última.
- false_start: tentativa abandonada no meio: começa a frase, para (palavra cortada como "co--", frase que morre) e recomeça. Corte desde o início da tentativa, incluindo as palavras que vêm ANTES da palavra interrompida.
- error: erro de fala ou de gravação: palavra trocada e corrigida logo depois, reações como "oxi", "errei", "pera", "espera", "vou repetir", "de novo", "corta".
- stutter: gagueira ou repetição imediata da mesma palavra ou expressão.
- filler: hesitação longa ("é...", "ééé", "hum", "tipo assim"), só quando atrapalha o ritmo.
- off_topic: fala que não faz parte do conteúdo ("tá gravando?", instruções a quem grava, conversa lateral).
- noise: sons que não são fala (tosse, pigarro, respiração audível, "(risos)").
Junte palavras vizinhas no mesmo corte. Nunca corte mais de {max_run} palavras seguidas.

EXEMPLO 1 (tentativa curta refeita):
[30]Hoje [31]eu [32]vou {{pausa 1.1s}} [33]Hoje [34]eu [35]vou [36]falar [37]sobre [38]vendas
-> {{"from": 30, "to": 32, "kind": "retake", "why": "tentativa incompleta refeita logo depois"}}

EXEMPLO 2 (palavras interrompidas, reação de erro, recomeço):
[50]Então [51]a [52]ges-- {{pausa 2.0s}} [53]a [54]gestão [55]é [56]ess-- [57]oxi {{pausa 1.5s}} [58]a [59]gestão [60]é [61]essencial
-> {{"from": 50, "to": 52, "kind": "false_start", "why": "tentativa interrompida"}}, {{"from": 53, "to": 57, "kind": "false_start", "why": "segunda tentativa interrompida, com a reação 'oxi'"}}. Ficam só os índices 58 a 61.

NÃO CORTE: conteúdo válido, pausas naturais, repetições intencionais para dar ênfase, nem palavras que só parecem repetidas mas fazem sentido. Na dúvida, MANTENHA. Mas um erro claro nunca deve ficar.

CORRIJA PALAVRAS (campo "fixes") que o reconhecimento de fala transcreveu errado (nome próprio, termo técnico, acentuação, palavra parecida), somente quando o contexto der certeza. Devolva a palavra correta em UM único termo, sem espaços, mantendo a pontuação final. Não reescreva nem "melhore" o texto.

Responda SOMENTE com um objeto JSON neste formato (listas vazias se não houver nada a fazer):
{{"cuts": [{{"from": 12, "to": 18, "kind": "retake", "why": "motivo curto em português"}}], "fixes": [{{"index": 40, "text": "Kubernetes"}}], "notes": "resumo de uma frase"}}"""

COPY_PROMPT = """

ROTEIRO (COPY) DESTE VÍDEO: é o texto que a pessoa deveria falar. Use-o como guia do FLUXO:
{copy}

COMO USAR O ROTEIRO:
- O vídeo final segue o roteiro na ordem: cada linha aparece UMA vez, na melhor versão gravada (normalmente a última completa). Tentativas anteriores da mesma linha, começos abandonados e reações saem.
- Frases que se repetem NO PRÓPRIO ROTEIRO (ex.: "A gente faz. A gente integra. A gente conecta.") são intencionais: mantenha todas, cada uma dita uma vez. Nunca as trate como retake.
- Fala que não está no roteiro (conversa com quem grava, comentário solto, "meu Deus") sai{strict_note}.
- Palavras marcadas com ✓ já foram confirmadas como a versão escolhida de uma linha do roteiro: NÃO corte. Palavras marcadas com ✗ já estão marcadas para corte: não precisa repetir. Decida somente sobre as palavras sem marca.{align_note}"""

COPY_STRICT = " (corte também quando for curta)"
COPY_LOOSE = " apenas se for claramente um erro; comentários que parecem parte do conteúdo devem ser mantidos"

VERIFY_PROMPT = """Você é o revisor final de continuidade de um roteiro de vídeo ({language}). O texto abaixo é o que SOBROU depois de um primeiro corte de erros de gravação. Cada {{corte}} marca uma junção de edição: as palavras antes e depois dele foram coladas.

Leia como se fosse o vídeo pronto e procure SOBRAS que ainda estão erradas:
1. Fala repetida: a mesma frase ou ideia dita duas vezes (uma versão anterior, mais curta ou pior, que deveria ter sido cortada). Corte a versão pior e mantenha a melhor (normalmente a última e mais completa).
2. Fragmentos soltos: palavras que sobraram de uma tentativa abandonada e não formam uma frase completa (por exemplo, o começo de uma frase logo antes de um {{corte}}, que nunca é terminada).
3. Reações e ruídos: "oxi", "errei", "pera", tosse, "(risos)".
Devolva em "cuts" só sobras CLARAMENTE erradas (use os índices entre colchetes). Se o roteiro já flui bem, devolva listas vazias: não invente cortes e não mexa em conteúdo válido. Deixe "fixes" vazio.

Responda SOMENTE com um objeto JSON neste formato:
{{"cuts": [{{"from": 12, "to": 18, "kind": "retake", "why": "motivo curto em português"}}], "fixes": [], "notes": "resumo de uma frase"}}"""


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def _norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    return re.sub(r"[^\w]", "", "".join(c for c in text if unicodedata.category(c) != "Mn"))


def _chunks(n: int, words: list[dict]) -> list[tuple[int, int]]:
    """[start, end) index ranges of at most CHUNK_WORDS words, split at the longest pause near the end."""
    out, pos = [], 0
    while pos < n:
        end = min(n, pos + CHUNK_WORDS)
        if end < n:
            lo = pos + int(CHUNK_WORDS * 0.8)
            best, best_gap = end, 0.35
            for i in range(lo, end):
                gap = words[i + 1]["start"] - words[i]["end"] if i + 1 < n else 0
                if gap > best_gap:
                    best, best_gap = i + 1, gap
            end = best
        out.append((pos, end))
        pos = end
    return out


def _render_words(words: list[dict], lo: int, hi: int, plan: ScriptPlan | None = None) -> str:
    """[index]text marks, with {pausa Xs} where the speaker stopped. With a copy plan: ✓ = the chosen take of a
    script line (protected), ✗ = already marked for cut."""
    parts = []
    for i in range(lo, hi):
        if i > lo:
            gap = words[i]["start"] - words[i - 1]["end"]
            if gap >= 0.5:
                parts.append(f"{{pausa {gap:.1f}s}}")
        mark = ""
        if plan is not None and plan.used:
            mark = "✓" if i in plan.protected else ("✗" if i in plan.cuts else "")
        parts.append(f"[{i}]{mark}{words[i]['text']}")
    return " ".join(parts)


def _validate_chunk(raw: Any, lo: int, hi: int, words: list[dict], warn: Callable[[str], None],
                    allowed: set[int] | None = None, max_fraction: float = MAX_CUT_FRACTION,
                    max_run: int = MAX_CUT_RUN) -> tuple[list[dict], list[dict], str]:
    """Turns the model's JSON into safe decisions for indices lo..hi-1 (editable range).
    `allowed` narrows the editable words further (the final read-through only sees what was kept)."""
    if not isinstance(raw, dict):
        raise LLMError("Resposta da IA fora do formato esperado.", "parse")
    cuts: list[dict] = []
    for c in raw.get("cuts") or []:
        try:
            a, b = int(c["from"]), int(c["to"])
        except (KeyError, TypeError, ValueError):
            continue
        if a > b:
            a, b = b, a
        a, b = max(a, lo), min(b, hi - 1)
        if a > b:
            continue
        if b - a + 1 > max_run:
            warn(f"corte de {b - a + 1} palavras seguidas ignorado (grande demais)")
            continue
        kind = c.get("kind") if c.get("kind") in KINDS else "error"
        cuts.append({"from": a, "to": b, "kind": kind, "why": str(c.get("why") or "")[:160]})

    editable = len(allowed) if allowed is not None else hi - lo
    cut_words = len({i for c in cuts for i in range(c["from"], c["to"] + 1) if allowed is None or i in allowed})
    if editable > 0 and cut_words / editable > max_fraction:
        warn(f"a IA quis cortar {cut_words} de {editable} palavras; resposta descartada por segurança")
        cuts = []

    fixes: list[dict] = []
    for f in raw.get("fixes") or []:
        try:
            idx, new = int(f["index"]), str(f["text"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if not (lo <= idx < hi) or not new or len(new) > 40 or re.search(r"\s", new):
            continue
        old = words[idx]["text"]
        if new == old:
            continue
        # a correction, not a rewrite: the word must still look like the one that was heard
        if difflib.SequenceMatcher(None, _norm(old), _norm(new)).ratio() < 0.5:
            continue
        fixes.append({"index": idx, "from": old, "to": new})
    return cuts, fixes, str(raw.get("notes") or "")[:300]


def _copy_block(copy: str | None, plan: ScriptPlan | None, strict: bool) -> str:
    """The script, numbered, plus how to use it. Empty when no copy was given."""
    lines = split_copy(copy or "")
    if not lines:
        return ""
    text = "\n".join(f"{ln.number}. {ln.text}" for ln in lines)[:6000]
    note = "" if plan is not None and plan.used else (
        "\n(O alinhamento automático não conseguiu casar o roteiro com a gravação; use o roteiro só como guia.)")
    return COPY_PROMPT.format(copy=text, strict_note=COPY_STRICT if strict else COPY_LOOSE, align_note=note)


def build_system_prompt(kind: str, language: str, instructions: str | None = None, copy: str | None = None,
                        plan: ScriptPlan | None = None, strict_copy: bool = True) -> str:
    """The full prompt sent to the model (kind: "review" or "verify"). Also what the settings screen previews."""
    lang = LANGUAGES.get(language, "detecte o idioma pelo áudio")
    if kind == "verify":
        system = VERIFY_PROMPT.format(language=lang)
    else:
        system = SYSTEM_PROMPT.format(language=lang, max_run=MAX_CUT_RUN)
    system += _copy_block(copy, plan, strict_copy)
    if instructions and instructions.strip():
        system += f"\n\nInstrução adicional do editor: {instructions.strip()[:1500]}"
    return system


def _llm_statuses(words: list[dict], provider: str | None, model: str | None, language: str,
                  instructions: str | None, fix_words: bool, log: Callable[[str], None],
                  call: Callable[..., dict], copy: str | None = None, plan: ScriptPlan | None = None,
                  strict_copy: bool = True) -> dict[str, Any]:
    """Asks the model about every chunk. Returns cuts by word index, fixes, notes and the failed chunks."""
    system = build_system_prompt("review", language, instructions, copy, plan, strict_copy)

    cut_by_index: dict[int, dict] = {}
    fixes: list[dict] = []
    notes: list[str] = []
    failed: list[tuple[int, int]] = []
    problems: list[str] = []
    ok_chunks = 0
    ranges = _chunks(len(words), words)

    for n, (a, b) in enumerate(ranges, start=1):
        ctx_lo = max(0, a - CHUNK_OVERLAP)
        user = (f"TRECHO {n} de {len(ranges)}. Revise os índices {a} a {b - 1}.\n"
                + (f"--- contexto anterior (índices {ctx_lo} a {a - 1})\n{_render_words(words, ctx_lo, a, plan)}\n" if a > ctx_lo else "")
                + f"--- trecho a revisar\n{_render_words(words, a, b, plan)}")
        warnings: list[str] = []
        try:
            for attempt in (1, 2):
                try:
                    raw = call(provider, system, user, REVIEW_SCHEMA, model)
                    cuts, chunk_fixes, note = _validate_chunk(raw, ctx_lo, b, words, warnings.append)
                    break
                except LLMError as exc:
                    if exc.kind == "parse" and attempt == 1:
                        continue  # one more try for a malformed answer
                    raise
        except LLMError as exc:
            if exc.kind in ("auth", "bad_request", "refusal"):
                raise  # retrying other chunks cannot help
            log(f"IA: trecho {n}/{len(ranges)} falhou ({exc}); usando regras locais nele")
            failed.append((a, b))
            continue
        ok_chunks += 1
        for w in warnings:
            log(f"IA: trecho {n}: {w}")
            problems.append(w)
        for c in cuts:
            for i in range(c["from"], c["to"] + 1):
                cut_by_index.setdefault(i, c)
        if fix_words:
            fixes.extend(chunk_fixes)
        if note:
            notes.append(note)
    return {"cuts": cut_by_index, "fixes": fixes, "notes": " ".join(notes)[:400], "failed": failed,
            "ok_chunks": ok_chunks, "problems": problems}


# ----------------------------------------------------------------------------
# Safety nets around the model's answer
# ----------------------------------------------------------------------------
def _reason_label(reason: str) -> str:
    """The rules quote the word in their reason ("Take interrompido ('Presta')"): keep the label only."""
    return re.split(r"\s*\(", reason or "", maxsplit=1)[0]


def _local_kind(word: dict) -> str:
    reason = word.get("reason", "")
    if reason.startswith("Gagueira"):
        return "stutter"
    if reason.startswith("Vício"):
        return "filler"
    return "retake"


def _apply_rule_floor(word_status: list[dict], local_cut: dict[int, dict], log: Callable[[str], None]) -> list[int]:
    """The rules that never fail on clear recording errors (an interrupted word like "co--", a reaction like
    "oxi", an immediate retake) win over the model: what they flag is cut even if the model let it through.
    A model that only removes the interrupted word leaves the rest of the failed attempt glued into the
    script, which is exactly the "mixed script" this guards against. Long runs are skipped as suspicious.
    Returns the indices it cut. It only ADDS cuts: it never brings back a word the model removed."""
    added: list[int] = []
    run: list[int] = []
    runs: list[list[int]] = []
    for i in sorted(local_cut):
        if run and i != run[-1] + 1:
            runs.append(run)
            run = []
        run.append(i)
    if run:
        runs.append(run)
    for r in runs:
        if len(r) > FLOOR_MAX_RUN:
            log(f"Regras automáticas: trecho de {len(r)} palavras ignorado (grande demais para ser um erro claro)")
            continue
        for i in r:
            w = word_status[i]
            if w["status"] == "kept":
                w["status"] = "cut"
                w["kind"] = _local_kind(local_cut[i])
                w["reason"] = f"{local_cut[i].get('reason', 'Erro de gravação')} (regra automática)"
                added.append(i)
    return added


def _render_kept(word_status: list[dict], chunk: list[int]) -> str:
    """The script that is left, with {corte} where words were removed or a long pause was cut."""
    parts: list[str] = []
    prev: int | None = None
    for i in chunk:
        w = word_status[i]
        if prev is not None and (i - prev > 1 or w["start"] - word_status[prev]["end"] >= SPLIT_GAP_S):
            parts.append("{corte}")
        parts.append(f"[{i}]{w['text']}")
        prev = i
    return " ".join(parts)


def _apply_plan(word_status: list[dict], plan: ScriptPlan) -> None:
    """Copy mode: the aligned script decides. Words of the chosen takes stay; retakes, interrupted attempts,
    reactions and (when strict) off-script asides go. Leftover words the plan has no opinion on keep the
    rules' verdict only for stutters and fillers (Pass 6's retake guesses are replaced by the alignment)."""
    for w in word_status:
        i = w["index"]
        if i in plan.protected:
            w.update(status="kept", kind=None, reason="")
        elif i in plan.cuts:
            c = plan.cuts[i]
            w.update(status="cut", kind=c["kind"], reason=f"{KIND_LABEL[c['kind']]}: {c['reason']}")
        elif w["status"] == "cut" and w.get("kind") not in ("stutter", "filler"):
            w.update(status="kept", kind=None, reason="")


def _verify_script(word_status: list[dict], provider: str | None, model: str | None, language: str,
                   instructions: str | None, log: Callable[[str], None], call: Callable[..., dict],
                   copy: str | None = None, plan: ScriptPlan | None = None, strict_copy: bool = True) -> tuple[int, list[str]]:
    """Second read of the RESULT: the model reads the script that is left and flags repeated lines,
    dangling fragments and reactions the first pass missed. Best effort: any failure just skips it."""
    protected = plan.protected if plan is not None and plan.used else set()
    kept = [w["index"] for w in word_status if w["status"] == "kept"]
    if len(kept) < 8 or (protected and not [i for i in kept if i not in protected]):
        return 0, []   # every word that is left is the chosen take of a script line: nothing to second-guess
    system = build_system_prompt("verify", language, instructions, copy, plan, strict_copy)

    ranges = _chunks(len(kept), [word_status[i] for i in kept])
    added, problems = 0, []
    for n, (a, b) in enumerate(ranges, start=1):
        chunk = kept[a:b]
        user = f"ROTEIRO RESTANTE, parte {n} de {len(ranges)}.\n{_render_kept(word_status, chunk)}"
        warnings: list[str] = []
        try:
            raw = call(provider, system, user, REVIEW_SCHEMA, model)
            cuts, _fixes, _notes = _validate_chunk(raw, chunk[0], chunk[-1] + 1, word_status, warnings.append,
                                                   allowed=set(chunk), max_fraction=VERIFY_MAX_FRACTION, max_run=VERIFY_MAX_RUN)
        except LLMError as exc:
            log(f"Verificação final: parte {n}/{len(ranges)} não respondeu ({exc}); mantive o resultado")
            continue
        problems += warnings
        allowed = set(chunk) - protected
        for c in cuts:
            for i in range(c["from"], c["to"] + 1):
                w = word_status[i]
                if i in allowed and w["status"] == "kept":
                    w["status"] = "cut"
                    w["kind"] = c["kind"]
                    w["reason"] = f"{KIND_LABEL[c['kind']]} (sobra do roteiro): {c['why']}".rstrip(": ")
                    added += 1
    return added, problems


def _decisions_from_status(word_status: list[dict]) -> list[dict]:
    """One decision per run of removed words that share a reason (what the editor lists)."""
    out: list[dict] = []
    run: list[dict] = []

    def flush() -> None:
        if not run:
            return
        text = " ".join(x["text"] for x in run)
        kind = run[0].get("kind") or _local_kind(run[0])
        out.append({"type": KIND_UI.get(kind, "retake"), "kind": kind, "text": text, "start": run[0]["start"],
                    "end": run[-1]["end"],
                    "description": f"{_reason_label(run[0].get('reason') or '') or KIND_LABEL.get(kind, kind)}: “{text[:90]}”"})
        run.clear()

    def key(w: dict) -> tuple:
        # the local rules mention the word in their reason ("... ('Presta')"): group by the label only
        return (w.get("kind"), _reason_label(w.get("reason") or ""))

    for w in word_status:
        if w["status"] == "cut":
            if run and (key(w) != key(run[-1]) or w["start"] - run[-1]["end"] > 1.0):
                flush()
            run.append(w)
        else:
            flush()
    flush()
    return out


# ----------------------------------------------------------------------------
# Cuts from the decisions
# ----------------------------------------------------------------------------
def _real_end(w: dict, speech: SpeechMap | None) -> float:
    """The word's end for grouping/cutting purposes. The ASR sometimes folds a mid-take pause
    into the word that precedes it (its reported end lands well after the audio actually stops),
    which hides the pause from the word-gap check below: two words can look glued together while
    a real silence sits inside what is nominally a single word. When the audio disagrees with the
    transcript this badly, the real end (where the word's own speech island stops) wins."""
    if speech is None:
        return w["end"]
    isl = speech.containing(w["start"] + 0.03) or speech.containing(w["start"])
    if isl is not None and isl[1] < w["end"] - 0.05:
        return isl[1]
    return w["end"]


def build_clips(word_status: list[dict], duration: float, speech: SpeechMap | None) -> list[dict]:
    """Kept stretches of speech as cut ranges, with edges refined against the audio."""
    kept = [w for w in word_status if w["status"] == "kept"]
    if not kept:
        return []
    real_end = {w["index"]: _real_end(w, speech) for w in kept}

    def real_start(w: dict) -> float:
        # the ASR marks word starts late: the audio onset gives the true length of the pause before it
        if speech is None:
            return w["start"]
        isl = speech.containing(w["start"] + 0.03)
        return min(w["start"], isl[0]) if isl is not None and w["start"] - isl[0] <= 0.4 else w["start"]

    groups: list[list[dict]] = [[kept[0]]]
    for prev, cur in zip(kept, kept[1:]):
        if cur["index"] - prev["index"] > 1 or real_start(cur) - real_end[prev["index"]] >= SPLIT_GAP_S:
            groups.append([cur])
        else:
            groups[-1].append(cur)

    clips: list[dict] = []
    for g in groups:
        first, last = g[0], g[-1]
        prev_end = word_status[first["index"] - 1]["end"] if first["index"] > 0 else 0.0
        next_start = word_status[last["index"] + 1]["start"] if last["index"] + 1 < len(word_status) else duration
        start, end = refine_segment(speech, first["start"], real_end[last["index"]], prev_end, next_start)
        end = min(end, duration) if duration else end
        if end - start >= MIN_SEGMENT_S:
            clips.append({"start": round(start, 3), "end": round(end, 3), "quote": " ".join(w["text"] for w in g)})

    # two neighbours must never overlap: meet in the middle of the gap
    for a, b in zip(clips, clips[1:]):
        if b["start"] < a["end"]:
            mid = round((a["end"] + b["start"]) / 2, 3)
            a["end"], b["start"] = mid, mid
    for i, c in enumerate(clips, start=1):
        c["beat"] = f"CORTE {i}"
        c["reason"] = "Fala revisada"
    return clips


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------
def review_transcript(
    words: list[dict[str, Any]],
    *,
    mode: str = "local",
    provider: str | None = None,
    model: str | None = None,
    language: str = "pt",
    instructions: str | None = None,
    fix_words: bool = True,
    verify: bool = True,
    copy: str | None = None,
    strict_copy: bool = True,
    video_path: Path | None = None,
    duration: float | None = None,
    log: Callable[[str], None] = print,
    call: Callable[..., dict] = llm.complete_json,
) -> dict[str, Any]:
    """Reviews `words` and returns the same shape as analyze_transcript_locally, plus `fixes` and `warnings`.

    With a `copy` (the script the person was reading) the transcript is first ALIGNED to it (backend/script_align.py):
    the best take of every script line is protected from any cut, and retakes, abandoned attempts, reactions and
    (when `strict_copy`) off-script asides are marked. That works without any model (mode "local"); in "llm" mode
    the model only decides on what the alignment left open, and is told about the script and the marks.

    In "llm" mode the result is built in three layers so no single answer can leave errors behind:
      1. the model's cuts (whole failed attempts, retakes, errors), validated;
      2. the automatic rules as a floor: clear recording errors they flag are cut even if the model missed them
         (with an aligned copy the alignment is the floor instead);
      3. a second read of the script that is left, looking for repeated lines and dangling fragments.

    `word_diff[i]["orig_index"]` points into `words`, so callers can apply fixes to the transcript file.
    """
    local = analyze_transcript_locally(words, language)
    word_status = local["word_diff"]
    for w in word_status:
        if w["status"] == "cut":
            w["kind"] = _local_kind(w)
    local_cut = {w["index"]: w for w in word_status if w["status"] == "cut"}
    result: dict[str, Any] = {"fixes": [], "warnings": [], "notes": "", "engine": "local_heuristics", "model": None,
                              "llm_failed": False, "rule_cuts": 0, "verify_cuts": 0, "script": None}

    copy = (copy or "").strip() or None
    plan = ScriptPlan()
    if copy and word_status:
        plan = align_script(word_status, copy, strict=strict_copy, log=log)
        result["warnings"] += plan.warnings
        result["script"] = plan.summary()
        if plan.used:
            _apply_plan(word_status, plan)
            local_cut = {}   # the alignment replaces the rules' retake guesses
            result["engine"] = "copy_align"
            if fix_words:
                result["fixes"] = list(plan.fixes)

    if mode == "llm" and word_status:
        norm = [{"text": w["text"], "start": w["start"], "end": w["end"]} for w in word_status]
        used_provider, used_model = provider, model
        try:
            if call is llm.complete_json:  # fail fast (and name the engine) when the key is missing
                used_provider, used_model, _key = llm.resolve(provider, model)
            res = _llm_statuses(norm, used_provider, used_model, language, instructions, fix_words, log, call,
                                copy=copy, plan=plan, strict_copy=strict_copy)
        except Exception as exc:  # a provider problem must never break the render
            res = None
            result["llm_failed"] = True
            result["warnings"].append(f"Revisão por IA indisponível: {str(exc).rstrip('.')}. Usei as regras locais.")
            log(result["warnings"][-1])

        if res is not None and res["ok_chunks"] > 0:
            failed_idx = {i for a, b in res["failed"] for i in range(a, b)}
            new_status: list[dict] = []
            for w in word_status:
                w = dict(w)
                i = w["index"]
                decided = plan.used and (i in plan.protected or i in plan.cuts)   # the aligned script has spoken
                if i not in failed_idx and not decided:  # chunks the model could not answer keep the local rules' verdict
                    c = res["cuts"].get(i)
                    w["status"] = "cut" if c else "kept"
                    w["reason"] = f"{KIND_LABEL[c['kind']]}: {c['why']}".rstrip(": ") if c else ""
                    w["kind"] = c["kind"] if c else None
                new_status.append(w)
            if sum(1 for w in new_status if w["status"] == "kept") / max(1, len(new_status)) < MIN_KEPT_FRACTION:
                result["warnings"].append("A IA quis remover quase tudo; resposta descartada e regras locais usadas.")
                log(result["warnings"][-1])
                result["llm_failed"] = True
            else:
                word_status = new_status
                if plan.used:
                    blocked = sum(1 for i in res["cuts"] if i in plan.protected)
                    if blocked:
                        log(f"IA: {blocked} palavra(s) que a IA quis cortar fazem parte da copy e foram mantidas")
                    taken = {f["index"] for f in result["fixes"]}
                    result["fixes"] = result["fixes"] + [f for f in res["fixes"] if f["index"] not in taken]
                else:
                    result["fixes"] = res["fixes"]
                result["notes"] = res["notes"]
                if res["problems"]:
                    result["warnings"].append("A IA deu respostas que ignorei por segurança: " + "; ".join(res["problems"][:3]))
                result["engine"] = f"llm_{used_provider or 'custom'}"
                result["model"] = used_model
                if res["failed"]:
                    result["warnings"].append(f"{len(res['failed'])} trecho(s) não puderam ser revisados pela IA e usaram as regras locais.")

                # layer 2: the rules win on clear recording errors (with an aligned copy the alignment already did it)
                floor = _apply_rule_floor(word_status, local_cut, log) if not plan.used else []
                if floor and sum(1 for w in word_status if w["status"] == "kept") / len(word_status) < MIN_KEPT_FRACTION:
                    for i in floor:  # the floor alone would gut the video: drop ITS cuts, keep the model's
                        word_status[i].update(status="kept", kind=None, reason="")
                    log("Regras automáticas ignoradas: removeriam quase todo o vídeo")
                    floor = []
                result["rule_cuts"] = len(floor)
                if result["rule_cuts"]:
                    log(f"Regras automáticas removeram {result['rule_cuts']} palavra(s) de erro claro que a IA deixou passar")

                # layer 3: read the script that is left
                if verify:
                    result["verify_cuts"], problems = _verify_script(word_status, used_provider, used_model, language,
                                                                     instructions, log, call, copy=copy, plan=plan,
                                                                     strict_copy=strict_copy)
                    if result["verify_cuts"]:
                        log(f"Verificação final do roteiro removeu mais {result['verify_cuts']} palavra(s) sobrando")
                    if problems:
                        result["warnings"].append("Verificação final: " + "; ".join(problems[:2]))
        elif res is not None:
            result["llm_failed"] = True
            result["warnings"].append("A IA não respondeu em nenhum trecho. Usei as regras locais.")
            log(result["warnings"][-1])

    # The rules can also go overboard (one "errei" flags the whole phrase): never keep almost nothing
    if word_status and sum(1 for w in word_status if w["status"] == "kept") / len(word_status) < MIN_KEPT_FRACTION:
        result["warnings"].append("A revisão removeria quase todo o vídeo; ignorei-a e mantive a fala inteira."
                                  + (" Confira se a copy é a deste vídeo e se está completa." if plan.used else ""))
        log(result["warnings"][-1])
        word_status = [dict(w, status="kept", reason="", kind=None) for w in word_status]
        result["fixes"] = []
        if plan.used:
            result["script"] = dict(result["script"] or {}, used=False)

    result["decisions"] = _decisions_from_status(word_status)

    # --- cuts: from the final verdicts, with edges refined on the real audio
    total = duration or (words[-1]["end"] if words else 0.0)
    speech = load_speech_map(video_path) if video_path else None
    clips = build_clips(word_status, total, speech)

    cut_words = [w for w in word_status if w["status"] == "cut"]
    kinds = [d.get("kind") or d["type"] for d in result["decisions"]]
    result["summary"] = {
        "errors_found": len(result["decisions"]),
        "retakes": sum(1 for k in kinds if k in ("retake", "error", "false_start", "off_topic", "noise")),
        "stutters": sum(1 for k in kinds if k == "stutter"),
        "fillers": sum(1 for k in kinds if k == "filler"),
        "cut_words": len(cut_words),
        "fixes": len(result["fixes"]),
        "rule_cuts": result["rule_cuts"],
        "verify_cuts": result["verify_cuts"],
        # Time actually recovered by removing the flagged words, not by the natural pauses
        # between kept phrases that `build_clips` always closes up regardless of any error
        # being found (that made "0 erros" show up next to a large "tempo economizado").
        "time_saved_s": round(sum(w["end"] - w["start"] for w in cut_words), 2),
        "total_cuts": len(clips),
        "engine": result["engine"],
        "model": result["model"],
        "llm_notes": result["notes"],
        "edges": "audio" if speech is not None else "padding",
        "script": result["script"],
    }
    result["word_diff"] = word_status
    result["recommended_cuts"] = clips
    return result


def apply_fixes(transcript_path: Path, word_diff: list[dict], fixes: list[dict]) -> int:
    """Writes accepted word corrections into the transcript file (original kept in `orig_text`)."""
    if not fixes:
        return 0
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    tr_words = data.get("words", [])
    by_index = {w["index"]: w for w in word_diff}
    n = 0
    for f in fixes:
        w = by_index.get(f["index"])
        if not w or w.get("orig_index") is None or w["orig_index"] >= len(tr_words):
            continue
        target = tr_words[w["orig_index"]]
        tail = re.search(r"[.,;:!?…]+$", target.get("text", ""))
        new = f["to"] if re.search(r"[.,;:!?…]$", f["to"]) or not tail else f["to"] + tail.group(0)
        target.setdefault("orig_text", target.get("text"))
        target["text"] = new
        n += 1
    if n:
        transcript_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return n
