"""Pick the TCP port the local server listens on: never a fixed one, so StudioX still starts when 8000
(or any other port) is taken by another program.

The port used last time is tried first. The browser keys localStorage by origin (host + port), so a
port that changed on every launch would lose the user's saved preferences; a free random port is only
the fallback when the remembered one is busy.
"""
from __future__ import annotations

import socket
from pathlib import Path


# Ports Chromium/Edge refuse to open (ERR_UNSAFE_PORT), from net/base/port_util.cc. The OS can hand out
# any of these as a "random" port, so they have to be skipped explicitly.
_UNSAFE_PORTS = frozenset({
    1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
    6679, 6697, 10080,
})


def _bind(host: str, port: int) -> socket.socket | None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # No SO_REUSEADDR on purpose: on Windows it would let us "bind" to a port another program owns.
        sock.bind((host, port))
        return sock
    except OSError:
        sock.close()
        return None


def reserve_port(host: str = "127.0.0.1", remembered_file: Path | None = None) -> socket.socket:
    """A socket already bound to a free port. Hand it straight to uvicorn (Server.run(sockets=[sock])):
    the port stays ours from now until the server starts, so nobody can grab it in between."""
    preferred = 0
    if remembered_file is not None:
        try:
            preferred = int(remembered_file.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            preferred = 0
    sock = None
    if 1024 <= preferred <= 65535 and preferred not in _UNSAFE_PORTS:
        sock = _bind(host, preferred)
    for _ in range(50):
        if sock is not None:
            break
        sock = _bind(host, 0)  # the OS picks any free port
        if sock is not None and sock.getsockname()[1] in _UNSAFE_PORTS:
            sock.close()
            sock = None
    if sock is None:
        raise OSError("Não foi possível reservar uma porta local para o servidor.")
    if remembered_file is not None:
        try:
            remembered_file.write_text(str(sock.getsockname()[1]), encoding="utf-8")
        except OSError:
            pass
    return sock
