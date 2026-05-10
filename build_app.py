#!/usr/bin/env python3
"""Build a standalone Picvert binary using PyInstaller.

Outputs:
    macOS:   dist/Picvert.app  +  dist/Picvert/
    Windows: dist/Picvert/Picvert.exe
    Linux:   dist/Picvert/Picvert

Usage:
    python build_app.py            # full build
    python build_app.py --clean    # also remove old build/ dist/
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SPEC = ROOT / "picvert.spec"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clean", action="store_true", help="Wipe build/ and dist/ first")
    args = parser.parse_args()

    if args.clean:
        for d in (ROOT / "build", ROOT / "dist"):
            if d.exists():
                print(f"[clean] removing {d}")
                shutil.rmtree(d)

    cmd = [sys.executable, "-m", "PyInstaller", str(SPEC), "--noconfirm"]
    print("[build]", " ".join(cmd))
    completed = subprocess.run(cmd, cwd=ROOT)
    if completed.returncode != 0:
        return completed.returncode

    dist = ROOT / "dist"
    print(f"\n✅ Build complete. Artifacts in: {dist}")
    if (dist / "Picvert.app").exists():
        print(f"   • macOS app bundle: {dist / 'Picvert.app'}")
    if (dist / "Picvert").exists():
        print(f"   • Folder distribution: {dist / 'Picvert'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
