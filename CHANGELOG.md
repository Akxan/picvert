# Changelog

All notable changes to **Picvert** are documented here.
Version numbers follow [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-05-11

### Added
- **JPEG / WEBP quality slider** (60–100, default 90). Saved across launches.
  Visually-lossless 90 produces ≈half the file size of the previous fixed 100.
- **Max width input** (px) — proportionally downscale every output. Useful for
  exporting phone photos at web/social sizes.
- **Drop folders** — dragging a folder onto the dropzone (or capsule) now
  recursively expands it to all supported files. Capped at 5000 files / drop.
- **Progressive + optimized JPEG encoding** (`optimize=True, progressive=True`).
- **WEBP encoding now respects the quality slider** with `method=6`
  (best compression effort).

### Changed
- PDF page render path also honours `quality` and `max_dim` (was hard-coded
  to PDF's 100% quality and original render size).
- `engine_cancel` now actually kills the sidecar — multi-page PDF
  conversions are interrupted immediately. The engine respawns on next
  request (~0.17 s onedir cold start).
- File picker switched from HTML `<input type="file">` to Tauri's native
  dialog (`pick_input_files`) so the engine receives real absolute paths
  on every platform.

### Fixed
- **SSRF in `http_get_text`**: now host-allowlisted to the three weather/geo
  APIs and HTTPS-only. Was previously a generic Rust-side fetch tunnel.
- **Engine-death recovery**: when the sidecar crashes, all in-flight
  awaits get a clean `engine_died` error and the next call respawns
  rather than hanging forever.
- PDF open failure no longer silently returns `written: 0` — now surfaces
  as an `internal` error in the UI status row.

### Removed
- Tk-era leftovers: `picvert/i18n.py`, `picvert/config.py`,
  `picvert/paths.py`, `picvert/logging_setup.py`,
  `picvert/single_instance.py` (and their tests). The Python side is now
  ~370 lines smaller.
- Unused i18n keys, dead `picvert:show-help` listener, redundant
  `shell:allow-execute` capability, unused `geocoding-api.open-meteo.com`
  CSP entry, `platformdirs` dependency.

## [1.1.0] — 2026-05-10

### Added
- Cross-platform tray icons (macOS template / Windows / Linux variants).
- Capsule ↔ main window scale + fade animations.
- Real document conversion across DOCX ↔ XLSX ↔ CSV (six directions).
- HEIC read / write via `pillow-heif`.
- Compact-mode floating widget with live time + IP-based weather.
- macOS menu bar tray with multi-language menu, About + Check for Updates.
- Keyboard shortcuts: ⌘O, ⌘⏎, ⌘L, ⌘.
- Toast notifications + system notifications on batch completion.
- Help dialog with supported-format chips.
- Persistent picvert-engine sidecar in `--line-mode` for ~38× faster
  per-call latency vs `--onefile`.

### Changed
- Switched PyInstaller from `--onefile` to `--onedir`: cold start
  6.5 s → 0.17 s.

## [1.0.0] — 2026-05-09

Initial monolithic release (Tk GUI). Retired in favour of Tauri shell + Python
sidecar in 1.1.0.
