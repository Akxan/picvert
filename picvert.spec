# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Picvert.

Build with:
    python build_app.py

Or directly:
    pyinstaller picvert.spec --clean --noconfirm
"""
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# tkinterdnd2 ships its tcl/tk drop scripts as data — they must be bundled.
datas = collect_data_files("tkinterdnd2")

# Hidden imports keep tooling from missing dynamically-loaded plugins.
hiddenimports = (
    collect_submodules("pillow_heif")
    + collect_submodules("docx")
    + collect_submodules("openpyxl")
)


a = Analysis(
    ["picvert/__main__.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tests"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Picvert",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # GUI app — no terminal window
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="Picvert",
)

# macOS .app bundle.
app = BUNDLE(
    coll,
    name="Picvert.app",
    icon=None,
    bundle_identifier="com.akxan.picvert",
    info_plist={
        "CFBundleDisplayName": "Picvert",
        "CFBundleShortVersionString": "1.1.0",
        "CFBundleVersion": "1.1.0",
        "NSHighResolutionCapable": True,
    },
)
