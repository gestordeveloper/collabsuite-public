from __future__ import annotations
import json
import os
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.version import VERSION
from backend.config import (
    URL_BASE,
    BASE_DIR,
    FRONTEND_DIR,
    PROJECTS_DIR,
    UPLOADS_DIR,
    ensure_ffmpeg,
    ensure_node,
    get_elevenlabs_api_key,
    has_whisper_available,
)
from backend.media_processor import (
    auto_cut_silences,
    browser_playable_copy,
    detect_silences,
    extract_waveform,
    generate_thumbnails,
    probe_media,
    thumbnail_count,
    waveform_sample_count,
)
from backend import highlight_service, projects, queue_service, review_service
from backend.fonts import FontUnavailable, ensure_font, get_catalog
from backend.render_service import JOBS, build_edl, start_render
from backend.routes import router as workspace_router
from backend.routes_highlights import router as highlights_router
from backend.routes_looks import router as looks_router
from backend.routes_transitions import router as transitions_router
from backend.routes_media import router as media_router
from backend.routes_motion import router as motion_router
from backend.routes_music import router as music_router
from backend.routes_settings import router as settings_router
from backend.routes_track import router as track_router
from backend.routes_premiere import router as premiere_router
from backend.templates import get_template_catalog
from backend import audio_timeline
from backend.transcriber import transcribe_video
from backend.ai_editor import analyze_transcript_locally
from backend.cut_refine import load_speech_map
from backend.transcript_review import apply_fixes, build_clips

ensure_ffmpeg()
ensure_node()

app = FastAPI(title="StudioX API", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_cache_frontend(request: Request, call_next):
    """The frontend is plain static files edited constantly during development: force the browser
    to always revalidate instead of trusting its own heuristic freshness window (which has caused
    a stale editor.html/js/css to survive a normal refresh)."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response

# Saved projects, edit templates and the editing queue (backend/routes.py)
app.include_router(workspace_router)
app.include_router(settings_router)
app.include_router(media_router)
app.include_router(music_router)
app.include_router(looks_router)
app.include_router(transitions_router)
app.include_router(highlights_router)
app.include_router(motion_router)
app.include_router(track_router)
app.include_router(premiere_router)


@app.on_event("startup")
def _start_queue_worker() -> None:
    highlight_service.recover()
    queue_service.start_worker()

# Models
class RenderRequest(BaseModel):
    project_id: str
    ranges: list[dict[str, Any]]
    grade: str = "warm_cinematic"
    subtitle_template_id: str | None = "tiktok_bold"
    subtitle_style: dict[str, Any] | None = None
    enable_subtitles: bool = True
    headline: dict[str, Any] | None = None
    transition_id: str = "micro_fade_30ms"
    is_preview: bool = False
    grade_adjust: dict[str, Any] | None = None   # fine adjustments on top of `grade`
    split: dict[str, Any] | None = None          # split screen (see backend/split_screen.py)
    music: dict[str, Any] | None = None          # background music layers (see backend/music_mix.py)
    lut: dict[str, Any] | None = None            # {"id", "intensity"} (see backend/luts.py)
    zoom: dict[str, Any] | None = None           # zoom on the cuts (see backend/looks.py)
    transition_scale: float = 1.0                # stretches the transition's effects (backend/transitions.py)
    transition_sound: dict[str, Any] | None = None   # the sound every cut plays by default (backend/sfx.py)
    cut_transitions: dict[str, Any] | None = None    # transition / sound chosen for single cuts (transitions.cut_key)
    canvas: dict[str, Any] | None = None          # aspect ratio + scale/position/rotation (backend/canvas.py)
    motion: dict[str, Any] | None = None          # motion graphics via Remotion (see backend/motion_graphics.py)
    track: dict[str, Any] | None = None           # follow-the-face camera (see backend/face_track.py)

class AIAnalyzeRequest(BaseModel):
    provider: str = "local"          # local | auto | groq | openai | openrouter | anthropic (keys come from Configurações)
    model: str | None = None         # empty = the provider's saved model
    language: str = "pt"
    instructions: str | None = None  # extra for this run; the standing ones (Configurações) are always added
    copy_text: str | None = None     # the script the person was reading; None = the one saved with the project
    strict_copy: bool | None = None  # cut speech that is not in the copy; None = the saved choice (default: yes)


class AIApplyRequest(BaseModel):
    cut_indices: list[int] = []      # word indices (of the analysis) that the editor decided to cut
    fixes: list[dict[str, Any]] = [] # accepted word corrections {index, from, to}

@app.get("/api/status")
def get_system_status():
    ffmpeg_ok = bool(shutil.which("ffmpeg"))
    ffprobe_ok = bool(shutil.which("ffprobe"))
    eleven_key = bool(get_elevenlabs_api_key())
    whisper_ok = has_whisper_available()
    
    return {
        "status": "online",
        "ffmpeg": ffmpeg_ok,
        "ffprobe": ffprobe_ok,
        "has_elevenlabs_key": eleven_key,
        "has_whisper": whisper_ok,
        "active_jobs": len(JOBS)
    }

@app.get("/api/templates")
def list_templates():
    return get_template_catalog()

@app.get("/api/fonts")
def list_fonts(refresh: bool = False):
    """All Google Fonts families (compact form) for the subtitle font picker."""
    return get_catalog(force=refresh)

@app.get("/api/fonts/resolve")
def resolve_font(family: str, weight: int = 400, italic: bool = False):
    """Downloads (once) the TTF the render will use and reports how it maps to the preview."""
    try:
        font = ensure_font(family, weight, italic)
    except FontUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {
        "family": family,
        "ass_name": font.ass_name,
        "cell_factor": round(font.cell_factor, 4),
        "ascent_factor": round(font.ascent_factor, 4),
    }

@app.post("/api/demo-clip")
def generate_demo_clip():
    project_id = f"demo_{uuid.uuid4().hex[:6]}"
    project_dir = PROJECTS_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    
    clean_filename = "demo_take.mp4"
    video_dest = project_dir / clean_filename
    
    # Generate 12-second test video with alternating speech tones and silences
    # 0-3s tone, 3-4.5s silence, 4.5-8s tone, 8-9.5s silence, 9.5-12s tone
    audio_filter = "sine=frequency=480:duration=12:sample_rate=48000,volume='if(between(t,3,4.5)+between(t,8,9.5), 0, 0.4)':eval=frame"
    video_filter = "testsrc=duration=12:size=1280x720:rate=30,drawtext=text='STUDIOX DEMO TAKE':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=100,drawtext=text='TIME\\: %{pts\\:hms}':fontsize=28:fontcolor=yellow:x=(w-text_w)/2:y=160"
    
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", video_filter,
        "-f", "lavfi", "-i", audio_filter,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(video_dest)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    meta = probe_media(video_dest)
    waveform = extract_waveform(video_dest, num_samples=waveform_sample_count(meta["duration"]))
    thumbs_dir = project_dir / "thumbs"
    thumbs = generate_thumbnails(video_dest, thumbs_dir, count=thumbnail_count(meta["duration"]), duration=meta["duration"])
    initial_cuts = auto_cut_silences(video_dest)
    
    # Create synthetic mock transcript for the demo
    transcripts_dir = project_dir / "edit" / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    demo_transcript = {
        "text": "Bem vindo ao StudioX. Esta é a primeira parte. Agora cortamos o silêncio. E finalizamos com alta qualidade.",
        "words": [
            {"text": "BEM", "start": 0.2, "end": 0.6, "type": "word"},
            {"text": "VINDO", "start": 0.7, "end": 1.2, "type": "word"},
            {"text": "AO", "start": 1.3, "end": 1.6, "type": "word"},
            {"text": "STUDIOX", "start": 1.7, "end": 2.8, "type": "word"},
            {"text": "ESTA", "start": 4.6, "end": 5.0, "type": "word"},
            {"text": "É", "start": 5.1, "end": 5.3, "type": "word"},
            {"text": "A", "start": 5.4, "end": 5.6, "type": "word"},
            {"text": "SEGUNDA", "start": 5.7, "end": 6.3, "type": "word"},
            {"text": "PARTE", "start": 6.4, "end": 7.0, "type": "word"},
            {"text": "AGORA", "start": 9.6, "end": 10.1, "type": "word"},
            {"text": "FINALIZAMOS", "start": 10.2, "end": 10.9, "type": "word"},
            {"text": "COM", "start": 11.0, "end": 11.3, "type": "word"},
            {"text": "SUCESSO", "start": 11.4, "end": 11.9, "type": "word"}
        ]
    }
    (transcripts_dir / f"{clean_filename}.json").write_text(json.dumps(demo_transcript, indent=2), encoding="utf-8")
    
    project_info = {
        "id": project_id,
        "source_name": clean_filename,
        "timeline": audio_timeline.VERSION,
        "meta": meta,
        "waveform": waveform,
        "thumbnails": thumbs,
        "initial_cuts": initial_cuts,
        "video_url": f"{URL_BASE}/api/projects/{project_id}/video/{clean_filename}"
    }
    
    (project_dir / "project_info.json").write_text(json.dumps(project_info), encoding="utf-8")
    return project_info

ANALYSIS: dict[str, dict[str, Any]] = {}   # project_id -> {"done": bool, "error": str | None}


def _analyze_upload(project_id: str, video: Path, info: dict) -> None:
    """Waveform, thumbnails and silence cuts of a fresh upload. Runs in the background: doing it before answering
    the upload took minutes on long videos, and the proxy in front of the app cut the request off (502)."""
    try:
        meta = info["meta"]
        info["waveform"] = extract_waveform(video, num_samples=waveform_sample_count(meta["duration"]))
        info["thumbnails"] = generate_thumbnails(video, video.parent / "thumbs", count=thumbnail_count(meta["duration"]), duration=meta["duration"])
        info["initial_cuts"] = auto_cut_silences(video)
        info["analyzed"] = True
        projects.write_info(project_id, info)
        ANALYSIS[project_id] = {"done": True, "error": None}
    except Exception as exc:
        ANALYSIS[project_id] = {"done": True, "error": f"Erro ao analisar o vídeo: {exc}"}


@app.post("/api/upload")
def upload_video(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inválido")

    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    project_dir = PROJECTS_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    clean_filename = "source_" + file.filename.replace(" ", "_")
    video_dest = project_dir / clean_filename

    with open(video_dest, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # H.264 copy for the preview (phone HEVC): start now so it is made while the analysis runs
    threading.Thread(target=browser_playable_copy, args=(video_dest,), daemon=True).start()

    try:
        meta = probe_media(video_dest)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao analisar vídeo com FFprobe: {e}")

    project_info = {
        "id": project_id,
        "source_name": clean_filename,
        "timeline": audio_timeline.VERSION,
        "meta": meta,
        "waveform": [],
        "thumbnails": [],
        "initial_cuts": [{"source": clean_filename, "start": 0.0, "end": meta["duration"], "beat": "CLIP 1", "quote": "Full Take"}],
        "analyzed": False,
        "video_url": f"{URL_BASE}/api/projects/{project_id}/video/{clean_filename}"
    }
    projects.write_info(project_id, project_info)
    ANALYSIS[project_id] = {"done": False, "error": None}
    threading.Thread(target=_analyze_upload, args=(project_id, video_dest, dict(project_info)), daemon=True).start()
    return project_info


@app.get("/api/projects/{project_id}/analysis")
def upload_analysis(project_id: str):
    """Polled by the editor after an upload until the background analysis is done."""
    status = ANALYSIS.get(project_id)
    if status is None:   # server restarted: the info file says whether it finished
        try:
            return {"done": True, "error": None if projects.read_info(project_id).get("analyzed") is not False else "A análise foi interrompida. Envie o vídeo de novo."}
        except Exception:
            raise HTTPException(status_code=404, detail="Projeto não encontrado")
    return status

@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    project_dir = PROJECTS_DIR / project_id
    info_path = project_dir / "project_info.json"
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    info = json.loads(info_path.read_text(encoding="utf-8"))
    state = projects.read_state(project_id)
    info = audio_timeline.migrate_project(project_dir, info, state)
    # The saved editing state travels with the project so the editor can pick up where it stopped
    info["state"] = {"edit": state.get("edit"), "name": state.get("name"), "render": state.get("render"),
                     "copy": (state.get("copy") or {}).get("text", ""),
                     "strict_copy": bool((state.get("copy") or {}).get("strict", True)),
                     "queue_status": (state.get("queue") or {}).get("status"), "saved_at": state.get("updated_at")}
    info["display_name"] = projects.display_name(info, state)
    return info

@app.post("/api/projects/{project_id}/transcribe")
def run_transcription(project_id: str, engine: str = Form("auto"), language: str = Form("pt")):
    project_dir = PROJECTS_DIR / project_id
    info_path = project_dir / "project_info.json"
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
        
    info = json.loads(info_path.read_text(encoding="utf-8"))
    source_name = info["source_name"]
    video_path = project_dir / source_name
    
    transcripts_dir = project_dir / "edit" / "transcripts"
    tr_path = transcripts_dir / f"{source_name}.json"
    
    result = transcribe_video(video_path, tr_path, preferred_engine=engine, language=language)
    return result

@app.post("/api/projects/{project_id}/detect-silence")
def detect_silence_endpoint(project_id: str):
    project_dir = PROJECTS_DIR / project_id
    info_path = project_dir / "project_info.json"
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
        
    info = json.loads(info_path.read_text(encoding="utf-8"))
    video_path = project_dir / info["source_name"]
    silences = detect_silences(video_path)
    cuts = auto_cut_silences(video_path)
    return {"silences": silences, "cuts": cuts}

def _transcript_words(project_id: str, info: dict, language: str) -> tuple[Path, list[dict]]:
    project_dir = PROJECTS_DIR / project_id
    tr_path = project_dir / "edit" / "transcripts" / f"{info['source_name']}.json"
    if not tr_path.exists():  # not transcribed yet: transcribe first
        tr_data = transcribe_video(project_dir / info["source_name"], tr_path, preferred_engine="auto", language=language)
    else:  # one made before the audio/video clocks were aligned is moved onto the video's clock here
        tr_data = audio_timeline.ensure_transcript(tr_path, project_dir / info["source_name"]) or {}
    return tr_path, tr_data.get("words", [])


@app.post("/api/projects/{project_id}/ai-analyze")
def ai_analyze_endpoint(project_id: str, req: AIAnalyzeRequest):
    """Reviews the transcript (rules or an AI provider): cuts for recording errors + word corrections."""
    project_dir = PROJECTS_DIR / project_id
    info_path = project_dir / "project_info.json"
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    info = json.loads(info_path.read_text(encoding="utf-8"))
    _tr_path, words = _transcript_words(project_id, info, req.language)

    saved = projects.read_state(project_id).get("copy") or {}
    copy_text = review_service.clean_copy(req.copy_text if req.copy_text is not None else saved.get("text"))
    strict = bool(req.strict_copy) if req.strict_copy is not None else bool(saved.get("strict", True))
    if req.copy_text is not None or req.strict_copy is not None:  # what was analysed is what gets remembered
        projects.update_state(project_id, lambda st: st.__setitem__("copy", {"text": copy_text, "strict": strict}))

    # the same call the queue makes (review_service), so a video is cut the same way wherever it is started
    mode = "local" if req.provider == "local" else ("auto" if req.provider == "auto" else "llm")
    provider = None if req.provider in ("local", "auto") else req.provider
    result = review_service.review_words(
        words,
        mode=review_service.effective_mode(mode, provider, bool(copy_text)),
        provider=provider,
        model=req.model,
        language=req.language,
        copy=copy_text,
        strict_copy=strict,
        instructions=req.instructions,
        video_path=project_dir / info["source_name"],
        duration=float((info.get("meta") or {}).get("duration") or 0) or None,
    )
    for c in result.get("recommended_cuts", []):
        c["source"] = info["source_name"]
    return result


@app.post("/api/projects/{project_id}/ai-apply")
def ai_apply_endpoint(project_id: str, req: AIApplyRequest):
    """Rebuilds the cuts from the words the editor decided to cut (edges refined on the audio) and
    writes the accepted word corrections into the saved transcript."""
    project_dir = PROJECTS_DIR / project_id
    info_path = project_dir / "project_info.json"
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    info = json.loads(info_path.read_text(encoding="utf-8"))
    tr_path, words = _transcript_words(project_id, info, "pt")
    word_status = analyze_transcript_locally(words)["word_diff"]  # same numbering as the analysis
    cut = set(req.cut_indices)
    for w in word_status:
        w["status"] = "cut" if w["index"] in cut else "kept"
    duration = float((info.get("meta") or {}).get("duration") or 0) or None
    clips = build_clips(word_status, duration or (words[-1]["end"] if words else 0.0),
                        load_speech_map(project_dir / info["source_name"]))
    for c in clips:
        c["source"] = info["source_name"]
    fixed = apply_fixes(tr_path, word_status, req.fixes) if req.fixes else 0
    projects.update_state(project_id, lambda st: st.__setitem__("cuts_timeline", audio_timeline.VERSION))
    return {"cuts": clips, "fixes_applied": fixed}

@app.post("/api/render")
def trigger_render(req: RenderRequest):
    project_dir = PROJECTS_DIR / req.project_id
    info_path = project_dir / "project_info.json"
    if not info_path.exists():
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
        
    info = json.loads(info_path.read_text(encoding="utf-8"))
    edl_data = build_edl(project_dir, info, req.ranges, req.grade, req.enable_subtitles)

    # Subtitle style: the editor's custom style wins; otherwise fall back to the chosen preset
    sub_style = req.subtitle_style
    if not sub_style:
        catalog = get_template_catalog()
        sub_tpl = next((t for t in catalog["subtitles"] if t["id"] == req.subtitle_template_id), catalog["subtitles"][0])
        sub_style = sub_tpl["style"]

    job_id = start_render(
        project_dir=project_dir,
        edl_data=edl_data,
        subtitle_style=sub_style,
        enable_subtitles=req.enable_subtitles,
        headline_config=req.headline,
        is_preview=req.is_preview,
        post={"grade": req.grade, "grade_adjust": req.grade_adjust, "split": req.split, "music": req.music, "lut": req.lut,
              "zoom": req.zoom, "transition": req.transition_id, "transition_scale": req.transition_scale,
              "transition_sound": req.transition_sound, "cut_transitions": req.cut_transitions,
              "canvas": req.canvas, "motion": req.motion, "track": req.track},
    )
    
    return {"job_id": job_id, "status": "started"}

@app.get("/api/render/{job_id}/status")
def get_render_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    return JOBS[job_id]

# File serving endpoints
@app.get("/api/projects/{project_id}/video/{filename}")
def serve_video(project_id: str, filename: str):
    project_dir = PROJECTS_DIR / project_id
    # check in root or edit
    candidates = [
        project_dir / filename,
        project_dir / "edit" / filename
    ]
    for c in candidates:
        if c.exists():
            playable = browser_playable_copy(c, wait=False)
            if playable is None:   # H.264 copy still being made: the player asks again in a moment
                raise HTTPException(status_code=503, detail="Preparando a prévia do vídeo", headers={"Retry-After": "2"})
            return FileResponse(playable, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="Vídeo não encontrado")


@app.get("/api/projects/{project_id}/thumbs/{filename}")
def serve_thumb(project_id: str, filename: str):
    thumb_path = PROJECTS_DIR / project_id / "thumbs" / filename
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail não encontrada")
    return FileResponse(thumb_path, media_type="image/jpeg")

@app.get("/api/projects/{project_id}/download/final")
def download_final(project_id: str):
    # Always the file the LAST render actually wrote: a "Prévia (mais rápido)" render writes
    # preview.mp4, not final.mp4, and downloading a stale/missing final.mp4 instead would silently
    # hand back an older render (or 404) that doesn't have whatever was just changed (aspect ratio,
    # grade, cuts...). See backend/projects.py::record_render.
    try:
        last = (projects.read_state(project_id).get("render") or {}).get("last") or {}
    except projects.ProjectNotFound:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    video_path = PROJECTS_DIR / project_id / "edit" / (last.get("file") or "final.mp4")
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Vídeo final ainda não renderizado")
    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=f"studiox_{project_id}.mp4"
    )

@app.get("/api/projects/{project_id}/download/edl")
def download_edl(project_id: str):
    edl_path = PROJECTS_DIR / project_id / "edit" / "edl.json"
    if not edl_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo edl.json não encontrado")
    return FileResponse(
        edl_path,
        media_type="application/json",
        filename=f"edl_{project_id}.json"
    )

# Mount frontend static files
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
