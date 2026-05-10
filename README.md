# Converter BOX (python-image)

Batch convert images, PDFs, and Office documents through a single Tkinter GUI
— drag-and-drop, multi-language, multi-threaded.

| | |
|---|---|
| **Author** | Julio (Akxan) |
| **Version** | 1.1.0 |
| **Languages** | English / Español / Русский / 中文 |

## Features

- 🖼️ **Images** — PNG, JPEG, JFIF, BMP, GIF, TIFF, WEBP, ICO, PPM, TGA,
  JPEG2000, SVG, and **HEIC** (read & write, via `pillow-heif`)
- 📄 **PDF** → image (every page, 3× zoom)
- 📊 **Documents** — real conversion across **DOCX ↔ XLSX ↔ CSV**
- 🌐 4-language UI with hot-swap from the menu
- 🪟 Drag-and-drop, multi-file batch, async progress bar
- 🔒 Single-instance lock (`localhost:9999`)

## Install (development)

Requires **Python 3.10+** with a working Tkinter.

```bash
git clone https://github.com/Akxan/python-image.git
cd python-image
python3 -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
```

### Tkinter / drag-drop note

The `tkinterdnd2` C extension is currently built against **Tcl/Tk 8.6** and
will not load on Tk 9.x. If `python -m converter_box` fails with
`Unable to load tkdnd library` (or `tkdnd_Init symbol not found`), use a
Python whose Tk is still 8.6:

- **macOS**: install Python from [python.org](https://www.python.org/downloads/)
  — the official installer ships Tk 8.6. Homebrew Python now uses Tk 9.
- **Windows**: the official installer ships Tk 8.6.
- **Linux**: most distros still ship Tk 8.6 via `python3-tk`.

The conversion engine itself does not need Tk and is fully covered by tests
that run on any Python.

## Run

```bash
python -m converter_box
# or, after `pip install .`
converter-box
```

## Test

```bash
pytest -v
```

## Build a standalone app

```bash
python build_app.py --clean
```

Outputs:

| Platform | Artifact |
|---|---|
| macOS | `dist/ConverterBox.app` |
| Windows | `dist/ConverterBox/ConverterBox.exe` |
| Linux | `dist/ConverterBox/ConverterBox` |

## Project layout

```
python-image/
├── converter_box/
│   ├── __init__.py
│   ├── __main__.py          # entry point
│   ├── constants.py         # supported formats, version, ports
│   ├── config.py            # config.json read/write
│   ├── i18n.py              # translations + _() helper
│   ├── single_instance.py   # localhost-port lock
│   ├── gui.py               # ImageConverterApp (Tkinter)
│   └── converters/
│       ├── __init__.py      # convert_file dispatcher
│       ├── image.py         # Pillow-based, includes HEIC
│       ├── pdf.py           # PyMuPDF page-by-page
│       ├── svg.py           # PNG embedded in SVG container
│       └── document.py      # docx/xlsx/csv with python-docx + openpyxl
├── tests/
│   └── test_converters.py   # 16 pytest cases
├── build_app.py             # PyInstaller wrapper
├── converter_box.spec       # PyInstaller spec
├── pyproject.toml
├── requirements.txt
└── requirements-dev.txt
```

## Document conversion matrix

```
target →     DOCX   XLSX   CSV
DOCX           ✓¹     ✓     ✓
XLSX           ✓      ✓¹    ✓²
CSV            ✓      ✓     ✓¹

¹ same-format → file copy
² xlsx → csv writes the first sheet only
```

## Notes & limitations

- **SVG output** is a Base64-PNG embedded in an SVG container — not real
  vectorisation. It is the best you can do without an upstream tracer
  (e.g. potrace).
- **Legacy `.xls` and `.doc`** are intentionally not supported. Save them as
  `.xlsx`/`.docx` first; the modern formats are clean to handle, the legacy
  binary blobs are not.
- HEIC support requires libheif at runtime — `pillow-heif` ships it on
  macOS / Linux / Windows wheels, no extra system packages needed.

## License

MIT
