# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the picvert-engine sidecar binary.

Produces dist/picvert-engine/  (a folder, --onedir mode), because
--onefile would self-extract to /tmp on every spawn and cost ~6.5 s of
cold-start latency. --onedir keeps everything pre-extracted so cold
start drops to ~0.3 s — visible UX improvement on every launch.

The Tauri shell ships this folder as `bundle.resources` and spawns
`<resource_dir>/engine/picvert-engine` directly.

Build with:
    pyinstaller engine.spec --clean --noconfirm
"""
from PyInstaller.utils.hooks import collect_submodules, copy_metadata

hiddenimports = (
    collect_submodules("pillow_heif")
    + collect_submodules("docx")
    + collect_submodules("openpyxl")
    + collect_submodules("PIL")
)

# Bundle picvert's dist-info so importlib.metadata.version("picvert") works
# inside the frozen binary — that's how constants.APP_VERSION sources the
# version string the UI shows in the bottom-left status pill.
datas = copy_metadata("picvert")

a = Analysis(
    ["picvert/cli.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "tkinterdnd2",
        "tests",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,        # --onedir: deps live alongside, not inside
    name="picvert-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,                 # sidecar — must keep stdin/stdout
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="picvert-engine",        # → dist/picvert-engine/
)
