"""Namespace coexistence: our pkgutil ``thonnycontrib`` shares the path.

A second installed plug-in may ship its own ``thonnycontrib/`` directory
with no ``__init__.py`` at all. Both path orders must resolve both
plug-ins. In-process ``importlib`` only: no child process, no socket.
"""

import importlib
import sys
from pathlib import Path

OUR_SRC = str(Path(__file__).resolve().parents[1] / "src")


def _scrub_there():
    for name in [key for key in sys.modules
                 if key == "thonnycontrib" or key.startswith("thonnycontrib.")]:
        del sys.modules[name]


def _import_both():
    spark = importlib.import_module("thonnycontrib.muse_spark.protocol")
    other = importlib.import_module("thonnycontrib.other_plugin")
    assert Path(spark.__file__).resolve().is_relative_to(Path(OUR_SRC).resolve())
    return other


def _check_order(first, second, tmp_path):
    saved = list(sys.path)
    sys.path[:] = [first, second] + saved
    try:
        _scrub_there()
        other = _import_both()
        assert Path(other.__file__).resolve().is_relative_to(tmp_path.resolve())
    finally:
        sys.path[:] = saved
        _scrub_there()


def test_namespace_coexists_with_init_less_plugin_in_both_orders(tmp_path):
    plugin = tmp_path / "thonnycontrib" / "other_plugin"
    plugin.mkdir(parents=True)
    (plugin / "__init__.py").write_text(
        'OTHER_PLUGIN_LOADED = True\n', encoding="utf-8")
    _check_order(OUR_SRC, str(tmp_path), tmp_path)
    _check_order(str(tmp_path), OUR_SRC, tmp_path)
