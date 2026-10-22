"""The shipped gettext resources cover the UI in every repository language."""

import ast
import gettext
import json
from pathlib import Path
import runpy

import pytest

from thonnycontrib.muse_spark import Plugin, l10n
from thonnycontrib.muse_spark.runtime import RuntimeMissing

from .fakes import FakeWorkbench
from .test_plugin import FakeController, FakeNotices

ROOT = Path(__file__).resolve().parents[3]
LOCALE = Path(l10n.__file__).parent / "locale"
LANGUAGES = {"cs": "cs_CZ", "de": "de_DE", "es": "es_ES", "fr": "fr_FR",
             "hu": "hu_HU", "it": "it_IT", "ja": "ja_JP", "ko": "ko_KR",
             "pl": "pl_PL", "pt-br": "pt_BR", "ru": "ru_RU", "tr": "tr_TR",
             "zh-cn": "zh_CN", "zh-tw": "zh_TW"}


def _messages():
    """Read the plugin's actual menu and failure msgids so omissions fail."""
    tree = ast.parse((Path(l10n.__file__).parent / "__init__.py").read_text())
    messages = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in
                                               ("LABEL_OPEN", "LABEL_STOP", "CAPTION_STOP", "LABEL_HAND", "LABEL_BACK")
                                               for target in node.targets):
            messages.add(ast.literal_eval(node.value))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "_fail":
            messages.update(ast.literal_eval(arg) for arg in node.args)
    return messages


@pytest.mark.parametrize("language,code", LANGUAGES.items())
def test_catalogue_covers_every_user_message_and_matches_stop_terminology(language, code):
    translation = gettext.translation("muse_spark", LOCALE, languages=[code])
    messages = _messages()
    assert len(messages) == 15
    assert set(translation._catalog) - {""} == messages
    for message in messages:
        assert translation.gettext(message) and translation.gettext(message) != message
    extension = json.loads((ROOT / "l10n" / ("ui." + language + ".json")).read_text(encoding="utf-8"))
    assert translation.gettext("Stop") == extension["stopTitle"]


def test_gettext_language_set_matches_repository():
    assert set(LANGUAGES) == {path.stem.removeprefix("ui.") for path in (ROOT / "l10n").glob("ui.*.json")}
    assert len(list(LOCALE.glob("*/LC_MESSAGES/muse_spark.mo"))) == len(LANGUAGES)


@pytest.mark.parametrize("language,code", LANGUAGES.items())
def test_menus_and_failures_use_current_thonny_language(language, code):
    workbench = FakeWorkbench()
    notices = FakeNotices()
    plugin = Plugin(workbench, controller=FakeController(start_error=RuntimeMissing("raw technical detail")),
                    notices=notices, register_exit=lambda _: None)
    workbench.language = code
    workbench.run_after_inline = False
    plugin.register()
    translation = gettext.translation("muse_spark", LOCALE, languages=[code])
    assert workbench.commands[0]["command_label"] == translation.gettext("Open Muse Spark")
    assert workbench.commands[1]["command_label"] == translation.gettext("Stop machine")
    assert workbench.commands[1]["kwargs"]["caption"] == translation.gettext("Stop")
    # Switch after construction/registration: notices must use the current language.
    workbench.language = "de_DE" if code != "de_DE" else "ja_JP"
    translated = gettext.translation("muse_spark", LOCALE, languages=[workbench.language])
    workbench.run_after_inline = True
    plugin._open_worker()
    assert notices.errors == [("Muse Spark: " + translated.gettext("Cannot start Muse Spark"),
                               translated.gettext("The runtime could not start. Check its installation and try again."))]


def test_unsupported_language_uses_english_and_chinese_aliases_resolve():
    workbench = FakeWorkbench()
    for code, expected in (("en_US", "Open Muse Spark"), ("unsupported", "Open Muse Spark"),
                           ("zh_Hans", "打开 Muse Spark"), ("zh_Hant", "開啟 Muse Spark")):
        workbench.language = code
        assert l10n.text(workbench, "Open Muse Spark") == expected


def test_compiled_catalogues_match_po_sources(tmp_path):
    compiler = runpy.run_path(str(ROOT / "integrations/thonny/scripts/compile_catalogs.py"))["compile_catalogue"]
    for path in LOCALE.glob("*/LC_MESSAGES/muse_spark.po"):
        copied = tmp_path / (path.parents[1].name + ".po")
        copied.write_bytes(path.read_bytes())
        compiler(copied)
        assert copied.with_suffix(".mo").read_bytes() == path.with_suffix(".mo").read_bytes()
