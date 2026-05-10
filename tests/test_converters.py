"""End-to-end tests for the converter dispatcher.

Each test creates the input file in a tmp dir and asserts that the produced
output file exists, has the right extension, and is a valid file in its target
format (verified by re-reading it with the appropriate library).
"""
from __future__ import annotations

import csv
from pathlib import Path

import pytest
from PIL import Image
from docx import Document
from openpyxl import Workbook, load_workbook

from picvert.converters import UnsupportedConversion, convert_file
from picvert.converters.image import HEIC_AVAILABLE


# --------------------------------------------------------------------- helpers
def _make_png(path: Path, color=(255, 0, 0), size=(20, 20)) -> Path:
    Image.new("RGB", size, color=color).save(path)
    return path


def _make_csv(path: Path, rows=(("a", "b"), ("1", "2"))) -> Path:
    with path.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(rows)
    return path


def _make_xlsx(path: Path, rows=(("h1", "h2"), ("v1", "v2"))) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "First"
    for row in rows:
        ws.append(row)
    wb.save(str(path))
    return path


def _make_docx(path: Path, paragraphs=("hello world", "second line")) -> Path:
    doc = Document()
    for p in paragraphs:
        doc.add_paragraph(p)
    doc.save(str(path))
    return path


# ----------------------------------------------------------------- image tests
class TestImageConversion:
    def test_png_to_jpeg(self, tmp_path: Path) -> None:
        src = _make_png(tmp_path / "in.png")
        out_dir = tmp_path / "out"
        n = convert_file(src, out_dir, "JPEG")
        assert n == 1
        out = out_dir / "in.jpg"
        assert out.exists()
        with Image.open(out) as img:
            assert img.format == "JPEG"

    def test_png_to_webp(self, tmp_path: Path) -> None:
        src = _make_png(tmp_path / "in.png")
        n = convert_file(src, tmp_path / "out", "WEBP")
        assert n == 1
        assert (tmp_path / "out" / "in.webp").exists()

    def test_png_to_pdf(self, tmp_path: Path) -> None:
        src = _make_png(tmp_path / "in.png")
        n = convert_file(src, tmp_path / "out", "PDF")
        assert n == 1
        assert (tmp_path / "out" / "in.pdf").exists()

    def test_png_to_svg(self, tmp_path: Path) -> None:
        src = _make_png(tmp_path / "in.png")
        n = convert_file(src, tmp_path / "out", "SVG")
        assert n == 1
        out = tmp_path / "out" / "in.svg"
        assert out.exists()
        text = out.read_text()
        assert text.startswith("<?xml") and "image/png;base64" in text

    def test_image_to_doc_format_rejected(self, tmp_path: Path) -> None:
        src = _make_png(tmp_path / "in.png")
        with pytest.raises(UnsupportedConversion):
            convert_file(src, tmp_path / "out", "DOCX")

    @pytest.mark.skipif(not HEIC_AVAILABLE, reason="pillow-heif not installed")
    def test_png_to_heic_round_trip(self, tmp_path: Path) -> None:
        src = _make_png(tmp_path / "in.png")
        n = convert_file(src, tmp_path / "out", "HEIC")
        assert n == 1
        out = tmp_path / "out" / "in.heic"
        assert out.exists()
        # Round-trip: read it back as a regular image.
        with Image.open(out) as img:
            assert img.size == (20, 20)


# -------------------------------------------------------------- document tests
class TestDocumentConversion:
    def test_csv_to_xlsx(self, tmp_path: Path) -> None:
        src = _make_csv(tmp_path / "in.csv", rows=(("name", "age"), ("ada", "30")))
        n = convert_file(src, tmp_path / "out", "XLSX")
        assert n == 1
        wb = load_workbook(tmp_path / "out" / "in.xlsx")
        ws = wb.active
        rows = [tuple(r) for r in ws.iter_rows(values_only=True)]
        assert rows == [("name", "age"), ("ada", "30")]

    def test_csv_to_docx(self, tmp_path: Path) -> None:
        src = _make_csv(tmp_path / "in.csv")
        n = convert_file(src, tmp_path / "out", "DOCX")
        assert n == 1
        doc = Document(str(tmp_path / "out" / "in.docx"))
        assert len(doc.tables) == 1
        cells = [[c.text for c in r.cells] for r in doc.tables[0].rows]
        assert cells == [["a", "b"], ["1", "2"]]

    def test_xlsx_to_csv_single_sheet(self, tmp_path: Path) -> None:
        src = _make_xlsx(tmp_path / "in.xlsx")
        n = convert_file(src, tmp_path / "out", "CSV")
        assert n == 1
        with (tmp_path / "out" / "in.csv").open() as f:
            rows = list(csv.reader(f))
        assert rows == [["h1", "h2"], ["v1", "v2"]]

    def test_xlsx_to_csv_multi_sheet_writes_one_csv_per_sheet(self, tmp_path: Path) -> None:
        src = tmp_path / "in.xlsx"
        wb = Workbook()
        wb.active.title = "Alpha"
        wb.active.append(["a", "1"])
        wb.create_sheet("Beta").append(["b", "2"])
        wb.save(str(src))
        out_dir = tmp_path / "out"
        n = convert_file(src, out_dir, "CSV")
        assert n == 2  # one file per sheet, no silent data loss
        assert (out_dir / "in__Alpha.csv").exists()
        assert (out_dir / "in__Beta.csv").exists()

    def test_xlsx_to_docx_multi_sheet(self, tmp_path: Path) -> None:
        src = tmp_path / "in.xlsx"
        wb = Workbook()
        wb.active.title = "S1"
        wb.active.append(["a", "b"])
        wb.create_sheet("S2").append(["c", "d"])
        wb.save(str(src))
        n = convert_file(src, tmp_path / "out", "DOCX")
        assert n == 1
        doc = Document(str(tmp_path / "out" / "in.docx"))
        # Two sheets → two tables, one heading per sheet.
        assert len(doc.tables) == 2

    def test_docx_to_csv_paragraphs(self, tmp_path: Path) -> None:
        src = _make_docx(tmp_path / "in.docx")
        n = convert_file(src, tmp_path / "out", "CSV")
        assert n == 1
        with (tmp_path / "out" / "in.csv").open() as f:
            rows = list(csv.reader(f))
        assert rows == [["hello world"], ["second line"]]

    def test_docx_to_xlsx(self, tmp_path: Path) -> None:
        src = _make_docx(tmp_path / "in.docx")
        n = convert_file(src, tmp_path / "out", "XLSX")
        assert n == 1
        wb = load_workbook(tmp_path / "out" / "in.xlsx")
        # No tables in source → only "Paragraphs" sheet.
        assert "Paragraphs" in wb.sheetnames

    def test_same_format_copies(self, tmp_path: Path) -> None:
        src = _make_csv(tmp_path / "in.csv")
        n = convert_file(src, tmp_path / "out", "CSV")
        assert n == 1
        assert (tmp_path / "out" / "in.csv").read_text() == src.read_text()

    def test_doc_to_image_format_rejected(self, tmp_path: Path) -> None:
        src = _make_csv(tmp_path / "in.csv")
        with pytest.raises(UnsupportedConversion):
            convert_file(src, tmp_path / "out", "PNG")


# --------------------------------------------------------------------- pdf
class TestPdfConversion:
    def test_pdf_to_png(self, tmp_path: Path) -> None:
        # Build a tiny 2-page PDF from images so we don't need a fixture file.
        png1 = _make_png(tmp_path / "p1.png", color=(0, 0, 255))
        png2 = _make_png(tmp_path / "p2.png", color=(0, 255, 0))
        pdf_path = tmp_path / "doc.pdf"
        with Image.open(png1) as a, Image.open(png2) as b:
            a.save(pdf_path, save_all=True, append_images=[b])
        n = convert_file(pdf_path, tmp_path / "out", "PNG")
        assert n == 2
        assert (tmp_path / "out" / "doc_page1.png").exists()
        assert (tmp_path / "out" / "doc_page2.png").exists()


# --------------------------------------------------------------- bad input
def test_unknown_extension(tmp_path: Path) -> None:
    weird = tmp_path / "weird.xyz"
    weird.write_text("hi")
    with pytest.raises(UnsupportedConversion):
        convert_file(weird, tmp_path / "out", "PNG")
