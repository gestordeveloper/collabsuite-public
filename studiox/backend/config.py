from __future__ import annotations
import os
import shutil
import sys
from pathlib import Path

# Packaged build (PyInstaller, see build.ps1): the code lives inside the exe's _internal folder, while
# frontend/, video-use/helpers, motion/ and bin/ (ffmpeg, node) sit next to the exe.
FROZEN = bool(getattr(sys, "frozen", False))

# Paths
BASE_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent.parent
BUNDLED_BIN_DIR = BASE_DIR / "bin"


def _default_storage_dir() -> Path:
    """Next to the code when running from source. Installed, the app folder may be read-only and is wiped
    by an update, so the user's videos/projects/credentials go to %LOCALAPPDATA%/StudioX instead."""
    if FROZEN:
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "StudioX" / "storage"
    return BASE_DIR / "storage"

VIDEO_USE_DIR = BASE_DIR / "video-use"
HELPERS_DIR = VIDEO_USE_DIR / "helpers"
# VIDEOUSE_STORAGE_DIR moves ALL data (projects, queue, templates, credentials) elsewhere: test servers
# must use it, or they share (and can change) the data of the real server.
STORAGE_DIR = Path(os.environ["VIDEOUSE_STORAGE_DIR"]).resolve() if os.environ.get("VIDEOUSE_STORAGE_DIR") else _default_storage_dir()
UPLOADS_DIR = STORAGE_DIR / "uploads"
PROJECTS_DIR = STORAGE_DIR / "projects"
MUSIC_DIR = STORAGE_DIR / "music"   # the music library is shared by every project (see backend/music_library.py)
FRONTEND_DIR = BASE_DIR / "frontend"
# Where the CollabSuite proxy mounts this app. Every URL the server hands to the browser (video_url, thumbs, music...) carries it;
# the proxy strips it again before forwarding, so the routes themselves stay at /api/...
URL_BASE = os.environ.get("STUDIOX_URL_BASE", "/studiox").rstrip("/")

for d in [STORAGE_DIR, UPLOADS_DIR, PROJECTS_DIR, MUSIC_DIR]:
    d.mkdir(parents=True, exist_ok=True)

def _use_bundled_bin() -> None:
    """The ffmpeg/ffprobe/node shipped with the installer win over whatever is on the user's PATH, so the
    app behaves the same on every machine. Child processes (render.py, node) inherit this PATH."""
    if BUNDLED_BIN_DIR.is_dir() and str(BUNDLED_BIN_DIR) not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = str(BUNDLED_BIN_DIR) + os.pathsep + os.environ.get("PATH", "")

_use_bundled_bin()

# Ensure FFmpeg is on PATH
def ensure_ffmpeg():
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        return True
    
    # Check winget standard path
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        winget_pkgs = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        if winget_pkgs.exists():
            for ffmpeg_exe in winget_pkgs.glob("**/ffmpeg.exe"):
                bin_dir = ffmpeg_exe.parent
                os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
                if shutil.which("ffmpeg"):
                    return True
    return False

ensure_ffmpeg()

# Node.js runs the Remotion sidecar (motion/render.mjs) for motion graphics — see backend/motion_render.py.
def ensure_node():
    if shutil.which("node"):
        return True

    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        winget_pkgs = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        if winget_pkgs.exists():
            for node_exe in winget_pkgs.glob("**/node.exe"):
                bin_dir = node_exe.parent
                os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
                if shutil.which("node"):
                    return True
    return False

ensure_node()

def dotenv_files() -> list[Path]:
    """Where a key may have been written by hand (older setups): video-use/.env and .env next to the app.
    STUDIOX_ENV_FILES (paths separated like PATH) replaces the list: tests use it so they never read a real key."""
    override = os.environ.get("STUDIOX_ENV_FILES")
    if override is not None:
        return [Path(p) for p in override.split(os.pathsep) if p]
    return [VIDEO_USE_DIR / ".env", BASE_DIR / ".env"]

def read_dotenv_value(name: str) -> str | None:
    """The value of NAME in the first .env file that has it (comments and empty values are skipped)."""
    for candidate in dotenv_files():
        try:
            lines = candidate.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == name:
                val = v.strip().strip('"').strip("'")
                if val:
                    return val
    return None

def get_elevenlabs_api_key() -> str | None:
    """The ElevenLabs key: the one saved in Configurações (backend/credentials.py), else the old .env files,
    else the ELEVENLABS_API_KEY environment variable."""
    from backend import credentials  # lazy: credentials imports this module
    return credentials.get_service_key("elevenlabs")

def has_whisper_available() -> bool:
    try:
        import whisper
        return True
    except ImportError:
        return False

def script_command() -> list[str]:
    """argv prefix that runs a helper script (video-use/helpers/*.py) with the app's own interpreter.
    Frozen there is no `python` on the machine: the exe runs the script itself (see desktop.py --run-script)."""
    return [sys.executable, "--run-script"] if FROZEN else [sys.executable]
