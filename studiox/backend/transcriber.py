from __future__ import annotations
import json
import os
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from backend import audio_timeline
from backend.config import get_elevenlabs_api_key, has_whisper_available, ensure_ffmpeg

ensure_ffmpeg()

# Transcription engines. "auto" tries them in this order: ElevenLabs Scribe (paid, key in Configurações), Groq Whisper
# (the Groq key of the AI providers), Whisper installed on this computer.
ENGINES = ("auto", "elevenlabs", "groq", "groq_turbo", "whisper")
GROQ_MODELS = {"groq": "whisper-large-v3", "groq_turbo": "whisper-large-v3-turbo"}
GROQ_CHUNK_S = 480           # a longer recording is sent in pieces of about this length (upload limit: 25 MB on the free plan)

def elevenlabs_base() -> str:
    # ELEVENLABS_BASE_URL points the app at a local test server (like LLM_BASE_URL_<PROVIDER> does for the IAs)
    return (os.environ.get("ELEVENLABS_BASE_URL") or "https://api.elevenlabs.io").rstrip("/")

def check_elevenlabs_key(api_key: str) -> dict:
    """Checks a key with a free call (the account info); never spends credits. Returns {"ok", "message"}."""
    import requests
    try:
        resp = requests.get(f"{elevenlabs_base()}/v1/user", headers={"xi-api-key": api_key}, timeout=20)
    except requests.RequestException:
        return {"ok": False, "message": "Sem conexão com o ElevenLabs."}
    if resp.status_code == 200:
        try:
            tier = (resp.json().get("subscription") or {}).get("tier")
        except ValueError:
            tier = None
        return {"ok": True, "message": "Conexão com o ElevenLabs funcionando." + (f" Plano: {tier}." if tier else "")}
    try:
        detail = resp.json().get("detail")
    except ValueError:
        detail = None
    status = detail.get("status") if isinstance(detail, dict) else None
    if status == "missing_permissions":  # a restricted key: it authenticated, it just cannot read the account
        return {"ok": True, "message": "A chave foi aceita, mas não tem permissão de ler a conta (normal em chaves restritas). "
                                       "Se ela foi criada com a permissão de Speech to Text, a transcrição funciona: confirme com um vídeo curto."}
    if resp.status_code == 429:
        return {"ok": True, "message": "O ElevenLabs pediu para esperar (limite de uso), o que mostra que a chave é válida."}
    if resp.status_code in (401, 403):
        return {"ok": False, "message": "O ElevenLabs recusou a chave (inválida ou revogada). Confira se copiou a chave inteira."}
    return {"ok": False, "message": f"O ElevenLabs respondeu com erro {resp.status_code}."}

def transcribe_with_whisper(audio_wav_path: Path, language: str | None = "pt") -> dict:
    """Transcribe audio using local OpenAI Whisper with word timestamps."""
    import whisper
    
    # Use "tiny" or "base" for high-speed responsiveness
    model = whisper.load_model("base")
    result = model.transcribe(
        str(audio_wav_path),
        word_timestamps=True,
        language=language if language != "auto" else None
    )
    
    words = []
    full_text_list = []
    
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            word_text = w.get("word", "").strip()
            if not word_text:
                continue
            words.append({
                "text": word_text,
                "start": round(float(w.get("start", 0.0)), 3),
                "end": round(float(w.get("end", 0.0)), 3),
                "type": "word",
                "speaker_id": "speaker_0"
            })
            full_text_list.append(word_text)
            
    return {
        "text": " ".join(full_text_list),
        "words": words,
        "language": result.get("language", language or "pt"),
        "engine": "whisper_local"
    }

def transcribe_with_elevenlabs(audio_wav_path: Path, api_key: str, language: str | None = None) -> dict:
    """Transcribe audio using ElevenLabs Scribe API."""
    import requests
    url = f"{elevenlabs_base()}/v1/speech-to-text"
    data = {
        "model_id": "scribe_v1",
        "diarize": "true",
        "tag_audio_events": "true",
        "timestamps_granularity": "word"
    }
    if language and language != "auto":
        data["language_code"] = language
        
    with open(audio_wav_path, "rb") as f:
        resp = requests.post(
            url,
            headers={"xi-api-key": api_key},
            files={"file": (audio_wav_path.name, f, "audio/wav")},
            data=data,
            timeout=1800
        )
    if resp.status_code != 200:
        raise RuntimeError(f"ElevenLabs Scribe error {resp.status_code}: {resp.text}")
    
    res_data = resp.json()
    res_data["engine"] = "elevenlabs_scribe"
    return res_data

def groq_base() -> str:
    # LLM_BASE_URL_GROQ points Groq (chat and Whisper) at a proxy or a local test server
    from backend import credentials
    return (os.environ.get("LLM_BASE_URL_GROQ") or credentials.PROVIDERS["groq"]["base_url"]).rstrip("/")


_PUNCT_AFTER = ".,!?;:…"


def _restore_punctuation(text: str, words: list[dict]) -> None:
    """Whisper's word list has no punctuation but its `text` has: put the marks that follow each word back on it, so
    the review can tell where sentences end (it also reads capital letters and marks to find retakes)."""
    pos = 0
    low = text.lower()
    for w in words:
        token = w["text"].lower()
        if not token:
            continue
        i = low.find(token, pos)
        if i < 0 or i - pos > 40:      # not found where expected: leave this word as it is
            continue
        end = i + len(token)
        j = end
        while j < len(text) and text[j] in _PUNCT_AFTER:
            j += 1
        if j > end:
            w["text"] += text[end:j]
        pos = j


def _wav_chunks(wav_path: Path, work: Path, chunk_s: float) -> list[tuple[Path, float]]:
    """[(wav file, its start in seconds)]: one file when the audio is short, else pieces cut at the quietest moment
    near each boundary (never in the middle of a word)."""
    import numpy as np
    with wave.open(str(wav_path), "rb") as w:
        rate, n, width, ch = w.getframerate(), w.getnframes(), w.getsampwidth(), w.getnchannels()
        if n / rate <= chunk_s * 1.25:
            return [(wav_path, 0.0)]
        raw = w.readframes(n)
    pcm = np.frombuffer(raw, dtype=np.int16).reshape(-1, ch)
    mono = np.abs(pcm[:, 0].astype(np.float32))
    hop = int(rate * 0.1)
    frames = mono[: len(mono) // hop * hop].reshape(-1, hop).mean(axis=1)
    cuts = [0]
    reach = min(20.0, chunk_s / 4)                    # how far from the ideal boundary a quieter moment is looked for
    while (n - cuts[-1]) / rate > chunk_s * 1.25:
        target = cuts[-1] + int(chunk_s * rate)
        lo = max(cuts[-1] // hop + int(chunk_s / 2 * 10), int((target - reach * rate) // hop))
        hi = min(len(frames) - 1, int((target + reach * rate) // hop))
        cuts.append(int((lo + int(np.argmin(frames[lo:hi + 1]))) * hop))
    cuts.append(n)
    out = []
    for k in range(len(cuts) - 1):
        part = work / f"chunk_{k:02d}.wav"
        with wave.open(str(part), "wb") as w:
            w.setnchannels(ch)
            w.setsampwidth(width)
            w.setframerate(rate)
            w.writeframes(pcm[cuts[k]:cuts[k + 1]].tobytes())
        out.append((part, cuts[k] / rate))
    return out


def _groq_request(path: Path, api_key: str, model: str, language: str | None) -> dict:
    import requests
    url = f"{groq_base()}/audio/transcriptions"
    data = [("model", model), ("response_format", "verbose_json"), ("timestamp_granularities[]", "word"), ("temperature", "0")]
    if language and language != "auto":
        data.append(("language", language))
    for attempt in range(1, 5):
        try:
            with open(path, "rb") as f:
                resp = requests.post(url, headers={"Authorization": f"Bearer {api_key}"}, files={"file": (path.name, f, "audio/wav")},
                                     data=data, timeout=600)
        except requests.RequestException as exc:
            if attempt < 3:
                time.sleep(2 * attempt)
                continue
            raise RuntimeError("Sem conexão com o Groq.") from exc
        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError as exc:
                raise RuntimeError("Resposta inesperada do Groq Whisper.") from exc
        if resp.status_code in (429, 500, 502, 503) and attempt < 4:
            try:
                wait = min(30.0, float(resp.headers.get("retry-after", 3 * attempt)))
            except ValueError:
                wait = 3.0 * attempt
            time.sleep(wait)
            continue
        try:
            err = resp.json().get("error")
            detail = err.get("message") if isinstance(err, dict) else str(err or "")
        except (ValueError, AttributeError):
            detail = resp.text[:200]
        if resp.status_code in (401, 403):
            raise RuntimeError("O Groq recusou a chave (inválida, revogada ou sem permissão). Confira em Configurações.")
        if resp.status_code == 413:
            raise RuntimeError("O áudio passou do limite de upload do Groq.")
        if resp.status_code == 429:
            raise RuntimeError(f"Limite de uso do Groq atingido. {detail}".strip())
        raise RuntimeError(f"Groq Whisper respondeu com erro {resp.status_code}. {detail}".strip())
    raise RuntimeError("O Groq não respondeu.")


def transcribe_with_groq(audio_wav_path: Path, api_key: str, language: str | None = "pt", model: str = "whisper-large-v3") -> dict:
    """Transcribe audio with Whisper on Groq (word timestamps). Same result shape as the other engines."""
    words: list[dict] = []
    texts: list[str] = []
    detected = None
    with tempfile.TemporaryDirectory() as td:
        for part, offset in _wav_chunks(audio_wav_path, Path(td), GROQ_CHUNK_S):
            data = _groq_request(part, api_key, model, language)
            detected = detected or data.get("language")
            chunk_words = []
            for w in data.get("words") or []:
                text = str(w.get("word", "")).strip()
                if not text or not isinstance(w.get("start"), (int, float)) or not isinstance(w.get("end"), (int, float)):
                    continue
                chunk_words.append({"text": text, "start": round(float(w["start"]) + offset, 3), "end": round(float(w["end"]) + offset, 3),
                                    "type": "word", "speaker_id": "speaker_0"})
            _restore_punctuation(str(data.get("text") or ""), chunk_words)
            words += chunk_words
            texts.append(str(data.get("text") or "").strip())
    if not words:
        raise RuntimeError("O Groq não devolveu nenhuma palavra (o áudio está mudo ou o idioma está errado?).")
    return {"text": " ".join(t for t in texts if t), "words": words, "language": detected or language or "pt",
            "engine": "groq_whisper", "model": model}


def fallback_pseudo_transcript(video_path: Path, duration: float) -> dict:
    """Fallback transcript generator based on time chunks when no AI model is loaded."""
    words = []
    num_chunks = max(1, int(duration // 2.5))
    step = duration / num_chunks
    
    for i in range(num_chunks):
        s = round(i * step, 2)
        e = round(min(duration, (i + 1) * step), 2)
        words.append({
            "text": f"Clip {i+1}",
            "start": s,
            "end": e,
            "type": "word",
            "speaker_id": "speaker_0"
        })
        
    return {
        "text": " ".join(w["text"] for w in words),
        "words": words,
        "engine": "fallback"
    }

def transcribe_video(video_path: Path, output_json_path: Path, preferred_engine: str = "auto", language: str = "pt") -> dict:
    """Transcribe video and save JSON result in standard Video-Use format.

    The audio is extracted on the VIDEO's clock (audio_timeline: the start is padded when the audio begins after the
    picture), so every word time is a time of the video and cuts made from it land where the speech really is.
    `result["notes"]` says what happened when the chosen engine could not be used."""
    from backend import credentials

    output_json_path.parent.mkdir(parents=True, exist_ok=True)
    engine = preferred_engine if preferred_engine in ENGINES else "auto"

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = Path(tmp.name)

    try:
        # Extract audio to 16kHz mono PCM wav
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vn", *audio_timeline.filter_args(video_path), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
            str(wav_path)
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        notes: list[str] = []
        res = None

        eleven_key = get_elevenlabs_api_key()
        if engine in ("elevenlabs", "auto") and eleven_key:
            try:
                res = transcribe_with_elevenlabs(wav_path, eleven_key, language=language)
            except Exception as e:
                print(f"[Transcriber] ElevenLabs failed ({e}), trying the next engine...")
                notes.append(f"ElevenLabs falhou ({str(e)[:160]}).")
        elif engine == "elevenlabs":
            notes.append("Sem chave do ElevenLabs em Configurações.")

        groq_key = credentials.get_key("groq")
        if not res and engine in ("groq", "groq_turbo", "auto") and groq_key:
            model = GROQ_MODELS["groq_turbo" if engine == "groq_turbo" else "groq"]
            try:
                res = transcribe_with_groq(wav_path, groq_key, language=language, model=model)
            except Exception as e:
                print(f"[Transcriber] Groq Whisper failed ({e}), trying the next engine...")
                notes.append(f"Groq Whisper falhou ({str(e)[:160]}).")
        elif not res and engine in ("groq", "groq_turbo"):
            notes.append("Sem chave do Groq em Configurações.")

        if not res:
            if has_whisper_available():
                try:
                    res = transcribe_with_whisper(wav_path, language=language)
                    if notes:
                        notes.append("Usei o Whisper deste computador no lugar.")
                except Exception as e:
                    print(f"[Transcriber] Whisper failed ({e}), trying fallback...")
                    notes.append(f"Whisper local falhou ({str(e)[:160]}).")
            elif notes:
                notes.append("O Whisper local não está instalado.")

        if not res:
            # Fallback
            from backend.media_processor import probe_media
            meta = probe_media(video_path)
            res = fallback_pseudo_transcript(video_path, meta["duration"])

        if res.get("engine") != "fallback":
            audio_timeline.align_words(res, 0.0)   # the audio was padded: the words are already on the video's clock
            res["audio_lead_in_s"] = round(audio_timeline.lead_in(video_path), 3)
        if notes:
            res["notes"] = notes
        output_json_path.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
        return res
    finally:
        wav_path.unlink(missing_ok=True)
