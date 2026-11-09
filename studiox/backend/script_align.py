"""Aligns a recording's transcript with the COPY (the script the person was reading).

Recorded takes are noisy: the same line is said several times, attempts are abandoned, reactions and
asides get in, and scripts repeat structures on purpose ("A gente faz. A gente integra. A gente
conecta."). Without the script nothing can tell an intentional repetition from a retake. With it, the
question becomes simple: for each line of the copy, which take is the good one?

How
  * the copy is split into lines and both sides are reduced to normalised tokens (accents/case/punctuation);
  * a dynamic program (vectorised with numpy) finds the best in-order matching of the copy's tokens to the
    transcript's words. Matches score, tokens the speaker never said cost, skipping words INSIDE a line costs a
    lot (a good take is compact), skipping words BETWEEN lines is nearly free (that is where retakes live), and a
    later take wins a tie (the last attempt is usually the good one);
  * the words matched to a line are PROTECTED: no rule or model may cut them, which is what stops a script's
    deliberate repetition from being taken for a retake;
  * what is left over between the protected words is classified: an earlier/partial attempt at a line (cut),
    an interrupted word or a reaction (cut), a short aside that is not in the copy (cut when strict), or a long
    stretch that is not in the copy (kept, and reported, because it may be an ad-lib the copy does not have);
  * words that were matched approximately ("Ebenezer" heard for "Ebenézer") become correction suggestions.
"""
from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

NEG = -1e9
EXACT, FUZZY, PARTIAL = 1.0, 0.6, 0.3
DELETE = 0.9              # a copy token the speaker never said
SKIP_IN = 0.5             # per transcript word skipped inside a line
SKIP_BETWEEN = 0.005      # per transcript word skipped between lines (retakes live there)
LATE_BONUS = 0.02         # a later take wins a tie
MIN_LINE_COVERAGE = 0.5   # a line counts as recorded when at least this share of its tokens matched
MIN_CONFIDENCE = 0.5      # below this share of the copy matched, the copy does not describe this video
MAX_CELLS = 12_000_000    # m * n limit of the alignment table
INNER_KEEP = 2            # up to this many unmatched words inside a take are transcription noise: keep them
OFF_SCRIPT_CUT_MAX = 12   # short off-script stretches are cut when strict; longer ones are kept and reported
UNIT_GAP_S = 0.5
HARD_UNIT_MAX = 40        # a stretch with an interrupted word / reaction is cut whole up to this many words
FREE_VERSION_MIN = 0.35   # an unmatched stretch this similar to a line that was not found is kept as a free version of it
COVER_MIN = 0.45          # a copy that explains less than this share of the speech cannot decide what the rest is

_SPLIT_RE = re.compile(r"(?<=[.!?…])\s+|\n+")
_REACTIONS = {"oxi", "opa", "pera", "perai", "droga", "nossa", "ops", "calma", "desculpa", "errei", "caramba",
              "eita", "putz", "meudeus", "hum", "hmm", "ai"}


def norm_token(text: str) -> str:
    text = unicodedata.normalize("NFD", (text or "").lower())
    return re.sub(r"[^\w]", "", "".join(c for c in text if unicodedata.category(c) != "Mn")).replace("_", "")


@dataclass
class ScriptLine:
    number: int
    text: str
    tokens: list[str]


def split_copy(copy: str) -> list[ScriptLine]:
    """Copy -> lines (sentences). Fragments of fewer than 2 words are glued to the previous line."""
    pieces = [p.strip() for p in _SPLIT_RE.split((copy or "").replace("\r", "")) if p and p.strip()]
    lines: list[ScriptLine] = []
    for piece in pieces:
        toks = [t for t in (norm_token(w) for w in piece.split()) if t]
        if not toks:
            continue
        if lines and len(toks) < 2:
            lines[-1].text += " " + piece
            lines[-1].tokens += toks
            continue
        lines.append(ScriptLine(len(lines) + 1, piece, toks))
    return lines


@dataclass
class ScriptPlan:
    used: bool = False
    confidence: float = 0.0
    lines: list[dict] = field(default_factory=list)         # per copy line: status, coverage, first/last word index
    protected: set[int] = field(default_factory=set)         # word indices no rule or model may cut
    cuts: dict[int, dict] = field(default_factory=dict)      # word index -> {kind, reason}
    fixes: list[dict] = field(default_factory=list)          # {index, from, to}: transcript word -> copy spelling
    warnings: list[str] = field(default_factory=list)
    out_of_order: list[int] = field(default_factory=list)    # copy lines recorded after a later line
    off_script_kept: int = 0

    def summary(self) -> dict:
        ok = [l for l in self.lines if l["status"] == "ok"]
        return {
            "used": self.used, "confidence": round(self.confidence, 2), "lines_total": len(self.lines),
            "lines_ok": len(ok), "lines_partial": [l["number"] for l in self.lines if l["status"] == "partial"],
            "lines_missing": [l["number"] for l in self.lines if l["status"] == "missing"],
            "lines_free": [l["number"] for l in self.lines if l["status"] == "free"],
            "out_of_order": self.out_of_order, "cut_words": len(self.cuts), "fixes": len(self.fixes),
            "off_script_kept": self.off_script_kept,
        }


# ----------------------------------------------------------------------------
# Token similarity
# ----------------------------------------------------------------------------
def _fuzzy(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if abs(len(a) - len(b)) > 3 or not a or not b or (a[0] != b[0] and a[-1] != b[-1]):
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _sim_row(token: str, x_tokens: list[str], positions: dict[str, list[int]], vocab: list[str],
             truncated: set[int], cache: dict[str, np.ndarray]) -> np.ndarray:
    """Score of matching copy token `token` to each transcript token (NEG where they do not match)."""
    if token in cache:
        return cache[token]
    row = np.full(len(x_tokens), NEG)
    for i in positions.get(token, ()):
        row[i] = EXACT
    for other in vocab:
        if other == token:
            continue
        if _fuzzy(token, other) >= 0.75:
            for i in positions[other]:
                row[i] = max(row[i], FUZZY)
        elif len(other) >= 2 and token.startswith(other):  # interrupted word: "gen--" for "gente"
            for i in positions[other]:
                if i in truncated:
                    row[i] = max(row[i], PARTIAL)
    cache[token] = row
    return row


# ----------------------------------------------------------------------------
# Alignment
# ----------------------------------------------------------------------------
def _align(c_tokens: list[str], c_first: list[bool], x_tokens: list[str], truncated: set[int]) -> list[tuple[int, int]]:
    """Best in-order matching of copy tokens (rows) to transcript tokens (columns): [(copy_j, transcript_i)]."""
    m, n = len(c_tokens), len(x_tokens)
    positions: dict[str, list[int]] = {}
    for i, t in enumerate(x_tokens):
        positions.setdefault(t, []).append(i)
    vocab = list(positions)
    cache: dict[str, np.ndarray] = {}

    # column 0 = "nothing consumed yet"; transcript token i sits in column i + 1
    g = np.full((m + 1, n + 1), NEG)
    from_match = np.zeros((m + 1, n + 1), dtype=bool)
    prev_arg = np.zeros((m + 1, n + 1), dtype=np.int32)
    g[0, 0] = 0.0
    idx = np.arange(n + 1, dtype=np.float64)
    late = LATE_BONUS * (np.arange(n, dtype=np.float64) + 1) / max(1, n)

    for j in range(1, m + 1):
        a = SKIP_BETWEEN if c_first[j - 1] else SKIP_IN
        sim = _sim_row(c_tokens[j - 1], x_tokens, positions, vocab, truncated, cache)
        prev = g[j - 1]
        A = prev + a * idx
        cum = np.maximum.accumulate(A)
        # index of the (latest) column that attains the running maximum
        hit = np.where(A >= cum - 1e-12, np.arange(n + 1), 0)
        argcum = np.maximum.accumulate(hit)

        matched = np.full(n + 1, NEG)
        col = np.arange(1, n + 1)
        base = cum[col - 1] - a * (col - 1)                     # best predecessor score for a match in column i
        ok = sim > NEG / 2
        matched[1:] = np.where(ok, base + sim + late, NEG)
        arg = np.zeros(n + 1, dtype=np.int32)
        arg[1:] = argcum[col - 1]

        deleted = prev - DELETE
        take_match = matched > deleted
        g[j] = np.where(take_match, matched, deleted)
        from_match[j] = take_match
        prev_arg[j] = arg

    i = int(np.argmax(g[m]))
    pairs: list[tuple[int, int]] = []
    j = m
    while j > 0:
        if from_match[j, i] and i > 0:
            pairs.append((j - 1, i - 1))
            i = int(prev_arg[j, i])
        j -= 1
    pairs.reverse()
    return pairs


# ----------------------------------------------------------------------------
# Plan
# ----------------------------------------------------------------------------
def _hard_marker(word: dict) -> bool:
    """An interrupted word ("gen--", "co-") or a reaction ("oxi", "errei"): never part of a good take."""
    text = word["text"].strip()
    return text.endswith("--") or (text.endswith("-") and len(text) > 1) or norm_token(text) in _REACTIONS


def _units(indices: list[int], words: list[dict]) -> list[list[int]]:
    """Consecutive unprotected words -> units (a stretch said in one go)."""
    out: list[list[int]] = []
    for i in indices:
        if out and i == out[-1][-1] + 1 and words[i]["start"] - words[out[-1][-1]]["end"] < UNIT_GAP_S:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def _best_line(tokens: list[str], lines: list[ScriptLine]) -> tuple[float, ScriptLine | None]:
    best, best_line = 0.0, None
    for ln in lines:
        r = difflib.SequenceMatcher(None, tokens, ln.tokens).ratio()
        # an interrupted attempt is a prefix of the line: score how much of the attempt fits the line in order
        it = iter(ln.tokens)
        inside = sum(1 for t in tokens if any(t == x for x in it)) / max(1, len(tokens))
        score = max(r, inside * 0.9 if len(tokens) >= 2 else 0.0)
        if score > best:
            best, best_line = score, ln
    return best, best_line


def _fix_for(word_text: str, copy_word: str, same_token: bool, first_in_line: bool) -> str | None:
    """The copy's spelling for a transcript word, or None when the difference is not worth touching.
    Names and terms are worth fixing ("Ebenezer" -> "Ebenézer"); a speaker's own register ("pra" for "para") is not."""
    clean = re.sub(r"^\W+|\W+$", "", copy_word)
    heard = re.sub(r"^\W+|\W+$", "", word_text)
    if not clean or clean == heard:
        return None
    if same_token:                                   # same word, different accents/case
        return clean if clean.lower() != heard.lower() else None
    name_like = (clean[0].isupper() and not first_in_line) or any(c.isupper() for c in clean[1:]) or any(c.isdigit() for c in clean)
    ratio = difflib.SequenceMatcher(None, norm_token(clean), norm_token(heard)).ratio()
    return clean if name_like or (len(clean) >= 6 and ratio >= 0.85) else None


def align_script(words: list[dict[str, Any]], copy: str, *, strict: bool = True,
                 log: Callable[[str], None] = print) -> ScriptPlan:
    """`words`: the transcript as word_status dicts (index, text, start, end). Returns the plan for `copy`."""
    plan = ScriptPlan()
    lines = split_copy(copy)
    if not lines or not words:
        return plan

    x_tokens, x_word = [], []
    truncated: set[int] = set()
    for w in words:
        t = norm_token(w["text"])
        if t:
            if w["text"].strip().endswith(("--", "-")):
                truncated.add(len(x_tokens))
            x_tokens.append(t)
            x_word.append(w["index"])
    c_tokens = [t for ln in lines for t in ln.tokens]
    c_line = [ln.number for ln in lines for _ in ln.tokens]
    c_first = [k == 0 for ln in lines for k in range(len(ln.tokens))]
    if len(c_tokens) * (len(x_tokens) + 1) > MAX_CELLS:
        plan.warnings.append("A copy é grande demais para o alinhamento automático deste vídeo; usei só a revisão comum.")
        return plan
    if not x_tokens:
        return plan

    pairs = _align(c_tokens, c_first, x_tokens, truncated)
    by_line: dict[int, list[tuple[int, int]]] = {}
    for j, i in pairs:
        by_line.setdefault(c_line[j], []).append((j, i))

    matched_total = 0
    spans: list[tuple[int, int, int]] = []          # (line number, first transcript token, last transcript token)
    for ln in lines:
        pr = by_line.get(ln.number, [])
        coverage = len(pr) / len(ln.tokens)
        entry = {"number": ln.number, "text": ln.text, "coverage": round(coverage, 2), "first": None, "last": None,
                 "status": "missing"}
        if pr and coverage >= MIN_LINE_COVERAGE:
            first_i, last_i = pr[0][1], pr[-1][1]
            entry.update(first=x_word[first_i], last=x_word[last_i], status="ok" if coverage >= 0.8 else "partial")
            spans.append((ln.number, first_i, last_i))
            matched_total += len(pr)
            for j, i in pr:
                plan.protected.add(x_word[i])
                w = words[x_word[i]]
                if w["text"].strip().endswith(("--", "-")):
                    continue
                copy_word = next((cw for cw in ln.text.split() if norm_token(cw) == c_tokens[j]), None)
                if copy_word:
                    new = _fix_for(w["text"], copy_word, x_tokens[i] == c_tokens[j], c_first[j])
                    if new:
                        plan.fixes.append({"index": x_word[i], "from": w["text"], "to": new})
        plan.lines.append(entry)
    plan.confidence = matched_total / max(1, len(c_tokens))

    if plan.confidence < MIN_CONFIDENCE:
        plan.warnings.append(f"A copy combina pouco com o que foi gravado ({plan.confidence:.0%}); ignorei o alinhamento. "
                             "Confira se a copy é a deste vídeo.")
        plan.protected.clear()
        plan.fixes.clear()
        return plan
    plan.used = True

    # words inside a line's span that did not match: a couple are transcription noise (kept), unless they are an
    # interrupted word, a reaction or an immediate repeat of a neighbour (a stutter)
    def stutter_or_marker(i: int) -> bool:
        if _hard_marker(words[x_word[i]]):
            return True
        return (i > 0 and x_tokens[i] == x_tokens[i - 1]) or (i + 1 < len(x_tokens) and x_tokens[i] == x_tokens[i + 1])

    for _num, first_i, last_i in spans:
        run: list[int] = []
        for i in list(range(first_i, last_i + 1)) + [None]:
            if i is not None and x_word[i] not in plan.protected:
                run.append(i)
                continue
            if run and len(run) <= INNER_KEEP and not any(stutter_or_marker(r) for r in run):
                for r in run:
                    plan.protected.add(x_word[r])
            run = []

    # order check: the lines should be recorded in copy order
    firsts = [(num, x_word[fi]) for num, fi, _li in spans]
    for (n1, w1), (n2, w2) in zip(firsts, firsts[1:]):
        if w2 < w1:
            plan.out_of_order.append(n2)
    if plan.out_of_order:
        plan.warnings.append("Linhas gravadas fora da ordem da copy: " + ", ".join(map(str, plan.out_of_order))
                             + ". A edição segue a ordem da gravação.")

    # a copy that explains only a small part of what was said cannot say the rest is wrong (a copy for the intro only)
    cover = len(plan.protected) / max(1, len(words))
    if strict and cover < COVER_MIN:
        strict = False
        plan.warnings.append(f"A copy cobre só {cover:.0%} do que foi falado; por isso não cortei as falas que estão fora dela. "
                             "Confira se a copy está completa.")

    # everything that is not protected: retake of a line / reaction / stutter, or an open stretch (decided below)
    recorded = [ln for ln in lines if any(e["number"] == ln.number and e["status"] != "missing" for e in plan.lines)]
    absent = [ln for ln in lines if ln not in recorded]
    tok_of = {w["index"]: norm_token(w["text"]) for w in words}
    rest = [w["index"] for w in words if w["index"] not in plan.protected]
    open_units: list[list[int]] = []
    for unit in _units(rest, words):
        toks = [t for t in (tok_of[i] for i in unit) if t]
        if not toks:
            for i in unit:
                plan.cuts[i] = {"kind": "noise", "reason": "Sem fala"}
            continue
        hard = [i for i in unit if _hard_marker(words[i])]
        if hard:
            targets = unit if len(unit) <= HARD_UNIT_MAX else hard
            for i in targets:
                plan.cuts[i] = {"kind": "false_start", "reason": "Tentativa interrompida ou reação de erro"}
            continue
        before = words[unit[0] - 1] if unit[0] > 0 else None
        after = words[unit[-1] + 1] if unit[-1] + 1 < len(words) else None
        if len(toks) <= 2 and any(x is not None and tok_of[x["index"]] == toks[0] for x in (before, after)):
            for i in unit:
                plan.cuts[i] = {"kind": "stutter", "reason": "Repetição imediata de palavra"}
            continue
        score, line = _best_line(toks, recorded)
        if line is not None and score >= 0.5:
            for i in unit:
                plan.cuts[i] = {"kind": "retake", "reason": f"Take repetido da linha {line.number} da copy"}
            continue
        if open_units and unit[0] == open_units[-1][-1] + 1:      # a pause inside one stretch of speech
            open_units[-1].extend(unit)
        else:
            open_units.append(list(unit))

    def keep_free(unit: list[int], why: str) -> None:
        plan.off_script_kept += len(unit)
        plan.warnings.append(f"{why} ({words[unit[0]]['start']:.0f}s): “{' '.join(words[i]['text'] for i in unit[:8])}…”")

    # a line that was not found may have been said with other words: what was recorded where it belongs is that line
    span_by_line = {num: (x_word[fi], x_word[li]) for num, fi, li in spans}
    claimed: set[int] = set()
    absent_nums = [ln.number for ln in absent]
    runs: list[list[int]] = []
    for n in absent_nums:
        if runs and n == runs[-1][-1] + 1:
            runs[-1].append(n)
        else:
            runs.append([n])
    for run in runs:
        lo = span_by_line[run[0] - 1][1] if run[0] - 1 in span_by_line else -1
        hi = span_by_line[run[-1] + 1][0] if run[-1] + 1 in span_by_line else len(words)
        window = [u for u in open_units if lo < u[0] < hi and len([t for t in (tok_of[i] for i in u) if t]) >= 3]
        took = window[-len(run):]                                 # the last attempt(s) are the ones that count
        for u in took:
            claimed.update(u)
            keep_free(u, f"A linha {'/'.join(map(str, run))} da copy não foi dita como está escrita; mantive o que foi gravado no lugar dela")
        for num in run[len(run) - len(took):]:
            next(e for e in plan.lines if e["number"] == num)["status"] = "free"
    for u in open_units:
        if claimed.issuperset(u):
            continue
        toks = [t for t in (tok_of[i] for i in u) if t]
        free_score, free_line = _best_line(toks, absent)
        if free_line is not None and free_score >= FREE_VERSION_MIN and len(toks) >= 3:
            keep_free(u, f"Fala parecida com a linha {free_line.number} da copy (dita com outras palavras) foi mantida")
        elif len(u) <= OFF_SCRIPT_CUT_MAX and strict:
            for i in u:
                plan.cuts[i] = {"kind": "off_topic", "reason": "Fora da copy"}
        elif len(u) > OFF_SCRIPT_CUT_MAX:
            keep_free(u, f"Trecho de {len(u)} palavras que não está na copy foi mantido")
    missing = [l["number"] for l in plan.lines if l["status"] == "missing"]
    if missing:
        plan.warnings.append("Linhas da copy que não encontrei na gravação: " + ", ".join(map(str, missing)))
    log(f"Copy alinhada: {sum(1 for l in plan.lines if l['status'] == 'ok')}/{len(plan.lines)} linhas encontradas, "
        f"{len(plan.cuts)} palavra(s) fora da melhor versão")
    return plan
