"""JSON-RPC-style CLI used by the Tauri sidecar.

Two ways to invoke:

    # 1. one-shot (single command via argv)
    picvert-engine --json '{"action":"convert","input":"a.png","output":"out","format":"PDF"}'

    # 2. line-mode (Rust will keep stdin open and pipe JSON requests, one per line)
    picvert-engine --line-mode
    > {"id":"1","action":"convert","input":"a.png","output":"out","format":"PDF"}
    < {"id":"1","ok":true,"result":{"written":1}}

Every response carries the request `id` (if provided) so async callers can
correlate replies with requests.

Supported actions:
    - "convert"          → run a single conversion
    - "list_formats"     → return SUPPORTED_EXTS and OUTPUT_FORMAT_LIST
    - "ping"             → returns {"pong": true, "version": "..."}
    - "shutdown"         → exit cleanly (line-mode only)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from picvert import APP_VERSION
from picvert.constants import OUTPUT_FORMAT_LIST, SUPPORTED_EXTS
from picvert.converters import UnsupportedConversion, convert_file


def _handle(req: dict[str, Any]) -> dict[str, Any]:
    """Execute one request dict; never raises (errors come back as ok=False)."""
    rid = req.get("id")
    action = req.get("action")
    try:
        if action == "ping":
            return _ok(rid, {"pong": True, "version": APP_VERSION})

        if action == "list_formats":
            return _ok(rid, {
                "input_extensions": list(SUPPORTED_EXTS),
                "output_formats": list(OUTPUT_FORMAT_LIST),
            })

        if action == "convert":
            input_path = Path(req["input"])
            output_folder = Path(req["output"])
            fmt = req["format"]
            written = convert_file(input_path, output_folder, fmt)
            return _ok(rid, {"written": written})

        if action == "shutdown":
            return _ok(rid, {"goodbye": True})

        return _err(rid, f"unknown_action: {action!r}")

    except UnsupportedConversion as exc:
        return _err(rid, str(exc), kind="unsupported")
    except FileNotFoundError as exc:
        return _err(rid, str(exc), kind="not_found")
    except KeyError as exc:
        return _err(rid, f"missing required field: {exc.args[0]}", kind="bad_request")
    except Exception as exc:
        return _err(rid, f"{type(exc).__name__}: {exc}", kind="internal")


def _ok(rid: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"id": rid, "ok": True, "result": result}


def _err(rid: Any, message: str, kind: str = "error") -> dict[str, Any]:
    return {"id": rid, "ok": False, "error": {"kind": kind, "message": message}}


def _emit(resp: dict[str, Any]) -> None:
    """Write one JSON object to stdout, single line, flushed."""
    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="picvert-engine", description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--json", help="single request as a JSON string")
    group.add_argument("--line-mode", action="store_true",
                       help="read JSON requests from stdin, one per line")
    group.add_argument("--version", action="store_true", help="print version and exit")
    args = parser.parse_args(argv)

    if args.version:
        print(APP_VERSION)
        return 0

    if args.json is not None:
        try:
            req = json.loads(args.json)
        except json.JSONDecodeError as exc:
            _emit(_err(None, f"invalid JSON: {exc}", kind="bad_request"))
            return 2
        _emit(_handle(req))
        return 0

    # line-mode
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            _emit(_err(None, f"invalid JSON: {exc}", kind="bad_request"))
            continue
        resp = _handle(req)
        _emit(resp)
        if req.get("action") == "shutdown":
            return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
