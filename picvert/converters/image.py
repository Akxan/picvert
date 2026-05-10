"""Image-file conversion using Pillow (with optional HEIC support)."""
from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image, ImageOps

from .svg import save_as_svg

logger = logging.getLogger(__name__)

# Register HEIC opener if pillow-heif is installed (optional dep — soft-fail).
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIC_AVAILABLE = True
except (ImportError, OSError) as exc:
    HEIC_AVAILABLE = False
    logger.warning("pillow-heif not available, HEIC read/write disabled: %s", exc)


def _maybe_resize(img: Image.Image, max_dim: int | None) -> Image.Image:
    """Downscale (never enlarge) so the longest side is ≤ max_dim. Lossless."""
    if max_dim is None or max_dim <= 0:
        return img
    w, h = img.size
    longest = max(w, h)
    if longest <= max_dim:
        return img
    scale = max_dim / longest
    new_size = (int(w * scale), int(h * scale))
    return img.resize(new_size, Image.LANCZOS)


def convert_image_file(
    file_path: Path,
    output_folder: Path,
    output_format: str,
    ext_out: str,
    *,
    quality: int = 90,
    max_dim: int | None = None,
) -> int:
    """Convert one image file. Returns 1 on success."""
    out_path = output_folder / (file_path.stem + ext_out)

    with Image.open(file_path) as img:
        img = ImageOps.exif_transpose(img)
        img = _maybe_resize(img, max_dim)

        if output_format in {"JPEG", "JPEG2000", "HEIC"} and img.mode != "RGB":
            img = img.convert("RGB")

        if output_format == "SVG":
            save_as_svg(img, out_path)
        elif output_format == "JPEG":
            img.save(out_path, output_format, quality=int(quality), optimize=True, progressive=True)
        elif output_format == "WEBP":
            img.save(out_path, output_format, quality=int(quality), method=6)
        elif output_format == "JPEG2000":
            img.save(out_path, output_format, quality_mode="dB", quality_layers=[float(quality)])
        elif output_format == "PDF":
            dpi = img.info.get("dpi", (300, 300))[0]
            img.save(out_path, output_format, resolution=dpi)
        elif output_format == "HEIC":
            if not HEIC_AVAILABLE:
                raise RuntimeError(
                    "HEIC output requires the `pillow-heif` package. "
                    "Install it with: pip install pillow-heif"
                )
            img.save(out_path, "HEIF", quality=int(quality))
        else:
            # PNG/BMP/GIF/TIFF/ICO/PPM/TGA — lossless or no quality knob.
            img.save(out_path, output_format)

    logger.info("Converted image %s → %s (q=%d, max_dim=%s)",
                file_path, out_path, quality, max_dim)
    return 1
