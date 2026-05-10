# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the picvert-engine sidecar binary.

Produces a single console executable that the Tauri shell will spawn as a
child process and drive over stdin/stdout JSON.

Build with:
    pyinstaller engine.spec --clean --noconfirm
"""
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = (
    collect_submodules("pillow_heif")
    + collect_submodules("docx")
    + collect_submodules("openpyxl")
    + collect_submodules("PIL")
)

a = Analysis(
    ["picvert/cli.py"],
    pathex=[],
    binaries=[],
    datas=[],
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
    a.binaries,
    a.datas,
    [],
    name="picvert-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,         # sidecar — must keep stdin/stdout
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
