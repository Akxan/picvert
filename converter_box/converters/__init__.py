"""Convert dispatcher: chooses the right converter based on input/output type."""
from __future__ import annotations

import logging
from pathlib import Path

from ..constants import (
    DOC_EXTS,
    DOC_OUTPUT_FORMATS,
    FORMAT_MAPPING,
    IMAGE_EXTS,
    IMAGE_OUTPUT_FORMATS,
    PDF_EXTS,
)
from .document import convert_document_file
from .image import convert_image_file
from .pdf import convert_pdf_file

logger = logging.getLogger(__name__)


class UnsupportedConversion(ValueError):
    """Raised when input/output combo is not supported."""


def convert_file(file_path: Path, output_folder: Path, selected_format: str) -> int:
    """Dispatch a single file to the right converter.

    Returns the number of files actually written (PDFs may produce many).
    """
    output_format, ext_out = FORMAT_MAPPING.get(selected_format, ("JPEG", ".jpg"))
    ext_in = file_path.suffix.lower()
    output_folder.mkdir(parents=True, exist_ok=True)

    if ext_in in PDF_EXTS:
        return convert_pdf_file(file_path, output_folder, output_format, ext_out)

    if ext_in in DOC_EXTS:
        if output_format not in DOC_OUTPUT_FORMATS:
            raise UnsupportedConversion(
                f"Cannot convert document {file_path.name} to image format {output_format}."
            )
        return convert_document_file(file_path, output_folder, output_format, ext_out)

    if ext_in in IMAGE_EXTS:
        if output_format not in IMAGE_OUTPUT_FORMATS:
            raise UnsupportedConversion(
                f"Cannot convert image {file_path.name} to document format {output_format}."
            )
        return convert_image_file(file_path, output_folder, output_format, ext_out)

    raise UnsupportedConversion(f"Unsupported input extension: {ext_in}")
