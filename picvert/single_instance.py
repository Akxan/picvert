"""Bind to a localhost port to enforce single-instance execution."""
from __future__ import annotations

import socket

from .constants import SINGLE_INSTANCE_PORT


def acquire_lock(port: int = SINGLE_INSTANCE_PORT) -> socket.socket | None:
    """Try to bind localhost:port. Returns the socket on success, else None.

    SO_REUSEADDR avoids spurious "another instance" dialogs after a normal
    shutdown (the port can otherwise sit in TIME_WAIT for a couple of minutes
    on macOS/Linux). The lock is the OS owning the bound port: when the
    process dies the kernel releases it.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        s.close()
        return None
    s.listen(1)
    return s
