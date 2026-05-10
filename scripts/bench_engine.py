#!/usr/bin/env python3
"""Benchmark cold-start vs persistent sidecar against the packaged engine.

This is the empirical proof that the persistent-sidecar architecture in
src-tauri/src/lib.rs is needed: cold-starting the PyInstaller --onefile
binary every time costs ~6.5 s on macOS, while reusing one --line-mode
process drops per-request latency to a few milliseconds.

    $ python scripts/bench_engine.py --binary dist/picvert-engine --calls 5
    cold-start (one --json call per spawn):   N=5   median=6.481s  total=33.0s
    persistent (one --line-mode session):     N=5   median=0.005s  total=6.5s
"""
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path


def bench_cold(binary: Path, calls: int) -> list[float]:
    timings = []
    for _ in range(calls):
        t0 = time.perf_counter()
        proc = subprocess.run(
            [str(binary), "--json", '{"action":"ping"}'],
            capture_output=True, text=True, timeout=60,
        )
        timings.append(time.perf_counter() - t0)
        # Sanity check: the call must have actually succeeded.
        last_line = [l for l in proc.stdout.strip().splitlines() if l][-1]
        resp = json.loads(last_line)
        assert resp.get("ok") is True, f"ping failed: {resp}"
    return timings


def bench_persistent(binary: Path, calls: int) -> tuple[list[float], float]:
    """Returns (per-call timings AFTER the first ping, total wall time including
    cold start)."""
    proc = subprocess.Popen(
        [str(binary), "--line-mode"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, bufsize=1,
    )
    assert proc.stdin and proc.stdout

    t_total_start = time.perf_counter()
    timings = []
    try:
        for i in range(calls):
            t0 = time.perf_counter()
            proc.stdin.write(json.dumps({"id": str(i), "action": "ping"}) + "\n")
            proc.stdin.flush()
            line = proc.stdout.readline()
            timings.append(time.perf_counter() - t0)
            resp = json.loads(line)
            assert resp.get("ok") is True, f"ping failed: {resp}"
    finally:
        proc.stdin.write('{"id":"end","action":"shutdown"}\n')
        proc.stdin.flush()
        proc.wait(timeout=5)
    t_total = time.perf_counter() - t_total_start
    return timings, t_total


def fmt(secs: list[float]) -> str:
    return (
        f"N={len(secs)}  "
        f"median={statistics.median(secs):.3f}s  "
        f"min={min(secs):.3f}s  "
        f"max={max(secs):.3f}s  "
        f"total={sum(secs):.2f}s"
    )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--binary", type=Path, default=Path("dist/picvert-engine"))
    p.add_argument("--calls", type=int, default=5)
    args = p.parse_args()

    if not args.binary.exists():
        print(f"❌ binary not found: {args.binary}", file=sys.stderr)
        return 1

    print(f"▶ Benchmark {args.binary} with {args.calls} ping(s) per mode\n")

    print("• cold-start (a fresh subprocess per call)")
    cold = bench_cold(args.binary, args.calls)
    print(f"  {fmt(cold)}")

    print("\n• persistent (one --line-mode subprocess for all calls)")
    warm, total = bench_persistent(args.binary, args.calls)
    print(f"  per-call AFTER first cold start: {fmt(warm)}")
    print(f"  total wall time (incl. cold start): {total:.2f}s")

    speedup = sum(cold) / max(total, 1e-9)
    print(f"\n→ Persistent is ~{speedup:.0f}× faster wall-time for {args.calls} calls.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
