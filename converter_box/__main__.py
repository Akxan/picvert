"""Entry point: `python -m converter_box` or the `converter-box` console script."""
from __future__ import annotations

import sys
import tkinter as tk
from tkinter import messagebox

from .i18n import _
from .logging_setup import configure_logging
from .single_instance import acquire_lock


def main() -> int:
    logger = configure_logging()

    lock = acquire_lock()
    if lock is None:
        # Another instance is running — show a warning then exit.
        temp = tk.Tk()
        temp.withdraw()
        messagebox.showwarning("Warning", _("msg_conflict"))
        return 0

    try:
        # Imported lazily so headless tests / CI can `import converter_box` without Tk + DnD.
        from .gui import run_app
        logger.info("Starting Converter BOX")
        run_app()
    finally:
        lock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
