#!/usr/bin/env python3
"""Build a standalone Converter BOX binary using PyInstaller.

Outputs:
    macOS:   dist/ConverterBox.app  +  dist/ConverterBox/
    Windows: dist/ConverterBox/ConverterBox.exe
    Linux:   dist/ConverterBox/ConverterBox

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
SPEC = ROOT / "converter_box.spec"


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
    if (dist / "ConverterBox.app").exists():
        print(f"   • macOS app bundle: {dist / 'ConverterBox.app'}")
    if (dist / "ConverterBox").exists():
        print(f"   • Folder distribution: {dist / 'ConverterBox'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
