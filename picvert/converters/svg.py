"""SVG output: embed a Base64-PNG inside an SVG container.

This is not real vectorisation — it's a raster-in-SVG wrapper, which is the
sane behaviour for converting bitmap input to an SVG-named target.
"""
from __future__ import annotations

import base64
import io
import logging
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)


def remove_background(
    img: Image.Image,
    bg_color: tuple[int, int, int] = (255, 255, 255),
    tolerance: int = 30,
) -> Image.Image:
    """Make pixels close to `bg_color` fully transparent.

    Uses Pillow's tobytes/frombytes (vs. the deprecated getdata/putdata) and
    operates on the byte buffer directly — meaningfully faster than the
    original per-pixel Python tuple loop, with no extra dependency.
    """
    img = img.convert("RGBA")
    pixels = bytearray(img.tobytes())
    bg_r, bg_g, bg_b = bg_color
    for i in range(0, len(pixels), 4):
        if (
            abs(pixels[i] - bg_r) < tolerance
            and abs(pixels[i + 1] - bg_g) < tolerance
            and abs(pixels[i + 2] - bg_b) < tolerance
        ):
            pixels[i + 3] = 0
    img.frombytes(bytes(pixels))
    return img


def save_as_svg(img: Image.Image, output_path: Path) -> None:
    img = remove_background(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = base64.b64encode(buf.getvalue()).decode("utf-8")
    width, height = img.size
    svg_str = (
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">\n'
        f'  <image href="data:image/png;base64,{data}" width="{width}" height="{height}" />\n'
        "</svg>\n"
    )
    Path(output_path).write_text(svg_str, encoding="utf-8")
    logger.debug("SVG saved to %s", output_path)
