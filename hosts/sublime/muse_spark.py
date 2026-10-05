"""Muse Spark Code (Unofficial): editor commands for the shared companion."""

import os
import re
import subprocess
import sys

import sublime
import sublime_plugin

_FORBIDDEN = frozenset(
    (
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "OPENAI_KEY",
        "ANTHROPIC_KEY",
        "META_KEY",
    )
)
_LAUNCH = re.compile(r"http://(?:127\.0\.0\.1|\[::1\]):([0-9]+)/#k=[A-Za-z0-9_-]+")
_processes = {}


def clean_environment():
    """Copy the environment, omitting credentials by case-insensitive name."""
    return {
        name: value
        for name, value in os.environ.items()
        if not name.upper().endswith("_API_KEY") and name.upper() not in _FORBIDDEN
    }


def valid_launch_url(url):
    """Validate an authored fragment launch URL before opening a browser."""
    match = _LAUNCH.fullmatch(url) if isinstance(url, str) else None
    return bool(match and 0 < int(match[1]) <= 65535)


def _spawn(argv, cwd=None):
    return subprocess.Popen(
        argv,
        cwd=cwd,
        env=clean_environment(),
        shell=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _watch(window_id, child):
    code = child.wait()

    def finished():
        if _processes.get(window_id) is child:
            _processes.pop(window_id)
            if code != 0:
                sublime.error_message("EPANEL_EXIT")

    sublime.set_timeout(finished)


class MusePanelCommand(sublime_plugin.WindowCommand):
    """Start this window's companion, or open its fresh ACP /panel link."""

    def run(self, url=None):
        try:
            settings = sublime.load_settings("MuseSpark.sublime-settings")
            if url is not None:
                if not valid_launch_url(url):
                    raise ValueError("EPANEL_LAUNCH_URL")
                opener = settings.get("opener")
                if not opener:
                    opener = ["open"] if sys.platform == "darwin" else ["xdg-open"]
                    if sys.platform == "win32":
                        raise ValueError("EPANEL_OPENER_REQUIRED")
                if (
                    not isinstance(opener, list)
                    or not opener
                    or not all(isinstance(arg, str) and arg for arg in opener)
                ):
                    raise ValueError("EPANEL_OPENER_REQUIRED")
                _spawn([*opener, url])
                return
            running = _processes.get(self.window.id())
            if running is not None and running.poll() is None:
                raise ValueError("EPANEL_ALREADY_RUNNING")
            command = settings.get("command", ["muse-spark-code-acp"])
            if (
                not isinstance(command, list)
                or not command
                or not all(isinstance(arg, str) and arg for arg in command)
            ):
                raise ValueError("EPANEL_COMMAND")
            folders = self.window.folders()
            if not folders:
                raise ValueError("EPANEL_WORKSPACE_REQUIRED")
            child = _spawn([*command, "panel", "--companion"], cwd=folders[0])
            window_id = self.window.id()
            _processes[window_id] = child
            sublime.set_timeout_async(lambda: _watch(window_id, child))
        except (OSError, ValueError):
            # No URL, launch code, raw provider error or profile path in logs.
            sublime.error_message("EPANEL_LAUNCH")


class MuseStopCommand(sublime_plugin.WindowCommand):
    """Terminate only this window's companion runtime."""

    def run(self):
        window_id = self.window.id()
        running = _processes.get(window_id)
        try:
            if running is not None and running.poll() is None:
                running.terminate()
            _processes.pop(window_id, None)
        except OSError:
            sublime.error_message("EPANEL_STOP")


class MuseLifecycle(sublime_plugin.EventListener):
    """Release the companion when its editor window closes."""

    def on_pre_close_window(self, window):
        MuseStopCommand(window).run()


def plugin_unloaded():
    """Stop owned runtimes on package reload or removal."""
    for running in list(_processes.values()):
        if running.poll() is None:
            running.terminate()
    _processes.clear()
