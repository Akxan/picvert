"""Tkinter GUI: drag-and-drop, preview, batch conversion."""
from __future__ import annotations

import logging
import os
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox
from tkinter import ttk

from PIL import Image, ImageTk
from tkinterdnd2 import DND_FILES, TkinterDnD

from . import config as cfg
from . import i18n
from .constants import APP_VERSION, OUTPUT_FORMAT_LIST, SUPPORTED_EXTS
from .converters import UnsupportedConversion, convert_file
from .i18n import _, set_language, translations

logger = logging.getLogger(__name__)


class ImageConverterApp:
    """Main application window."""

    def __init__(self, master: tk.Tk) -> None:
        self.master = master
        master.title(_("window_title"))
        master.geometry("600x800")

        self.files: list[Path] = []
        self.output_folder: Path | None = None
        self.preview_images: list[ImageTk.PhotoImage] = []
        self.resize_after_id: str | None = None
        self._suspend_refresh = False

        self._build_menu()
        self._build_widgets()
        master.bind("<Configure>", self.on_master_configure)

    # ------------------------------------------------------------------ menu
    def _build_menu(self) -> None:
        self.menubar = tk.Menu(self.master)
        self.master.config(menu=self.menubar)

        help_menu = tk.Menu(self.menubar, tearoff=0)
        help_menu.add_command(label=_("menu_supported_formats"), command=self.show_supported_formats)
        help_menu.add_separator()
        help_menu.add_command(label=_("menu_about"), command=self.show_about)
        self.menubar.add_cascade(label=_("menu_help"), menu=help_menu)

        lang_menu = tk.Menu(self.menubar, tearoff=0)
        lang_menu.add_command(label=translations["en"]["lang_english"], command=lambda: self.set_language("en"))
        lang_menu.add_command(label=translations["es"]["lang_spanish"], command=lambda: self.set_language("es"))
        lang_menu.add_command(label=translations["ru"]["lang_russian"], command=lambda: self.set_language("ru"))
        lang_menu.add_command(label=translations["zh"]["lang_chinese"], command=lambda: self.set_language("zh"))
        self.menubar.add_cascade(label=_("menu_language"), menu=lang_menu)

    # --------------------------------------------------------------- widgets
    def _build_widgets(self) -> None:
        self.label = tk.Label(self.master, text=_("label_instruction"), font=("Arial", 12))
        self.label.pack(pady=10)

        self.drop_area = tk.Label(
            self.master, text=_("label_drop_area"),
            width=100, height=10, bg="lightgrey", relief="ridge",
        )
        self.drop_area.pack(pady=10)
        self.drop_area.drop_target_register(DND_FILES)
        self.drop_area.dnd_bind("<<Drop>>", self.drop)

        button_frame = tk.Frame(self.master)
        button_frame.pack(pady=20)

        self.select_files_button = tk.Button(button_frame, text=_("btn_select_files"), command=self.select_files)
        self.select_files_button.grid(row=0, column=0, padx=5)

        self.select_output_button = tk.Button(button_frame, text=_("btn_select_output"), command=self.select_output_folder)
        self.select_output_button.grid(row=0, column=1, padx=5)

        self.convert_button = tk.Button(button_frame, text=_("btn_convert"), command=self.start_conversion_thread)
        self.convert_button.grid(row=0, column=2, padx=5)

        self.clear_all_button = tk.Button(button_frame, text=_("btn_clear_all"), command=self.clear_all_files)
        self.clear_all_button.grid(row=0, column=3, padx=5)

        self.format_frame = tk.Frame(self.master)
        self.format_frame.pack(pady=10)
        self.format_label = tk.Label(self.format_frame, text=_("label_output_format"), font=("Arial", 12))
        self.format_label.pack(side=tk.LEFT, padx=5)
        self.format_var = tk.StringVar(value=OUTPUT_FORMAT_LIST[0])
        self.format_combobox = ttk.Combobox(
            self.format_frame, textvariable=self.format_var,
            values=OUTPUT_FORMAT_LIST, state="readonly", width=12,
        )
        self.format_combobox.pack(side=tk.LEFT)

        self.preview_count_label = tk.Label(self.master, text=_("label_all_files", n=0), font=("Arial", 12))
        self.preview_count_label.pack(pady=5)
        self.preview_detail_label = tk.Label(self.master, text="---", font=("Arial", 12))
        self.preview_detail_label.pack(pady=5)

        preview_frame = tk.Frame(self.master)
        preview_frame.pack(fill="both", expand=True, padx=10, pady=5)
        self.preview_canvas = tk.Canvas(preview_frame, bg="white")
        self.preview_canvas.pack(side="left", fill="both", expand=True)
        self.v_scrollbar = tk.Scrollbar(preview_frame, orient="vertical", command=self.preview_canvas.yview)
        self.v_scrollbar.pack(side="right", fill="y")
        self.h_scrollbar = tk.Scrollbar(self.master, orient="horizontal", command=self.preview_canvas.xview)
        self.h_scrollbar.pack(fill="x")
        self.preview_canvas.configure(yscrollcommand=self.v_scrollbar.set, xscrollcommand=self.h_scrollbar.set)
        self.preview_container = tk.Frame(self.preview_canvas, bg="white")
        self.preview_canvas.create_window((0, 0), window=self.preview_container, anchor="nw")
        self.preview_container.bind("<Configure>", self.on_frame_configure)

        self.progress = ttk.Progressbar(self.master, orient="horizontal", mode="determinate")
        self.progress.pack(fill="x", padx=10, pady=5)
        self.progress.pack_forget()

    # ------------------------------------------------------------ ui state
    def disable_ui(self) -> None:
        for btn in (self.select_files_button, self.select_output_button, self.convert_button, self.clear_all_button):
            btn.config(state="disabled")

    def enable_ui(self) -> None:
        for btn in (self.select_files_button, self.select_output_button, self.convert_button, self.clear_all_button):
            btn.config(state="normal")

    # ------------------------------------------------------------ language
    def set_language(self, lang: str) -> None:
        set_language(lang)
        self.master.title(_("window_title"))
        self.label.config(text=_("label_instruction"))
        self.drop_area.config(text=_("label_drop_area"))
        self.select_files_button.config(text=_("btn_select_files"))
        self.select_output_button.config(text=_("btn_select_output"))
        self.format_label.config(text=_("label_output_format"))
        self.convert_button.config(text=_("btn_convert"))
        self.clear_all_button.config(text=_("btn_clear_all"))
        self._build_menu()
        self.update_preview()
        config = cfg.load_config()
        config["language"] = lang
        cfg.save_config(config)
        logger.info("Language set to %s", lang)

    # --------------------------------------------------------- help dialogs
    def show_supported_formats(self) -> None:
        info = _(
            "msg_supported_formats",
            inputs=" ".join(SUPPORTED_EXTS),
            outputs=" ".join(OUTPUT_FORMAT_LIST),
        )
        messagebox.showinfo(_("menu_supported_formats"), info)

    def show_about(self) -> None:
        messagebox.showinfo(_("menu_about"), _("msg_about", version=APP_VERSION))

    # ------------------------------------------------------------- preview
    def on_frame_configure(self, _event) -> None:
        self.preview_canvas.configure(scrollregion=self.preview_canvas.bbox("all"))

    def on_master_configure(self, _event) -> None:
        if self._suspend_refresh:
            return
        if self.resize_after_id:
            self.master.after_cancel(self.resize_after_id)
        self.resize_after_id = self.master.after(500, self.update_preview)

    def update_preview(self) -> None:
        for widget in self.preview_container.winfo_children():
            widget.destroy()
        self.preview_images = []

        available_width = self.preview_canvas.winfo_width() or 550
        thumb_width, padding = 100, 10
        col_count = max(1, available_width // (thumb_width + padding))

        self.preview_count_label.config(text=_("label_all_files", n=len(self.files)))
        type_counts: dict[str, int] = {}
        for f in self.files:
            type_counts[f.suffix.lower()] = type_counts.get(f.suffix.lower(), 0) + 1
        self.preview_detail_label.config(
            text=" / ".join(f"{ext.upper()} ({n})" for ext, n in type_counts.items()) or "---"
        )

        max_name = 15
        for idx, file in enumerate(self.files):
            row, col = divmod(idx, col_count)
            frame = tk.Frame(self.preview_container, bg="white", bd=1, relief="solid")
            frame.grid(row=row, column=col, padx=5, pady=5, sticky="n")

            ext = file.suffix.lower()
            if ext not in {".pdf", ".docx", ".xlsx", ".csv"}:
                try:
                    with Image.open(file) as img:
                        img.thumbnail((thumb_width, 100))
                        photo = ImageTk.PhotoImage(img)
                        self.preview_images.append(photo)
                        tk.Label(frame, image=photo, bg="white").pack(padx=5, pady=5)
                except Exception as exc:
                    logger.error("Error previewing %s: %s", file, exc)
                    tk.Label(frame, text="Error", bg="white").pack(padx=5, pady=5)
            else:
                file_type = {".pdf": "PDF", ".docx": "DOC", ".xlsx": "EXCEL", ".csv": "CSV"}[ext]
                tk.Label(frame, text=file_type, bg="white", font=("Arial", 16)).pack(padx=5, pady=20)

            name = file.name
            base, ext_str = os.path.splitext(name)
            if len(name) > max_name:
                trimmed = max(0, max_name - len(ext_str) - 3)
                display_name = base[:trimmed] + "..." + ext_str
            else:
                display_name = name

            tk.Button(
                frame, text="✕", command=lambda f=file: self.remove_file(f),
                font=("Arial", 10), fg="white", bg="Green", bd=0, padx=4, pady=2,
            ).pack(side="top", anchor="ne", padx=2, pady=2)
            tk.Label(frame, text=display_name, bg="white", font=("Arial", 10)).pack(padx=2, pady=2)

    def remove_file(self, file: Path) -> None:
        if file not in self.files:
            return
        if self.resize_after_id:
            try:
                self.master.after_cancel(self.resize_after_id)
            except Exception:
                pass
            self.resize_after_id = None
        self._suspend_refresh = True
        self.files.remove(file)
        self.update_preview()
        self._suspend_refresh = False

    def clear_all_files(self) -> None:
        self.files.clear()
        self.update_preview()
        messagebox.showinfo(_("btn_clear_all"), _("msg_file_added_success", n=0))

    # ------------------------------------------------------- file selection
    def drop(self, event) -> None:
        dropped = self.master.tk.splitlist(event.data)
        valid = [Path(f) for f in dropped if Path(f).is_file() and Path(f).suffix.lower() in SUPPORTED_EXTS]
        if valid:
            self.files.extend(valid)
            messagebox.showinfo(_("btn_select_files"), _("msg_file_added_success", n=len(valid)))
            self.update_preview()
        else:
            messagebox.showwarning(_("btn_select_files"), _("msg_invalid_file"))

    def select_files(self) -> None:
        file_types = [
            ("All Supported Files", tuple("*" + ext for ext in SUPPORTED_EXTS)),
            ("Images", ("*.png", "*.jpg", "*.jpeg", "*.jfif", "*.bmp", "*.gif",
                        "*.tiff", "*.webp", "*.ico", "*.ppm", "*.tga", "*.jp2",
                        "*.svg", "*.heic")),
            ("PDF", "*.pdf"),
            ("Excel", "*.xlsx"),
            ("Word", "*.docx"),
            ("CSV", "*.csv"),
        ]
        selected = filedialog.askopenfilenames(title=_("btn_select_files"), filetypes=file_types)
        if selected:
            self.files.extend(Path(f) for f in selected)
            messagebox.showinfo(_("btn_select_files"), _("msg_select_files", n=len(selected)))
            self.update_preview()

    def select_output_folder(self) -> None:
        folder = filedialog.askdirectory(title=_("btn_select_output"))
        if folder:
            self.output_folder = Path(folder)
            messagebox.showinfo(_("btn_select_output"), _("msg_select_output_folder", folder=str(self.output_folder)))
            logger.info("Output folder set to %s", self.output_folder)

    # ----------------------------------------------------------- conversion
    def start_conversion_thread(self) -> None:
        if not self.files:
            messagebox.showwarning(_("btn_convert"), _("msg_warning_no_file"))
            return
        if not self.output_folder:
            messagebox.showwarning(_("btn_convert"), _("msg_warning_no_output"))
            return
        self.disable_ui()
        self.progress.pack(fill="x", padx=10, pady=5)
        self.progress["maximum"] = len(self.files)
        self.progress["value"] = 0
        threading.Thread(target=self.convert_files, daemon=True).start()

    def convert_files(self) -> None:
        count = 0
        errors: list[str] = []
        selected_format = self.format_var.get().upper()
        for file in self.files:
            try:
                count += convert_file(file, self.output_folder, selected_format)
            except UnsupportedConversion as exc:
                errors.append(str(exc))
                logger.error("Unsupported: %s", exc)
            except Exception as exc:
                msg = f"Error converting {file}: {exc}"
                logger.error(msg)
                errors.append(msg)
            self.master.after(0, self.progress.step, 1)
        self.master.after(0, lambda: self.conversion_complete(count, errors))

    def conversion_complete(self, count: int, errors: list[str]) -> None:
        messagebox.showinfo(_("btn_convert"), _("msg_convert_complete", n=count))
        if errors:
            messagebox.showerror("Conversion Errors", "\n".join(errors))
        self.files.clear()
        self.update_preview()
        self.progress.pack_forget()
        self.enable_ui()


def run_app() -> None:
    """Build the Tk root and start the mainloop."""
    root = TkinterDnD.Tk()
    try:
        ico = ImageTk.PhotoImage(file="2.ico")
        root.iconphoto(True, ico)
    except Exception as exc:
        logger.debug("Window icon not set: %s", exc)
    ImageConverterApp(root)
    root.mainloop()
