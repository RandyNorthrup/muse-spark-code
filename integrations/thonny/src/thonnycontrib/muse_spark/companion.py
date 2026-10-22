"""Opening the companion page in the system browser.

The companion server speaks only loopback HTTP (D83.16). The plugin opens
``<base>#launch=<code>`` with the launch code in the URL *fragment*: a
fragment never leaves the browser (no query string, no cookie), and the
page's own API calls then carry the bearer in the ``Authorization`` header.

Guards, both red-drilled:

* the base URL must be loopback (``127.0.0.1``, ``localhost`` or ``::1``)
  over ``http`` or ``https`` — anything else is refused;
* an empty launch code is refused;
* the code is percent-encoded into the fragment and never appears in the
  query string.
"""

from __future__ import annotations

import webbrowser
from typing import Callable
from urllib.parse import quote, urlsplit

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


class CompanionError(Exception):
    """The companion endpoint is missing, malformed or not loopback."""


def is_loopback_url(url: str) -> bool:
    """True only for http(s) URLs on a loopback host."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https"):
        return False
    host = (parts.hostname or "").lower().strip("[]")
    return host in LOOPBACK_HOSTS


def build_companion_url(base_url: str, launch_code: str) -> str:
    """Join a runtime-announced base URL with its launch code.

    Raises :class:`CompanionError` for a non-loopback base, an empty code,
    or a base that already carries a fragment (the runtime must not smuggle
    anything past the plugin into the browser's address bar).
    """
    if not is_loopback_url(base_url):
        raise CompanionError("companion URL is not loopback: %r" % (base_url,))
    if not isinstance(launch_code, str) or not launch_code:
        raise CompanionError("companion launch code is empty")
    parts = urlsplit(base_url)
    if parts.fragment:
        raise CompanionError("companion URL already carries a fragment")
    return base_url.split("#")[0] + "#launch=" + quote(launch_code, safe="")


def open_companion(
    base_url: str,
    launch_code: str,
    opener: Callable[[str], bool] = webbrowser.open,
) -> str:
    """Build the companion URL and open it. Returns the opened URL."""
    url = build_companion_url(base_url, launch_code)
    try:
        opened = opener(url)
    except Exception as exc:
        raise CompanionError("browser could not open companion page") from exc
    if not opened:
        raise CompanionError("browser could not open companion page")
    return url
