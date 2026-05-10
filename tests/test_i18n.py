"""i18n module: language switching and translation lookup."""
from __future__ import annotations

import pytest

from picvert import i18n


@pytest.fixture(autouse=True)
def _restore_lang():
    """Snapshot and restore current_lang so tests don't bleed into each other."""
    original = i18n.current_lang
    yield
    i18n.current_lang = original


def test_switch_to_zh_changes_translation() -> None:
    i18n.set_language("zh")
    assert i18n._("btn_convert") == "开始转换"


def test_switch_to_es_changes_translation() -> None:
    i18n.set_language("es")
    assert i18n._("btn_convert") == "Iniciar Conversión"


def test_unknown_lang_raises() -> None:
    with pytest.raises(ValueError):
        i18n.set_language("xx")


def test_unknown_key_returns_key_itself() -> None:
    """Translation lookup is forgiving — a missing key returns the key, not None."""
    i18n.set_language("en")
    assert i18n._("definitely_not_a_real_key") == "definitely_not_a_real_key"


def test_format_substitution() -> None:
    i18n.set_language("en")
    assert i18n._("msg_file_added_success", n=3) == "Added 3 files."


def test_window_title_capitalised_in_all_langs() -> None:
    """The brand name should not be translated."""
    for lang in i18n.SUPPORTED_LANGS:
        i18n.set_language(lang)
        assert i18n._("window_title") == "Picvert"
