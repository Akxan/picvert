"""Per-user file locations.

Wraps `platformdirs` so other modules don't have to think about
macOS / Windows / Linux differences. The directories are created
on first call, never on import.
"""
from __future__ import annotations

from pathlib import Path

from platformdirs import user_config_dir, user_log_dir

from .constants import APP_AUTHOR, APP_NAME


def config_path() -> Path:
    """Return the user-config JSON path, creating the parent dir if needed."""
    base = Path(user_config_dir(APP_NAME, APP_AUTHOR))
    base.mkdir(parents=True, exist_ok=True)
    return base / "config.json"


def log_path() -> Path:
    """Return the user-log file path, creating the parent dir if needed."""
    base = Path(user_log_dir(APP_NAME, APP_AUTHOR))
    base.mkdir(parents=True, exist_ok=True)
    return base / "app.log"
