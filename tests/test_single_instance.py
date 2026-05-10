"""Single-instance lock tests — uses an ephemeral port to avoid clashing with
other Picvert instances or system services.
"""
from __future__ import annotations

import socket

import pytest

from picvert.single_instance import acquire_lock


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_first_acquire_returns_socket() -> None:
    port = _free_port()
    s = acquire_lock(port)
    assert s is not None
    s.close()


def test_second_acquire_returns_none() -> None:
    port = _free_port()
    first = acquire_lock(port)
    assert first is not None
    try:
        second = acquire_lock(port)
        assert second is None
    finally:
        first.close()


def test_lock_releases_on_close() -> None:
    """Closing the socket frees the port for the next acquire."""
    port = _free_port()
    first = acquire_lock(port)
    assert first is not None
    first.close()
    second = acquire_lock(port)
    assert second is not None
    second.close()
