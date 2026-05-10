"""Image-file conversion using Pillow (with optional HEIC support)."""
from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image, ImageOps

from .svg import save_as_svg

logger = logging.getLogger(__name__)

# Register HEIC opener if pillow-heif is installed (optional dep — soft-fail).
# Narrow the catch: ImportError = package missing; OSError = libheif missing or
# load-time link failure. A blanket `except Exception` would swallow real bugs.
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIC_AVAILABLE = True
except (ImportError, OSError) as exc:
    HEIC_AVAILABLE = False
    logger.warning("pillow-heif not available, HEIC read/write disabled: %s", exc)


def convert_image_file(
    file_path: Path, output_folder: Path, output_format: str, ext_out: str
) -> int:
    """Convert one image file. Returns 1 on success."""
    out_path = output_folder / (file_path.stem + ext_out)

    with Image.open(file_path) as img:
        # Honour EXIF orientation so phone photos don't come out sideways.
        img = ImageOps.exif_transpose(img)

        if output_format in {"JPEG", "JPEG2000", "HEIC"} and img.mode != "RGB":
            img = img.convert("RGB")

        if output_format == "SVG":
            save_as_svg(img, out_path)
        elif output_format == "JPEG":
            img.save(out_path, output_format, quality=100)
        elif output_format == "PDF":
            dpi = img.info.get("dpi", (300, 300))[0]
            img.save(out_path, output_format, resolution=dpi)
        elif output_format == "HEIC":
            if not HEIC_AVAILABLE:
                raise RuntimeError(
                    "HEIC output requires the `pillow-heif` package. "
                    "Install it with: pip install pillow-heif"
                )
            img.save(out_path, "HEIF", quality=90)
        else:
            img.save(out_path, output_format)

    logger.info("Converted image %s → %s", file_path, out_path)
    return 1
