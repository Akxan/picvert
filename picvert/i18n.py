"""Translations and the `_()` lookup function.

The current language lives on the module, mutated via `set_language(lang)`.
"""
from __future__ import annotations

import locale
from typing import Iterable

from .config import load_config

SUPPORTED_LANGS: tuple[str, ...] = ("en", "es", "ru", "zh")

translations: dict[str, dict[str, str]] = {
    "en": {
        "menu_help": "Help",
        "menu_supported_formats": "Supported Formats",
        "menu_about": "About",
        "menu_language": "Language",
        "lang_english": "English",
        "lang_spanish": "Spanish",
        "lang_russian": "Russian",
        "lang_chinese": "Chinese",
        "msg_file_added_success": "Added {n} files.",
        "msg_invalid_file": "No valid image, Excel, Word, CSV or PDF files were dropped.",
        "msg_select_files": "Selected {n} files.",
        "msg_select_output_folder": "Output folder: {folder}",
        "msg_warning_no_file": "Please add files first!",
        "msg_warning_no_output": "Please choose an output folder!",
        "msg_convert_complete": "Successfully converted {n} files (or pages).",
        "msg_conflict": "Another instance is already running. Please do not start multiple instances.",
        "label_instruction": "Please drag and drop images below, or use the button to select files",
        "label_drop_area": "Drop files here",
        "btn_select_files": "Select Files",
        "btn_select_output": "Select Output Folder",
        "label_output_format": "Output Format:",
        "btn_convert": "Start Conversion",
        "msg_supported_formats": "Supported input formats:\n{inputs}\n\nSupported output formats:\n{outputs}",
        "msg_about": "Picvert — Batch Image Converter\n\nAuthor: Julio\nVersion: {version}",
        "label_all_files": "All files: {n}",
        "btn_clear_all": "Clear All",
        "window_title": "Picvert",
    },
    "es": {
        "menu_help": "Ayuda",
        "menu_supported_formats": "Formatos Soportados",
        "menu_about": "Acerca de",
        "menu_language": "Idioma",
        "lang_english": "Inglés",
        "lang_spanish": "Español",
        "lang_russian": "Ruso",
        "lang_chinese": "Chino",
        "msg_file_added_success": "Se han añadido {n} archivos.",
        "msg_invalid_file": "Ningún archivo válido fue arrastrado.",
        "msg_select_files": "Se han seleccionado {n} archivos.",
        "msg_select_output_folder": "Carpeta de salida: {folder}",
        "msg_warning_no_file": "¡Por favor, añade archivos primero!",
        "msg_warning_no_output": "¡Por favor, elige una carpeta de salida!",
        "msg_convert_complete": "Se han convertido exitosamente {n} archivos (o páginas).",
        "msg_conflict": "Otra instancia ya está en ejecución. Por favor, no abras múltiples instancias.",
        "label_instruction": "Arrastra y suelta imágenes, abajo, o usa el botón para seleccionar archivos",
        "label_drop_area": "Suelta los archivos aquí",
        "btn_select_files": "Seleccionar Archivos",
        "btn_select_output": "Seleccionar Carpeta de Salida",
        "label_output_format": "Formato de salida:",
        "btn_convert": "Iniciar Conversión",
        "msg_supported_formats": "Formatos de entrada soportados:\n{inputs}\n\nFormatos de salida soportados:\n{outputs}",
        "msg_about": "Picvert — Conversor de Imágenes por Lotes\n\nAutor: Julio\nVersión: {version}",
        "label_all_files": "Todos los archivos: {n}",
        "btn_clear_all": "Borrar Todo",
        "window_title": "Picvert",
    },
    "ru": {
        "menu_help": "Справка",
        "menu_supported_formats": "Поддерживаемые форматы",
        "menu_about": "О программе",
        "menu_language": "Язык",
        "lang_english": "Английский",
        "lang_spanish": "Испанский",
        "lang_russian": "Русский",
        "lang_chinese": "Китайский",
        "msg_file_added_success": "Добавлено {n} файлов.",
        "msg_invalid_file": "Перетащенные файлы не являются допустимыми.",
        "msg_select_files": "Выбрано {n} файлов.",
        "msg_select_output_folder": "Папка вывода: {folder}",
        "msg_warning_no_file": "Пожалуйста, сначала добавьте файлы!",
        "msg_warning_no_output": "Пожалуйста, выберите папку вывода!",
        "msg_convert_complete": "Успешно конвертировано {n} файлов (или страниц).",
        "msg_conflict": "Программа уже запущена. Пожалуйста, не запускайте несколько экземпляров.",
        "label_instruction": "Перетащите изображения или используйте кнопку для выбора файлов",
        "label_drop_area": "Перетащите файлы сюда",
        "btn_select_files": "Выбрать файлы",
        "btn_select_output": "Выбрать папку вывода",
        "label_output_format": "Формат вывода:",
        "btn_convert": "Начать конвертацию",
        "msg_supported_formats": "Поддерживаемые форматы ввода:\n{inputs}\n\nПоддерживаемые форматы вывода:\n{outputs}",
        "msg_about": "Picvert — Пакетный конвертер изображений\n\nАвтор: Julio\nВерсия: {version}",
        "label_all_files": "Все файлы: {n}",
        "btn_clear_all": "Очистить всё",
        "window_title": "Picvert",
    },
    "zh": {
        "menu_help": "帮助",
        "menu_supported_formats": "支持格式",
        "menu_about": "关于",
        "menu_language": "语言",
        "lang_english": "英文",
        "lang_spanish": "西班牙文",
        "lang_russian": "俄语",
        "lang_chinese": "中文",
        "msg_file_added_success": "已添加 {n} 个文件。",
        "msg_invalid_file": "拖入的文件中没有有效文件。",
        "msg_select_files": "已选择 {n} 个文件。",
        "msg_select_output_folder": "输出文件夹：{folder}",
        "msg_warning_no_file": "请先添加文件！",
        "msg_warning_no_output": "请先选择输出文件夹！",
        "msg_convert_complete": "成功转换 {n} 个文件（或页面）。",
        "msg_conflict": "程序已在运行，请勿多次启动。",
        "label_instruction": "请将图片拖拽到下方区域，或使用按钮选择文件",
        "label_drop_area": "将文件拖拽到此处",
        "btn_select_files": "选择文件",
        "btn_select_output": "选择输出文件夹",
        "label_output_format": "输出格式：",
        "btn_convert": "开始转换",
        "msg_supported_formats": "支持的输入格式：\n{inputs}\n\n支持的输出格式：\n{outputs}",
        "msg_about": "Picvert — 批量图片转换工具\n\n作者: Julio\n版本: {version}",
        "label_all_files": "所有文件为: {n}",
        "btn_clear_all": "清除所有",
        "window_title": "Picvert",
    },
}


def _detect_default_language() -> str:
    try:
        loc = locale.getlocale()
        sys_lang = (loc[0] or "en")[:2]
    except Exception:
        sys_lang = "en"
    return sys_lang if sys_lang in SUPPORTED_LANGS else "en"


current_lang: str = load_config().get("language", _detect_default_language())


def set_language(lang: str) -> None:
    global current_lang
    if lang not in SUPPORTED_LANGS:
        raise ValueError(f"Unsupported language: {lang}")
    current_lang = lang


def _(key: str, **kwargs) -> str:
    text = translations.get(current_lang, translations["en"]).get(key, key)
    return text.format(**kwargs)


def all_supported_languages() -> Iterable[str]:
    return SUPPORTED_LANGS
