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
            # Optional encoding controls — UI passes them per-batch.
            quality = int(req.get("quality", 90))
            max_dim_raw = req.get("maxDim") or req.get("max_dim")
            max_dim = int(max_dim_raw) if max_dim_raw else None
            written = convert_file(
                input_path, output_folder, fmt,
                quality=quality, max_dim=max_dim,
            )
            return _ok(rid, {"written": written})

        if action == "preview":
            # Render a tiny thumbnail of the first page (PDF only for now).
            # Returns a base64 PNG data URL — small enough to splice into
            # the UI without hitting any size limits on the stdio channel.
            input_path = Path(req["input"])
            dataurl = _render_pdf_thumbnail(input_path)
            return _ok(rid, {"dataurl": dataurl})

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


def _render_pdf_thumbnail(path: Path) -> str:
    """Render the first PDF page as a small PNG and return a data URL."""
    import base64
    import fitz  # PyMuPDF
    with fitz.open(str(path)) as doc:
        page = doc.load_page(0)
        # ~100 px on the long side at typical screen DPI is enough for the
        # list-row thumbnail (~48 px CSS).
        zoom = 96 / max(page.rect.width, page.rect.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png_bytes = pix.tobytes("png")
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _ok(rid: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"id": rid, "ok": True, "result": result}


def _err(rid: Any, message: str, kind: str = "error") -> dict[str, Any]:
    return {"id": rid, "ok": False, "error": {"kind": kind, "message": message}}


import threading
from concurrent.futures import ThreadPoolExecutor

# stdout writes from worker threads must be serialised — JSON-RPC lines
# would otherwise interleave and break the parent's parser.
_emit_lock = threading.Lock()

# Lazy-initialised in main() so --json mode and --version don't pay for
# the thread pool. Up to 4 concurrent requests in flight; PyMuPDF /
# Pillow / lxml release the GIL during their heavy paths so threading
# actually scales here.
_executor: ThreadPoolExecutor | None = None


def _emit(resp: dict[str, Any]) -> None:
    """Write one JSON object to stdout, single line, flushed."""
    with _emit_lock:
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

    # line-mode — fan requests out to a thread pool so batch conversions
    # actually use multiple cores. Each worker handles one request end-to-
    # end and writes its own response (the emit lock serialises stdout).
    global _executor
    _executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="picvert-w")

    def _process(req: dict[str, Any]) -> None:
        _emit(_handle(req))

    try:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError as exc:
                _emit(_err(None, f"invalid JSON: {exc}", kind="bad_request"))
                continue
            # ping / list_formats / shutdown are fast and order-sensitive —
            # handle them inline so they don't sit behind heavy converts.
            action = req.get("action")
            if action in ("ping", "list_formats", "shutdown"):
                _emit(_handle(req))
                if action == "shutdown":
                    return 0
                continue
            _executor.submit(_process, req)
    finally:
        if _executor is not None:
            _executor.shutdown(wait=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
