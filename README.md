# Picvert

Cross-platform batch converter for images, PDFs, and Office documents.
A native desktop shell (Tauri) backed by a Python engine.

| | |
|---|---|
| **Platforms** | macOS · Windows · Linux |
| **Auto-update** | ✅ via GitHub Releases |
| **License** | Apache-2.0 |

## Architecture

```
┌─────────────────────────────────────┐
│ Tauri shell (Rust + WebView)         │  src-tauri/  +  ui/
│  - Window, drag/drop, dialogs       │
│  - Auto-updater (GitHub Releases)   │
└────────────┬────────────────────────┘
             │ stdin/stdout JSON
┌────────────▼────────────────────────┐
│ picvert-engine sidecar (Python)     │  picvert/
│  - Image / PDF / docx / xlsx / csv  │
└─────────────────────────────────────┘
```

The engine is the only place that touches Pillow, PyMuPDF, openpyxl, etc.;
the Tauri shell stays small (~10 MB) and the engine ships as a single
PyInstaller binary (~22 MB on macOS arm64).

## Repository layout

```
picvert/
├── picvert/                    # Python engine
│   ├── cli.py                  # JSON-RPC stdio (sidecar entry)
│   ├── converters/             # image / pdf / svg / document
│   ├── constants.py / i18n.py / config.py / paths.py / single_instance.py
├── ui/                         # Frontend (vanilla HTML/CSS/JS)
├── src-tauri/                  # Tauri shell
│   ├── src/                    # Rust glue
│   ├── tauri.conf.json
│   └── icons/
├── tests/                      # pytest, 36 tests
├── scripts/build_sidecar.sh    # build the engine binary for the host
├── engine.spec                 # PyInstaller spec
├── pyproject.toml
├── docs/RELEASING.md           # how to ship a new version
└── .github/workflows/release.yml
```

## Local development

Prerequisites: Python 3.10+, Rust (rustup), Node 20+, Xcode CLT (macOS).

```bash
# 1. Python engine
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                                          # 36 tests pass

# 2. Build the sidecar binary for your host
./scripts/build_sidecar.sh

# 3. Tauri dev shell (hot-reload of the UI)
cargo install tauri-cli --version "^2.0.0" --locked
cd src-tauri
cargo tauri dev
```

## Black-box testing

The packaged `picvert-engine` binary has its own loop tester independent of
`pytest` — it catches packaging issues (missing PyInstaller hidden imports,
runtime path mistakes, etc.) that source-level tests can't.

```bash
# 25 cases, each run multiple rounds
python scripts/loop_test_engine.py --rounds 5

# Cold-start vs persistent-sidecar wall-clock comparison
python scripts/bench_engine.py --calls 5
```

## Building a release

See [docs/RELEASING.md](docs/RELEASING.md). TL;DR: bump versions, push a
`v*.*.*` tag, GitHub Actions builds and publishes signed bundles for
macOS (arm64 + x86_64) and Windows.

## Document-conversion matrix

```
target →     DOCX   XLSX   CSV
DOCX           ✓¹     ✓     ✓
XLSX           ✓      ✓¹    ✓²
CSV            ✓      ✓     ✓¹

¹ same-format → file copy
² xlsx → csv writes one csv per sheet (no data loss)
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
