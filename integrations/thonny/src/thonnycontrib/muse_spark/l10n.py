"""Plugin gettext, selected from Thonny's installed language at use time."""

import gettext
from functools import lru_cache
from pathlib import Path

CATALOGUE_CACHE_SIZE = 32


@lru_cache(maxsize=CATALOGUE_CACHE_SIZE)
def _catalogue(code):
    code = code.replace("-", "_")
    parts = code.split("_")
    code = parts[0].lower() + ("_" + parts[1].upper() if len(parts) > 1 else "")
    code = {"zh_HANS": "zh_CN", "zh_HANT": "zh_TW"}.get(code, code)
    return gettext.translation("muse_spark", Path(__file__).parent / "locale",
                               languages=[code], fallback=True)


def text(workbench, message):
    """Read the host preference on each action; unsupported languages use English."""
    code = workbench.get_option("general.language") or "en_US"
    return _catalogue(code).gettext(message)
