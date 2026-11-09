from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Any

# Common Portuguese and English filler words
FILLER_WORDS = {
    "pt": {"é", "éé", "ééé", "hum", "humm", "hummm", "tipo", "tipo assim", "né", "tá", "ah", "ahh", "então", "quer dizer", "sabe"},
    "en": {"um", "umm", "uh", "uhh", "er", "like", "you know", "i mean", "so", "actually"}
}

FILLER_STARTERS = {"e", "aí", "ai", "então", "mas", "ó", "bom", "olha", "só", "que", "ou", "seja", "quer", "dizer"}
ERROR_EXCLAMATIONS = {"oxi", "oxi.", "opa", "opa.", "pera", "peraí", "perai", "droga", "nossa", "ops", "calma", "desculpa", "errei", "caramba"}

def clean_word(txt: str) -> str:
    """Normalize word by lowering and stripping non-alphanumeric (except dashes)."""
    return re.sub(r"[^\w\s-]", "", txt.lower()).strip()

def build_recommended_cuts(word_status: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Build clean, continuous kept ranges with:
    - 50ms (0.05s) lead-in before the first word of a segment
    - 80ms (0.08s) tail padding after the last word of a segment (prevent clipping consonants)
    - Split only when words in between are cut OR true silence >= 0.8s
    """
    kept_words = [w for w in word_status if w.get("status") == "kept"]
    recommended_cuts = []
    
    if not kept_words:
        return recommended_cuts
        
    seg_start = max(0.0, kept_words[0]["start"] - 0.05)
    seg_words = [kept_words[0]]
    
    for idx in range(1, len(kept_words)):
        w_prev = kept_words[idx - 1]
        w_curr = kept_words[idx]
        
        gap = w_curr["start"] - w_prev["end"]
        had_cut_in_between = (w_curr["index"] - w_prev["index"] > 1)
        
        # Split cut ONLY if words were cut in between OR dead silence >= 0.8s
        if had_cut_in_between or gap >= 0.8:
            seg_end = w_prev["end"] + 0.08
            recommended_cuts.append({
                "start": round(seg_start, 3),
                "end": round(seg_end, 3),
                "beat": f"CORTE {len(recommended_cuts) + 1}",
                "quote": " ".join(w["text"] for w in seg_words),
                "reason": "Fala fluida limpa"
            })
            seg_start = max(0.0, w_curr["start"] - 0.05)
            seg_words = [w_curr]
        else:
            seg_words.append(w_curr)
            
    if seg_words:
        seg_end = seg_words[-1]["end"] + 0.08
        recommended_cuts.append({
            "start": round(seg_start, 3),
            "end": round(seg_end, 3),
            "beat": f"CORTE {len(recommended_cuts) + 1}",
            "quote": " ".join(w["text"] for w in seg_words),
            "reason": "Fala fluida limpa"
        })
        
    return recommended_cuts

def analyze_transcript_locally(words: list[dict[str, Any]], language: str = "pt") -> dict[str, Any]:
    """
    Intelligent local analysis for detecting:
    1. Filter out spacing items and empty tokens from ASR outputs
    2. Immediate stutters / word repetitions (e.g. "eu eu", "para para")
    3. False starts & retakes (e.g. "eu gostaria de... eu gostaria de poder criar")
    4. Truncated words (e.g. "co--", "come--") and meta-commentary / error reactions ("oxi", "opa", "errei")
    5. Multi-take phrase matching: detecting repeated attempts at the same thought and picking the best/final take
    6. Hesitation fillers ("ééé", "hum", "tipo assim")
    """
    if not words:
        return {
            "summary": {"errors_found": 0, "retakes": 0, "fillers": 0, "stutters": 0, "time_saved_s": 0.0, "total_cuts": 0, "engine": "local_heuristics"},
            "decisions": [],
            "word_diff": [],
            "recommended_cuts": []
        }

    lang_fillers = FILLER_WORDS.get(language, FILLER_WORDS["pt"])
    
    # Filter out pure spacing / empty items so word index and adjacency are 100% accurate
    word_status: list[dict[str, Any]] = []
    for idx, w in enumerate(words):
        if w.get("type") == "spacing":
            continue
        txt = w.get("text", "").strip()
        if not txt:
            continue
        word_status.append({
            "index": len(word_status),
            "orig_index": idx,
            "text": txt,
            "start": round(float(w.get("start", 0.0)), 3),
            "end": round(float(w.get("end", 0.0)), 3),
            "status": "kept",
            "reason": ""
        })

    if not word_status:
        return {
            "summary": {"errors_found": 0, "retakes": 0, "fillers": 0, "stutters": 0, "time_saved_s": 0.0, "total_cuts": 0, "engine": "local_heuristics"},
            "decisions": [],
            "word_diff": [],
            "recommended_cuts": []
        }

    decisions = []
    retakes_count = 0
    stutters_count = 0
    fillers_count = 0
    n = len(word_status)

    # Pass 1: Immediate stutters / word repetitions (e.g. "eu eu", "para para")
    i = 0
    while i < n - 1:
        w1 = clean_word(word_status[i]["text"])
        w2 = clean_word(word_status[i + 1]["text"])
        if w1 and w1 == w2 and len(w1) > 1:
            word_status[i]["status"] = "cut"
            word_status[i]["reason"] = f"Gagueira / Repetição ('{word_status[i]['text']}')"
            stutters_count += 1
            decisions.append({
                "type": "stutter",
                "text": word_status[i]["text"],
                "start": word_status[i]["start"],
                "end": word_status[i]["end"],
                "description": f"Gagueira / Repetição da palavra '{w1}'"
            })
            i += 2
            continue
        i += 1

    # Pass 2: Immediate 2-word repetitions (e.g. "eu quero ... eu quero")
    i = 0
    while i < n - 3:
        p1 = f"{clean_word(word_status[i]['text'])} {clean_word(word_status[i+1]['text'])}"
        p2 = f"{clean_word(word_status[i+2]['text'])} {clean_word(word_status[i+3]['text'])}"
        if len(p1) > 3 and p1 == p2:
            word_status[i]["status"] = "cut"
            word_status[i]["reason"] = f"Reinício de frase ('{p1}')"
            word_status[i+1]["status"] = "cut"
            word_status[i+1]["reason"] = f"Reinício de frase ('{p1}')"
            retakes_count += 1
            decisions.append({
                "type": "retake",
                "text": p1,
                "start": word_status[i]["start"],
                "end": word_status[i+1]["end"],
                "description": f"Reinício falso da expressão '{p1}'"
            })
            i += 4
            continue
        i += 1

    # Pass 3: Long hesitation fillers ("ééé", "hum", "tipo assim")
    for i in range(n):
        cw = clean_word(word_status[i]["text"])
        if cw in lang_fillers and (word_status[i]["end"] - word_status[i]["start"] > 0.35):
            word_status[i]["status"] = "cut"
            word_status[i]["reason"] = f"Vício de linguagem ('{cw}')"
            fillers_count += 1
            decisions.append({
                "type": "filler",
                "text": word_status[i]["text"],
                "start": word_status[i]["start"],
                "end": word_status[i]["end"],
                "description": f"Hesitação / Vício de linguagem: '{cw}'"
            })

    # Pass 4: Group words into phrase chunks based on pauses (>0.6s) or terminal punctuation
    phrases = []
    cur_phrase = []
    for w in word_status:
        if cur_phrase:
            gap = w["start"] - cur_phrase[-1]["end"]
            prev_has_punct = bool(re.search(r"[.?!;:]$", cur_phrase[-1]["text"]))
            if gap > 0.6 or (prev_has_punct and gap > 0.3):
                phrases.append(cur_phrase)
                cur_phrase = []
        cur_phrase.append(w)
    if cur_phrase:
        phrases.append(cur_phrase)

    # Pass 5: Truncated / trailed-off words (ending in '--', '-' or an ellipsis like '...'/'…',
    # the mark ASR engines use for a word or sentence that was cut off) and reaction exclamations
    for p in phrases:
        has_truncation = any(
            w["text"].endswith("--") or (w["text"].endswith("-") and len(w["text"]) > 1)
            or w["text"].endswith("...") or w["text"].endswith("…")
            for w in p
        )
        has_exclamation = any(clean_word(w["text"]) in ERROR_EXCLAMATIONS for w in p)
        
        if has_truncation or has_exclamation:
            for w in p:
                w["status"] = "cut"
                w["reason"] = f"Take interrompido / Erro de fala ('{w['text']}')"
            p_text = " ".join(x["text"] for x in p)
            retakes_count += 1
            decisions.append({
                "type": "retake",
                "text": p_text,
                "start": p[0]["start"],
                "end": p[-1]["end"],
                "description": f"Take interrompido com gagueira ou exclamação de erro ('{p_text}')"
            })

    # Pass 6: Multi-take retakes across phrases (looking back at earlier attempts of the same sentence)
    for idx2 in range(1, len(phrases)):
        p2 = phrases[idx2]
        # Compare with earlier phrases (up to 4 phrases prior)
        for idx1 in range(max(0, idx2 - 4), idx2):
            p1 = phrases[idx1]
            
            # If p1 is already all cut, no need to cut again
            if all(w["status"] == "cut" for w in p1):
                continue
                
            w1_list = [clean_word(w["text"]) for w in p1 if clean_word(w["text"])]
            w2_list = [clean_word(w["text"]) for w in p2 if clean_word(w["text"])]
            
            # Strip leading conversational starters ("e", "aí", "então", "mas", etc.)
            core1 = [w for w in w1_list if w not in FILLER_STARTERS] or w1_list
            core2 = [w for w in w2_list if w not in FILLER_STARTERS] or w2_list
            
            if not core1 or not core2:
                continue
                
            # An earlier phrase is a retake of a later one only when the later phrase REPEATS it and goes on:
            # the earlier words appear, in order, inside the later phrase. Sharing only the first words is not
            # enough: scripts repeat structures on purpose ("A gente faz. A gente integra. A gente conecta.")
            # and those are different lines, not attempts at the same one.
            if len(core1) < 3 or len(core2) < len(core1):
                continue
            matches = 0
            for a, b in zip(core1, core2):
                if a != b:
                    break
                matches += 1
            is_prefix_retake = matches >= 3 and matches / len(core1) >= 0.75

            remaining = iter(core2)
            in_order = sum(1 for w in core1 if any(w == x for x in remaining))
            is_semantic_retake = in_order / len(core1) >= 0.85

            if is_prefix_retake or is_semantic_retake:
                for w in p1:
                    w["status"] = "cut"
                    w["reason"] = f"Take abandonado em favor da repetição final"
                p1_text = " ".join(x["text"] for x in p1)
                p2_text = " ".join(x["text"] for x in p2)
                retakes_count += 1
                decisions.append({
                    "type": "retake",
                    "text": p1_text,
                    "start": p1[0]["start"],
                    "end": p1[-1]["end"],
                    "description": f"Take inicial abandonado ('{p1_text}') em favor da repetição ('{p2_text}')"
                })

    recommended_cuts = build_recommended_cuts(word_status)

    # Time actually recovered by removing the flagged words, not by the natural pauses between
    # kept phrases that build_recommended_cuts always closes up regardless of any error found.
    time_saved = round(sum(w["end"] - w["start"] for w in word_status if w["status"] == "cut"), 2)

    return {
        "summary": {
            "errors_found": stutters_count + retakes_count + fillers_count,
            "retakes": retakes_count,
            "stutters": stutters_count,
            "fillers": fillers_count,
            "time_saved_s": time_saved,
            "total_cuts": len(recommended_cuts),
            "engine": "local_heuristics"
        },
        "decisions": decisions,
        "word_diff": word_status,
        "recommended_cuts": recommended_cuts
    }
