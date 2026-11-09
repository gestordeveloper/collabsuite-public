from __future__ import annotations
import json
import math
import subprocess
import threading
import tempfile
import wave
import array
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from backend.config import ensure_ffmpeg
from backend import audio_timeline

try:
    import numpy as np
except ImportError:  # pure-python fallback below
    np = None

ensure_ffmpeg()

def probe_media(video_path: Path) -> dict:
    """Extract metadata using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,channels,sample_rate",
        "-of", "json",
        str(video_path)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(res.stdout)
    
    fmt = data.get("format", {})
    streams = data.get("streams", [])
    
    duration = float(fmt.get("duration", 0.0))
    size_mb = round(float(fmt.get("size", 0)) / (1024 * 1024), 2)
    
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    
    width = int(video_stream.get("width", 0)) if video_stream else 0
    height = int(video_stream.get("height", 0)) if video_stream else 0
    
    fps = 30.0
    if video_stream and "avg_frame_rate" in video_stream:
        r = video_stream["avg_frame_rate"]
        if "/" in r:
            num, den = r.split("/")
            if float(den) > 0:
                fps = round(float(num) / float(den), 2)
        else:
            try:
                fps = float(r)
            except ValueError:
                pass
                
    has_audio = audio_stream is not None
    channels = int(audio_stream.get("channels", 0)) if audio_stream else 0
    sample_rate = int(audio_stream.get("sample_rate", 0)) if audio_stream else 0
    
    return {
        "filename": video_path.name,
        "path": str(video_path),
        "duration": duration,
        "size_mb": size_mb,
        "width": width,
        "height": height,
        "aspect": f"{width}:{height}",
        "is_portrait": height > width,
        "fps": fps,
        "has_audio": has_audio,
        "channels": channels,
        "sample_rate": sample_rate
    }

def probe_display_size(video_path: Path) -> tuple[int, int]:
    """Width/height as the video is DISPLAYED: phone clips store 1920x1080 plus a 90° rotation flag."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:stream_side_data=rotation",
        "-of", "json", str(video_path),
    ]
    data = json.loads(subprocess.run(cmd, capture_output=True, text=True, check=True).stdout)
    stream = (data.get("streams") or [{}])[0]
    width, height = int(stream.get("width", 0)), int(stream.get("height", 0))
    rotation = 0
    for side in stream.get("side_data_list", []):
        if side.get("rotation") is not None:
            rotation = int(round(float(side["rotation"])))
    if rotation % 360 in (90, 270):
        width, height = height, width
    return width, height


def render_size(display_w: int, display_h: int) -> tuple[int, int]:
    """Frame size render.py produces: the long side is scaled to 1920, the short one stays even."""
    if display_w <= 0 or display_h <= 0:
        return 1920, 1080
    even = lambda n: max(2, int(round(n / 2)) * 2)
    if display_h > display_w:
        return even(1920 * display_w / display_h), 1920
    return 1920, even(1920 * display_h / display_w)


def waveform_sample_count(duration: float) -> int:
    """Waveform resolution scaled to the video: ~20 samples/s, so long videos stay detailed."""
    return int(min(60000, max(600, duration * 20)))


def thumbnail_count(duration: float) -> int:
    """Filmstrip density scaled to the video: one frame every ~3s, capped for very long files."""
    return int(min(240, max(24, math.ceil(duration / 3))))


def _rms_envelope(raw_data: bytes, num_samples: int) -> list[float]:
    """Block RMS of 16-bit mono PCM, boosted and clipped to 0..1."""
    if np is not None:
        data = np.frombuffer(raw_data, dtype=np.int16)
        total = data.size
        block = max(1, total // num_samples)
        n_blocks = min(num_samples, total // block)
        if n_blocks == 0:
            return [0.0] * num_samples
        chunks = data[: n_blocks * block].astype(np.float32).reshape(n_blocks, block)
        np.multiply(chunks, chunks, out=chunks)
        rms = np.sqrt(chunks.mean(axis=1)) / 32768.0
        env = np.minimum(1.0, rms * 3.5)  # Slight boost for clear visual dynamics
        out = [round(float(v), 3) for v in env]
        return out + [0.0] * (num_samples - len(out))

    samples = array.array("h", raw_data)
    total = len(samples)
    block_size = max(1, total // num_samples)
    envelope = []
    for i in range(num_samples):
        start = i * block_size
        end = min(start + block_size, total)
        if start >= total:
            envelope.append(0.0)
            continue
        chunk = samples[start:end]
        if not chunk:
            envelope.append(0.0)
            continue
        sq_sum = sum(s * s for s in chunk)
        rms = math.sqrt(sq_sum / len(chunk)) / 32768.0
        envelope.append(round(min(1.0, rms * 3.5), 3))
    return envelope


def extract_waveform(video_path: Path, num_samples: int = 800) -> list[float]:
    """Generate normalized RMS waveform envelope samples (0.0 to 1.0)."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav_path = Path(f.name)
    try:
        # Extract mono 8kHz audio (plenty for an amplitude envelope, half the memory of 16kHz)
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vn", *audio_timeline.filter_args(video_path), "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le",
            str(wav_path)
        ]
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode != 0 or not wav_path.exists() or wav_path.stat().st_size == 0:
            return [0.0] * num_samples

        with wave.open(str(wav_path), "rb") as w:
            n_frames = w.getnframes()
            if n_frames == 0:
                return [0.0] * num_samples
            raw_data = w.readframes(n_frames)

        if not raw_data:
            return [0.0] * num_samples
        return _rms_envelope(raw_data, num_samples)
    finally:
        wav_path.unlink(missing_ok=True)

def generate_thumbnails(video_path: Path, dest_dir: Path, count: int = 20, duration: float | None = None) -> list[dict]:
    """Generate thumbnail filmstrip frames for the video timeline."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    if duration is None:
        duration = probe_media(video_path)["duration"]

    if duration <= 0:
        return []

    step = duration / max(1, count)

    def make(i: int) -> dict | None:
        t = round(i * step, 3)
        thumb_name = f"thumb_{i:03d}.jpg"
        out_path = dest_dir / thumb_name

        if not out_path.exists():
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{t:.3f}",
                "-i", str(video_path),
                "-frames:v", "1",
                "-an", "-sn",
                "-q:v", "5",
                "-vf", "scale=160:-2",
                str(out_path)
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        if out_path.exists():
            return {"index": i, "time": t, "filename": thumb_name}
        return None

    # Each frame is an independent fast-seek: run a few in parallel
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(make, range(count)))

    return [r for r in results if r]

def detect_silences(video_path: Path, noise_db: float = -32.0, min_duration: float = 0.45) -> list[dict]:
    """Detect silence/gap regions in the video using ffmpeg silencedetect."""
    cmd = [
        "ffmpeg", "-i", str(video_path),
        "-af", f"silencedetect=noise={noise_db}dB:d={min_duration}",
        "-vn", "-f", "null", "-"
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    stderr = proc.stderr
    
    silences = []
    current_start = None
    
    for line in stderr.splitlines():
        if "silence_start:" in line:
            parts = line.split("silence_start:")
            try:
                current_start = float(parts[1].strip().split()[0])
            except (ValueError, IndexError):
                pass
        elif "silence_end:" in line and current_start is not None:
            parts = line.split("silence_end:")
            try:
                end_str = parts[1].strip().split()[0]
                end_val = float(end_str)
                dur = round(end_val - current_start, 3)
                silences.append({
                    "start": round(current_start, 3),
                    "end": round(end_val, 3),
                    "duration": dur
                })
            except (ValueError, IndexError):
                pass
            current_start = None
            
    return silences

def _silences_from_speech_map(video_path: Path, total_dur: float, min_duration: float = 0.45) -> list[dict] | None:
    """Silences between the islands of real speech. The threshold adapts to the file's own noise floor and the
    islands include the soft tail of each word, so quiet sentence endings are not mistaken for silence (the fixed
    -32 dB of silencedetect cut them). None when the audio cannot be analysed."""
    from backend.cut_refine import load_speech_map
    sm = load_speech_map(video_path)
    if sm is None:
        return None
    silences: list[dict] = []
    prev_end = 0.0
    for s, e in zip(sm.starts, sm.ends):
        if float(s) - prev_end >= min_duration:
            silences.append({"start": round(prev_end, 3), "end": round(float(s), 3),
                             "duration": round(float(s) - prev_end, 3)})
        prev_end = float(e)
    if total_dur - prev_end >= min_duration:
        silences.append({"start": round(prev_end, 3), "end": round(total_dur, 3),
                         "duration": round(total_dur - prev_end, 3)})
    return silences


def auto_cut_silences(video_path: Path, pad_start: float = 0.07, pad_end: float = 0.12) -> list[dict]:
    """Invert silence intervals to produce speech ranges with video-use padding rules."""
    meta = probe_media(video_path)
    total_dur = meta["duration"]
    silences = _silences_from_speech_map(video_path, total_dur)
    if silences is None:
        silences = detect_silences(video_path)

    if not silences:
        return [{
            "source": video_path.name,
            "start": 0.0,
            "end": total_dur,
            "beat": "CLIP 1",
            "quote": "Full Take"
        }]
        
    cuts = []
    cur_time = 0.0
    clip_idx = 1
    
    for s in silences:
        # Range before silence
        seg_start = cur_time
        seg_end = s["start"] + pad_end
        if seg_end > total_dur:
            seg_end = total_dur
            
        # Only keep if longer than 0.25 seconds
        if seg_end - seg_start >= 0.25:
            cuts.append({
                "source": video_path.name,
                "start": round(max(0.0, seg_start), 3),
                "end": round(seg_end, 3),
                "beat": f"BEAT {clip_idx}",
                "quote": f"Speech section {clip_idx}"
            })
            clip_idx += 1
            
        cur_time = max(0.0, s["end"] - pad_start)
        
    if total_dur - cur_time >= 0.25:
        cuts.append({
            "source": video_path.name,
            "start": round(cur_time, 3),
            "end": round(total_dur, 3),
            "beat": f"BEAT {clip_idx}",
            "quote": f"Speech section {clip_idx}"
        })
        
    return cuts


_PROXY_LOCK = threading.Lock()


def browser_playable_copy(video: Path, wait: bool = True) -> Path | None:
    """The preview <video> can only show what the browser decodes (H.264). Phones record HEVC, which
    plays as a black frame: serve an H.264 copy for the preview. Render keeps reading the original."""
    if video.name.startswith("proxy_"):
        return video
    proxy = video.with_name("proxy_" + video.stem + ".mp4")
    if proxy.exists() and proxy.stat().st_mtime >= video.stat().st_mtime:
        return proxy
    try:
        res = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                              "stream=codec_name,pix_fmt", "-of", "csv=p=0", str(video)],
                             capture_output=True, text=True, timeout=30)
        codec, _, pix = res.stdout.strip().partition(",")
    except Exception:
        return video
    if codec in ("", "h264") and pix.strip() in ("", "yuv420p"):
        return video
    if not wait and _PROXY_LOCK.locked():
        return None
    if not wait:
        threading.Thread(target=browser_playable_copy, args=(video,), daemon=True).start()
        return None
    with _PROXY_LOCK:
        if proxy.exists() and proxy.stat().st_mtime >= video.stat().st_mtime:
            return proxy
        tmp = proxy.with_name(proxy.stem + ".part.mp4")
        cmd = ["ffmpeg", "-y", "-i", str(video), "-map", "0:v:0", "-map", "0:a:0?",
               "-vf", "scale='min(1280,iw)':-2:flags=fast_bilinear,format=yuv420p",
               "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-g", "15",
               "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(tmp)]
        done = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if done.returncode != 0 or not tmp.exists():
            tmp.unlink(missing_ok=True)
            return video
        tmp.replace(proxy)
    return proxy
