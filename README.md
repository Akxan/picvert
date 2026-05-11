<div align="center">

# Picvert

**Batch image · PDF · Office document converter for macOS and Windows.**
**跨平台图像 · PDF · Office 文档批量转换工具，支持 macOS 和 Windows。**

[![Latest release](https://img.shields.io/github/v/release/Akxan/picvert?include_prereleases&label=release&color=c9a064)](https://github.com/Akxan/picvert/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-c9a064.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-c9a064?logo=apple&logoColor=white)](#)
[![Windows](https://img.shields.io/badge/Windows-x86__64-c9a064?logo=windows&logoColor=white)](#)
[![Tauri](https://img.shields.io/badge/Tauri-2-c9a064?logo=tauri&logoColor=white)](https://tauri.app/)
[![Python](https://img.shields.io/badge/Python-3.12-c9a064?logo=python&logoColor=white)](https://python.org)
[![CI](https://img.shields.io/github/actions/workflow/status/Akxan/picvert/release.yml?label=build&color=c9a064)](https://github.com/Akxan/picvert/actions)

[Download](https://github.com/Akxan/picvert/releases/latest) · [Features](#features) · [Architecture](#architecture) · [Build from source](#build-from-source)

</div>

---

> Drag files (or whole folders) in, choose a format, click Convert.
> A floating capsule on your desktop shows time + weather while Picvert sits out of the way until you need it.
>
> 把文件（或整个文件夹）拖进来，选格式，点转换。
> 桌面上的悬浮胶囊显示时间和天气，Picvert 不打扰你，需要时随手点开。

<p align="center">
  <img src="docs/screenshots/main.png" alt="Main window" width="46%">
  &nbsp;
  <img src="docs/screenshots/capsule.png" alt="Floating capsule" width="40%">
</p>

## Features · 功能

| | |
|---|---|
| 🖼️ **Images** | PNG · JPEG · JFIF · BMP · GIF · TIFF · WEBP · ICO · PPM · TGA · JPEG2000 · SVG · **HEIC** (read & write) |
| 📄 **PDF → image** | Every page rendered at 3× zoom (configurable) |
| 📊 **Documents** | Real conversion across **DOCX ↔ XLSX ↔ CSV** (six directions, multi-sheet XLSX → one CSV per sheet) |
| 🎚️ **Quality slider** | JPEG / WEBP / HEIC / JPEG2000 — 60-100, default 90 |
| 📐 **Max-width** | Proportionally downscale large images in batch |
| 📁 **Folder drop** | Recursively expands to all supported files (caps 5000 / drop) |
| ⚡ **Parallel** | Sidecar thread pool — ≈3-4× faster batch conversion |
| 🪟 **Compact mode** | Draggable always-on-top weather widget; click to expand |
| 🌐 **i18n** | 4 languages (EN · ES · RU · ZH) — tray menu translates too |
| 🔄 **Auto-update** | Background check + native confirm + signed payload verification |
| ⌨️ **Shortcuts** | `⌘O` open · `⌘↵` convert · `⌘L` clear · `⌘.` cancel |
| 🔍 **Click thumbnail** | Opens the source file in your default app (Preview / Adobe / etc.) |

## Architecture · 架构

```
┌──────────────────────────────────────────────┐
│  Tauri shell  (Rust + WebView)               │  src-tauri/  +  ui/
│  ────────────────────────────────            │
│  • Main panel · Compact capsule              │
│  • Menu-bar tray · Native dialogs            │
│  • Auto-updater (minisign verified)          │
│  • Code-signed, notarized                    │
└──────────────────┬───────────────────────────┘
                   │ persistent stdin/stdout JSON-RPC
                   │ (4-thread worker pool)
┌──────────────────▼───────────────────────────┐
│  picvert-engine  sidecar (Python --onedir)   │  picvert/
│  ────────────────────────────────            │
│  • Pillow · PyMuPDF · pillow-heif            │
│  • python-docx · openpyxl                    │
│  • Cold start ≈ 0.17 s                       │
└──────────────────────────────────────────────┘
```

## Tech stack · 技术栈

| Layer | Stack |
|---|---|
| **Desktop shell** | [Tauri 2](https://tauri.app/) (Rust) + WebView (WKWebView / WebView2) |
| **Frontend** | Vanilla HTML / CSS / JS — no build step, no bundler |
| **Conversion engine** | Python 3.12 — Pillow · PyMuPDF · pillow-heif · python-docx · openpyxl |
| **Packaging** | PyInstaller `--onedir` for the sidecar; Tauri bundler for the shell |
| **Code signing** | Apple Developer ID (notarized) on macOS; updater payloads minisign-signed on both platforms |
| **CI / Release** | GitHub Actions — build, sign, notarize, publish, generate updater manifest |
| **Testing** | pytest (28 tests covering all converter paths) |

## Download · 下载

Grab the latest installer for your platform from the [Releases page](https://github.com/Akxan/picvert/releases/latest):

- **macOS (Apple Silicon)** — `Picvert_*_aarch64.dmg`
- **Windows (x86_64)** — `Picvert_*_x64-setup.exe`

Installed apps **auto-update**: the next time a new release is published, Picvert prompts on startup and applies the update in place (signature verified).

## Build from source · 本地编译

### Prerequisites · 依赖

- Python 3.10+
- Rust toolchain ([rustup](https://www.rust-lang.org/tools/install))
- Node 20+ (not required at runtime — only if you want to extend the frontend tooling)
- macOS: Xcode CLT  ·  Windows: MSVC Build Tools

### Steps · 步骤

```bash
git clone https://github.com/Akxan/picvert.git
cd picvert
python3 -m venv .venv
source .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest -q                         # 28 tests pass

# Build the Python sidecar
python -m PyInstaller engine.spec --clean --noconfirm

# Dev shell with hot reload
cargo install tauri-cli --version "^2.0.0" --locked
cd src-tauri && cargo tauri dev
```

### Production build · 生产编译

```bash
cd src-tauri && cargo tauri build
# Output: target/<target>/release/bundle/{dmg,msi,nsis}/...
```

## Document conversion matrix · 文档转换矩阵

```
target →     DOCX   XLSX   CSV
DOCX           ✓¹     ✓     ✓
XLSX           ✓      ✓¹    ✓²
CSV            ✓      ✓     ✓¹

¹ same-format → file copy   ² multi-sheet XLSX → one CSV per sheet
```

## Release pipeline · 发布流程

See [`docs/RELEASING.md`](docs/RELEASING.md) for the full release runbook (secrets, signing, notarization, the PyInstaller framework workarounds, and disaster recovery).

A typical release looks like:

```bash
# Bump pyproject.toml + src-tauri/tauri.conf.json to vX.Y.Z
git tag -a vX.Y.Z -m "Picvert vX.Y.Z"
git push origin main vX.Y.Z
```

GitHub Actions then:

1. Runs `pytest -q` on each runner
2. Builds the Python sidecar (`pyinstaller engine.spec`)
3. Repairs PyInstaller framework artifacts (install_name + de-symlink + strip ad-hoc sigs)
4. Three-pass codesigns the entire sidecar
5. Builds + signs the Tauri bundle
6. Submits to Apple notarytool and staples
7. Generates `latest.json` with per-platform updater URLs + signatures
8. Publishes the GitHub Release

## Changelog · 更新日志

See [CHANGELOG.md](CHANGELOG.md).

## License · 许可证

[Apache-2.0](LICENSE). See LICENSE for details.

---

<div align="center">
<sub>Built with <a href="https://tauri.app">Tauri</a> · <a href="https://pyinstaller.org">PyInstaller</a> · <a href="https://pillow.readthedocs.io">Pillow</a> · <a href="https://pymupdf.io">PyMuPDF</a></sub>
</div>
