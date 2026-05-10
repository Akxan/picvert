#!/usr/bin/env bash
# Build the picvert-engine sidecar binary for the current host and copy it to
# src-tauri/binaries/picvert-engine-<host-triple>(.exe), where Tauri's sidecar
# loader expects it.
#
# Usage:
#   ./scripts/build_sidecar.sh
#   ./scripts/build_sidecar.sh /path/to/python.exe   # explicit interpreter
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON="${1:-.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "❌ python interpreter not found at $PYTHON" >&2
  exit 1
fi

# Get rustc host triple (e.g. aarch64-apple-darwin, x86_64-pc-windows-msvc).
TRIPLE="${RUST_HOST_TRIPLE:-}"
if [ -z "$TRIPLE" ]; then
  if command -v rustc >/dev/null 2>&1; then
    TRIPLE=$(rustc -vV | awk '/^host:/{print $2}')
  else
    echo "❌ rustc not on PATH and RUST_HOST_TRIPLE not set" >&2
    exit 1
  fi
fi

echo "▶ Building picvert-engine for $TRIPLE"
"$PYTHON" -m PyInstaller engine.spec --clean --noconfirm

mkdir -p src-tauri/binaries
SRC=dist/picvert-engine
EXT=""
case "$TRIPLE" in
  *windows*) EXT=".exe" ;;
esac
[ -f "${SRC}${EXT}" ] && SRC="${SRC}${EXT}"

DEST="src-tauri/binaries/picvert-engine-${TRIPLE}${EXT}"
cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "✅ Sidecar installed: $DEST ($(du -h "$DEST" | awk '{print $1}'))"
