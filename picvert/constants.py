"""Format constants and categorisation."""
from __future__ import annotations

APP_NAME = "Picvert"
APP_VERSION = "1.1.0"
APP_AUTHOR = "Julio"

# Raster image inputs — read by Pillow.
IMAGE_EXTS = {
    ".png", ".jpg", ".jpeg", ".jfif", ".bmp", ".gif", ".tiff",
    ".webp", ".ico", ".ppm", ".tga", ".jp2", ".heic",
}
# Vector / paged inputs — rendered by PyMuPDF, which handles SVG and PDF.
PDF_EXTS = {".pdf"}
SVG_INPUT_EXTS = {".svg"}
DOC_EXTS = {".docx", ".xlsx", ".csv"}

SUPPORTED_EXTS = sorted(IMAGE_EXTS | PDF_EXTS | SVG_INPUT_EXTS | DOC_EXTS)

FORMAT_MAPPING: dict[str, tuple[str, str]] = {
    "JPEG": ("JPEG", ".jpg"),
    "JPG": ("JPEG", ".jpg"),
    "JFIF": ("JPEG", ".jfif"),
    "PNG": ("PNG", ".png"),
    "BMP": ("BMP", ".bmp"),
    "GIF": ("GIF", ".gif"),
    "TIFF": ("TIFF", ".tiff"),
    "WEBP": ("WEBP", ".webp"),
    "ICO": ("ICO", ".ico"),
    "PPM": ("PPM", ".ppm"),
    "TGA": ("TGA", ".tga"),
    "JPEG2000": ("JPEG2000", ".jp2"),
    "PDF": ("PDF", ".pdf"),
    "SVG": ("SVG", ".svg"),
    "HEIC": ("HEIC", ".heic"),
    "DOCX": ("DOCX", ".docx"),
    "XLSX": ("XLSX", ".xlsx"),
    "CSV": ("CSV", ".csv"),
}

OUTPUT_FORMAT_LIST = list(FORMAT_MAPPING.keys())

DOC_OUTPUT_FORMATS = {"DOCX", "XLSX", "CSV"}
IMAGE_OUTPUT_FORMATS = set(FORMAT_MAPPING) - DOC_OUTPUT_FORMATS

# A high, application-specific port. 9999 was a published convention for
# urbackup/distccmon and produced false-positive "another instance" dialogs
# when those tools were running.
SINGLE_INSTANCE_PORT = 53917
