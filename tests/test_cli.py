"""CLI / sidecar protocol tests."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

from picvert import cli


def _run_one(monkeypatch, *args: str) -> str:
    """Run cli.main(argv) capturing stdout. Returns the raw stdout string."""
    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buf)
    rc = cli.main(list(args))
    assert rc == 0
    return buf.getvalue()


def _last_json(out: str) -> dict:
    return json.loads(out.strip().splitlines()[-1])


def test_ping(monkeypatch) -> None:
    out = _run_one(monkeypatch, "--json", '{"id":"42","action":"ping"}')
    resp = _last_json(out)
    assert resp == {"id": "42", "ok": True, "result": {"pong": True, "version": resp["result"]["version"]}}
    assert resp["result"]["version"]  # non-empty


def test_list_formats(monkeypatch) -> None:
    out = _run_one(monkeypatch, "--json", '{"id":"1","action":"list_formats"}')
    resp = _last_json(out)
    assert resp["ok"] is True
    assert ".png" in resp["result"]["input_extensions"]
    assert "PNG" in resp["result"]["output_formats"]


def test_convert_single_image(tmp_path: Path, monkeypatch) -> None:
    src = tmp_path / "in.png"
    Image.new("RGB", (10, 10), (255, 0, 0)).save(src)
    payload = json.dumps({
        "id": "x",
        "action": "convert",
        "input": str(src),
        "output": str(tmp_path / "out"),
        "format": "JPEG",
    })
    out = _run_one(monkeypatch, "--json", payload)
    resp = _last_json(out)
    assert resp == {"id": "x", "ok": True, "result": {"written": 1}}
    assert (tmp_path / "out" / "in.jpg").exists()


def test_convert_unknown_format_returns_error(tmp_path: Path, monkeypatch) -> None:
    src = tmp_path / "in.png"
    Image.new("RGB", (10, 10)).save(src)
    payload = json.dumps({
        "action": "convert",
        "input": str(src),
        "output": str(tmp_path / "out"),
        "format": "BOGUS",
    })
    out = _run_one(monkeypatch, "--json", payload)
    resp = _last_json(out)
    assert resp["ok"] is False
    assert resp["error"]["kind"] == "unsupported"


def test_unknown_action_returns_error(monkeypatch) -> None:
    out = _run_one(monkeypatch, "--json", '{"action":"fly_to_mars"}')
    resp = _last_json(out)
    assert resp["ok"] is False
    assert "unknown_action" in resp["error"]["message"]


def test_invalid_json_returns_error(monkeypatch) -> None:
    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buf)
    rc = cli.main(["--json", "not json"])
    assert rc == 2  # argparse-style exit for bad input
    resp = _last_json(buf.getvalue())
    assert resp["ok"] is False
    assert resp["error"]["kind"] == "bad_request"


def test_line_mode_round_trip(tmp_path: Path, monkeypatch) -> None:
    src = tmp_path / "in.png"
    Image.new("RGB", (5, 5)).save(src)

    requests = [
        '{"id":"1","action":"ping"}',
        json.dumps({
            "id": "2",
            "action": "convert",
            "input": str(src),
            "output": str(tmp_path / "out"),
            "format": "PNG",
        }),
        '{"id":"3","action":"shutdown"}',
    ]
    monkeypatch.setattr(sys, "stdin", io.StringIO("\n".join(requests) + "\n"))
    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buf)

    rc = cli.main(["--line-mode"])
    assert rc == 0

    lines = [json.loads(l) for l in buf.getvalue().strip().splitlines()]
    assert len(lines) == 3
    assert lines[0]["id"] == "1" and lines[0]["ok"] is True
    assert lines[1]["id"] == "2" and lines[1]["result"]["written"] == 1
    assert lines[2]["id"] == "3" and lines[2]["ok"] is True
