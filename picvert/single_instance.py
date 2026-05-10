"""Bind to a localhost port to enforce single-instance execution."""
from __future__ import annotations

import socket

from .constants import SINGLE_INSTANCE_PORT


def acquire_lock(port: int = SINGLE_INSTANCE_PORT) -> socket.socket | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        return None
    s.listen(1)
    return s
