#!/usr/bin/env bash
# Interactive screenshot helper.
#
# Usage:
#   ./scripts/take_screenshots.sh
#
# Each step prompts you to click a window. Output goes to docs/screenshots/.
#
# Note: macOS asks for "Screen Recording" permission the first time you
# run this — grant it for your Terminal app under System Settings ▸
# Privacy & Security ▸ Screen Recording.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p docs/screenshots

shoot() {
  local name=$1
  local hint=$2
  echo ""
  echo "▶ $hint  (cursor will turn into a camera, then click the window)"
  read -p "press ↵ when ready " _
  screencapture -W -o "docs/screenshots/$name.png"
  echo "✅ docs/screenshots/$name.png"
}

shoot main    "Capture the main Picvert window"
shoot capsule "Now switch to Compact Mode (tray ▸ Compact Mode) and capture the capsule"
shoot help    "Open Help (?) dialog and capture it"

echo ""
echo "All screenshots saved under docs/screenshots/"
