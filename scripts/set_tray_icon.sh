#!/usr/bin/env bash
# Convert any SVG / large PNG into the tray-icon assets Picvert ships:
#   src-tauri/icons/tray.png          (22×22 — macOS menu bar, normal)
#   src-tauri/icons/tray@2x.png       (44×44 — macOS menu bar, retina)
#   src-tauri/icons/tray-win.png      (32×32 — Windows tray)
#   src-tauri/icons/tray-linux.png    (24×24 — common GNOME / KDE size)
#
# macOS variants are PURE BLACK + alpha (template image — system inverts
# the colour automatically for light/dark menu bars).
# Windows / Linux variants keep the source colour OR fall back to a
# brand-khaki tint visible on both light and dark taskbars.
#
# Usage:
#   ./scripts/set_tray_icon.sh my-icon.svg
#   ./scripts/set_tray_icon.sh path/to/big.png
set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Usage: $0 <input.svg|input.png>"
  exit 1
fi
SRC="$1"
[ -f "$SRC" ] || { echo "❌ file not found: $SRC" >&2; exit 1; }

PY="${PYTHON:-.venv/bin/python}"
[ -x "$PY" ] || PY="python3"

mkdir -p src-tauri/icons

"$PY" - "$SRC" <<'PY'
import sys
from pathlib import Path
from PIL import Image

src = Path(sys.argv[1])
ext = src.suffix.lower()

# ── render() returns a high-res RGBA image we then downscale per output ──

if ext == ".svg":
    import fitz, io
    HIGH = 256
    # SVGs from Lucide use stroke="currentColor"; substitute black so fitz
    # has something to paint. Cross-platform variants recolour later.
    raw = src.read_text()
    raw = raw.replace('stroke="currentColor"', 'stroke="black"')
    raw = raw.replace('fill="currentColor"', 'fill="black"')
    tmp = Path("/tmp/__picvert_icon.svg")
    tmp.write_text(raw)
    doc = fitz.open(str(tmp))
    page = doc[0]
    rect = page.rect
    zoom = HIGH / max(rect.width, rect.height)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
    high = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGBA")
    doc.close()
    tmp.unlink()
else:
    high = Image.open(src).convert("RGBA")

def downscale(size: int) -> Image.Image:
    return high.resize((size, size), Image.LANCZOS)

def recolor(img: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Re-paint all opaque pixels with `rgb`, keep alpha."""
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0:
                px[x, y] = (rgb[0], rgb[1], rgb[2], a)
    return out

out_dir = Path("src-tauri/icons")

# ── macOS template (pure black) ──
for size, name in [(22, "tray.png"), (44, "tray@2x.png")]:
    img = recolor(downscale(size), (0, 0, 0))
    img.save(out_dir / name)
    print(f"  macOS  → {name}  ({size}×{size}, template-black)")

# ── Windows: brand khaki (#b89968) — visible on light AND dark taskbars ──
img = recolor(downscale(32), (184, 153, 104))
img.save(out_dir / "tray-win.png")
print(f"  Windows → tray-win.png   (32×32, khaki #b89968)")

# ── Linux: same khaki, sized for GNOME/KDE indicator areas ──
img = recolor(downscale(24), (184, 153, 104))
img.save(out_dir / "tray-linux.png")
print(f"  Linux   → tray-linux.png (24×24, khaki #b89968)")
PY

echo ""
echo "Next: rebuild for the relevant platform:"
echo "  cargo tauri build --bundles app"
