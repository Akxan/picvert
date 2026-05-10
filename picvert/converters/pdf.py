"""PDF (and SVG) → image conversion via PyMuPDF."""
from __future__ import annotations

import io
import logging
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from .image import _maybe_resize
from .svg import save_as_svg

logger = logging.getLogger(__name__)

PDF_RENDER_ZOOM = 3.0


def convert_pdf_file(
    file_path: Path,
    output_folder: Path,
    output_format: str,
    ext_out: str,
    single_page_naming: bool = False,
    *,
    quality: int = 90,
    max_dim: int | None = None,
) -> int:
    """Render every page of a PDF (or SVG) to images.

    `single_page_naming=True`: 1-page sources get `<stem><ext>` (no _page1).
    `quality`: JPEG/WEBP encoder quality 1-100.
    `max_dim`: cap longest side per page (px).

    Returns the number of pages written. On open failure we re-raise so the
    dispatcher reports a clean error to the UI (silently returning 0 used to
    show "ok (0)" which masked real failures).
    """
    base = file_path.stem
    doc = fitz.open(str(file_path))   # raises on bad input → handled by cli.py

    written = 0
    matrix = fitz.Matrix(PDF_RENDER_ZOOM, PDF_RENDER_ZOOM)
    use_single_naming = single_page_naming and doc.page_count == 1

    try:
        for index, page in enumerate(doc):
            try:
                pix = page.get_pixmap(matrix=matrix)
                img_bytes = pix.tobytes("png")
                with Image.open(io.BytesIO(img_bytes)) as page_img:
                    page_img = _maybe_resize(page_img, max_dim)

                    if output_format in {"JPEG", "JPEG2000"} and page_img.mode != "RGB":
                        page_img = page_img.convert("RGB")

                    if use_single_naming:
                        out_path = output_folder / f"{base}{ext_out}"
                    else:
                        out_path = output_folder / f"{base}_page{index + 1}{ext_out}"

                    if output_format == "SVG":
                        save_as_svg(page_img, out_path)
                    elif output_format == "JPEG":
                        page_img.save(out_path, output_format, quality=int(quality),
                                      optimize=True, progressive=True)
                    elif output_format == "WEBP":
                        page_img.save(out_path, output_format, quality=int(quality), method=6)
                    elif output_format == "PDF":
                        dpi = page_img.info.get("dpi", (300, 300))[0]
                        page_img.save(out_path, output_format, resolution=dpi)
                    else:
                        page_img.save(out_path, output_format)

                logger.info("rendered page %d → %s (q=%d)", index + 1, out_path, quality)
                written += 1
            except Exception as exc:
                logger.error("Error converting page %d of %s: %s",
                             index + 1, file_path, exc)
    finally:
        doc.close()

    return written
