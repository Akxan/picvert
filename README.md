# Picvert

Cross-platform batch converter for images, PDFs, and Office documents.
A native desktop shell (Tauri) backed by a Python engine.

| | |
|---|---|
| **Platforms** | macOS (Apple Silicon) · Windows x86_64 |
| **Auto-update** | ✅ via GitHub Releases |
| **License** | Apache-2.0 |
| **Status** | 1.2.1 |

> Drag files (or whole folders) in, choose a format, click Convert.
> A floating capsule on your desktop shows time + weather while
> Picvert sits out of the way until you need it.

<!-- Drop your own screenshots into docs/screenshots/ — e.g. via
     ./scripts/take_screenshots.sh — and they'll show up here. -->

| Main panel | Compact capsule |
|---|---|
| ![Main](docs/screenshots/main.png) | ![Capsule](docs/screenshots/capsule.png) |

## Features

- 🖼️ **Images** — PNG · JPEG · JFIF · BMP · GIF · TIFF · WEBP · ICO · PPM ·
  TGA · JPEG2000 · SVG · **HEIC** (read & write)
- 📄 **PDF → image** — every page rendered at 3× zoom (configurable)
- 📊 **Documents** — real conversion across **DOCX ↔ XLSX ↔ CSV** (six
  directions, multi-sheet XLSX → CSV writes one CSV per sheet)
- 🎚️ **Quality slider** for JPEG / WEBP / HEIC / JPEG2000 (60-100, default 90)
- 📐 **Max-width input** to downscale large photos in batch
- 📁 **Drop folders** — recursively expands to all supported files
- 🪟 **Compact mode** — a draggable always-on-top weather widget; click to
  expand the main panel
- 🌐 4-language UI (EN · ES · RU · ZH) — translates the tray menu too
- 🔄 **GitHub Releases auto-updater** with signed payloads
- ⌨️ Shortcuts: `⌘O` open · `⌘↵` convert · `⌘L` clear · `⌘.` cancel

## Architecture

```
┌──────────────────────────────────────┐
│ Tauri shell (Rust + WebView)         │  src-tauri/  +  ui/
│ • main window / capsule              │
│ • menu-bar tray + native dialogs     │
│ • auto-updater                       │
└────────────┬─────────────────────────┘
             │ persistent stdin/stdout JSON-RPC
┌────────────▼─────────────────────────┐
│ picvert-engine sidecar (Python)      │  picvert/
│ • Pillow / PyMuPDF / openpyxl /      │
│   python-docx / pillow-heif          │
└──────────────────────────────────────┘
```

## Repository layout

```
picvert/
├── picvert/                    # Python engine (sidecar)
│   ├── cli.py                  # JSON-RPC stdio entry point
│   ├── constants.py
│   └── converters/             # image / pdf / svg / document
├── ui/                         # Frontend (vanilla HTML/CSS/JS)
├── src-tauri/                  # Tauri shell (Rust)
│   ├── src/                    # tray, sidecar bridge, http, dialogs
│   ├── tauri.conf.json
│   └── icons/                  # tray-icon variants per OS
├── tests/                      # pytest, 28 cases
├── scripts/
│   ├── build_sidecar.sh        # PyInstaller wrapper
│   ├── set_tray_icon.sh        # SVG → mac/win/linux tray PNGs
│   ├── take_screenshots.sh     # generate screenshots for docs
│   ├── loop_test_engine.py     # 25-case black-box engine tester
│   └── bench_engine.py
├── engine.spec                 # PyInstaller (--onedir)
├── pyproject.toml
├── docs/RELEASING.md           # how to ship
└── .github/workflows/release.yml
```

## Local development

Prerequisites: Python 3.10+, Rust (rustup), Node 20+, Xcode CLT (macOS).

```bash
git clone https://github.com/Akxan/picvert.git
cd picvert
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                      # 28 tests pass

# Build the sidecar binary for your host
./scripts/build_sidecar.sh

# Tauri dev shell (hot reload)
cargo install tauri-cli --version "^2.0.0" --locked
cd src-tauri
cargo tauri dev
```

## Building a release

See [`docs/RELEASING.md`](docs/RELEASING.md). Tag `v*.*.*` and push; the
GitHub Actions workflow builds + signs + publishes for macOS arm64,
macOS x86_64, and Windows x86_64.

## Document-conversion matrix

```
target →     DOCX   XLSX   CSV
DOCX           ✓¹     ✓     ✓
XLSX           ✓      ✓¹    ✓²
CSV            ✓      ✓     ✓¹

¹ same-format → file copy
² xlsx → csv writes one csv per sheet (no data loss)
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0 — see [LICENSE](LICENSE).
