"""Centralised logging configuration."""
from __future__ import annotations

import logging

from .paths import log_path


def configure_logging(level: int = logging.INFO) -> logging.Logger:
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(log_path(), encoding="utf-8"),
        ],
    )
    return logging.getLogger("picvert")
