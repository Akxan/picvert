#!/usr/bin/env bash
# Build the picvert-engine sidecar for the current host as a --onedir folder
# (kept in `dist/picvert-engine/`). Tauri picks this folder up via the
# `bundle.resources` entry in tauri.conf.json and ships it as
# `<App>.app/Contents/Resources/engine/`.
#
# Usage:
#   ./scripts/build_sidecar.sh
#   ./scripts/build_sidecar.sh /path/to/python.exe
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON="${1:-.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "❌ python interpreter not found at $PYTHON" >&2
  exit 1
fi

echo "▶ Building picvert-engine (--onedir)"
"$PYTHON" -m PyInstaller engine.spec --clean --noconfirm

OUT="dist/picvert-engine"
if [ ! -d "$OUT" ] || [ ! -f "$OUT/picvert-engine" -a ! -f "$OUT/picvert-engine.exe" ]; then
  echo "❌ build did not produce $OUT/picvert-engine[.exe]" >&2
  exit 1
fi

echo "✅ Sidecar ready: $OUT  ($(du -sh "$OUT" | awk '{print $1}'))"
