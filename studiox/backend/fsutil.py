"""Small file helpers."""
from __future__ import annotations

import os
import time
from pathlib import Path


def replace_file(src: Path, dst: Path, attempts: int = 60, delay: float = 0.025) -> None:
    """os.replace that waits out a reader on Windows.

    Replacing a file while another thread or process has it open fails with WinError 5/32
    ("Acesso negado"). The queue rewrites its state several times a second while the screens poll it,
    so this happens for real: retry for a moment instead of failing the whole item.
    """
    for i in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(delay)
