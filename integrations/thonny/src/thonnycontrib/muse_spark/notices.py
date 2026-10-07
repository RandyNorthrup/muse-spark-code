"""User notices (errors the plugin must surface, nothing more).

The plugin is quiet on success and speaks only to report a failure it
cannot fix: a missing runtime, a refused companion URL, a dead stop call.
``tkinter.messagebox`` is imported lazily inside the defaults so importing
this package (and the test suite) never needs a display.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


def _messagebox_error(title: str, message: str) -> None:
    from tkinter import messagebox

    messagebox.showerror(title, message)


def _messagebox_info(title: str, message: str) -> None:
    from tkinter import messagebox

    messagebox.showinfo(title, message)


@dataclass
class Notices:
    """Injectable notice sink. Tests record; Thonny shows message boxes."""

    show_error: Callable[[str, str], None] = _messagebox_error
    show_info: Callable[[str, str], None] = _messagebox_info
