"""User-config persistence (currently only the language preference)."""
from __future__ import annotations

import json
import logging

from .paths import config_path

logger = logging.getLogger(__name__)


def load_config() -> dict:
    cfg = config_path()
    if cfg.exists():
        try:
            with cfg.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.error("Error loading config: %s", exc)
    return {}


def save_config(config: dict) -> None:
    try:
        with config_path().open("w", encoding="utf-8") as f:
            json.dump(config, f, indent=4)
    except Exception as exc:
        logger.error("Error saving config: %s", exc)
