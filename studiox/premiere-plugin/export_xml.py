"""Runs the StudioX edit on a video and writes <video>.studiox.xml (Premiere sequence with the cuts) and
<video>.studiox.srt (captions) next to it, without the panel. Import them in Premiere with File > Import.

    python premiere-plugin/export_xml.py "C:\videos\aula.mp4" [--language pt] [--review auto|local|llm|off] [--no-cut]
"""
import argparse
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import premiere_service as ps  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--language", default="pt")
    ap.add_argument("--review", default="auto")
    ap.add_argument("--no-cut", action="store_true")
    ap.add_argument("--copy-file", help="text file with the script of the video")
    a = ap.parse_args()
    copy = Path(a.copy_file).read_text(encoding="utf-8") if a.copy_file else ""
    job_id = ps.start(a.video, language=a.language, review=a.review, auto_cut=not a.no_cut, copy=copy)
    shown = 0
    while True:
        job = ps.get(job_id)
        for line in job["logs"][shown:]:
            print(line)
        shown = len(job["logs"])
        if job["status"] != "running":
            break
        time.sleep(1)
    if job["status"] != "done":
        print("ERRO:", job["error"])
        return 1
    video = Path(a.video)
    r = job["result"]
    for w in r["warnings"]:
        print("Aviso:", w)
    xml = video.with_suffix(".studiox.xml")
    shutil.copy2(r["files"]["xml"], xml)
    print("XML:", xml)
    if r["files"]["srt"]:
        srt = video.with_suffix(".studiox.srt")
        shutil.copy2(r["files"]["srt"], srt)
        print("SRT:", srt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
