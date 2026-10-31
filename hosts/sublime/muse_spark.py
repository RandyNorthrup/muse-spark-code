"""Muse Spark Code (Unofficial): editor commands for the shared companion."""

import os
import re
import subprocess
import sys

import sublime
import sublime_plugin

try:
    from LSP.plugin import AbstractPlugin, register_plugin, unregister_plugin
except ImportError:
    AbstractPlugin = None

if AbstractPlugin is not None:
    class MuseSparkLspPlugin(AbstractPlugin):
        """Native LSP package adapter; LSP owns buffers, completion and edit UI."""

        @classmethod
        def name(cls):
            return "LSP-muse-spark"

        @classmethod
        def on_pre_start(cls, window, initiating_view, workspace_folders, configuration):
            # LSP merges this map with inherited env; empty every credential value.
            configuration.env.update({name: "" for name in os.environ
                                      if name.upper().endswith("_API_KEY")
                                      or name.upper() in _FORBIDDEN})


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
_STOP_TIMEOUT_SECONDS = 15


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


def runtime_command(command, verb, supervised=False):
    """Preserve a Node/script prefix; place the runtime verb before its flags."""
    split = 2 if len(command) > 1 and not command[1].startswith("-") else 1
    return [*command[:split], *(["supervise"] if supervised else []),
            *([verb] if verb else []), *command[split:]]


def stop_workspace(window):
    """Stop the private workspace owner through an independent bounded process."""
    folders = window.folders()
    if not folders:
        return
    command = sublime.load_settings("MuseSpark.sublime-settings").get(
        "command", ["muse-spark-code-acp"])
    if not isinstance(command, list) or not command or not all(
            isinstance(arg, str) and arg for arg in command):
        raise ValueError("EPANEL_COMMAND")
    result = subprocess.run(runtime_command(command, "stop"), cwd=folders[0],
                            env=clean_environment(), shell=False,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=_STOP_TIMEOUT_SECONDS,
                            check=False)
    if result.returncode != 0:
        raise OSError("EPANEL_STOP")


def _watch(window_id, child):
    code = child.wait()

    def finished():
        if window_id is None:
            if code != 0:
                sublime.error_message("EPANEL_LAUNCH")
            return
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
                child = _spawn([*opener, url])
                sublime.set_timeout_async(lambda: _watch(None, child))
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
            child = _spawn([*runtime_command(command, "panel", True), "--companion"], cwd=folders[0])
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
        def control():
            try:
                stop_workspace(self.window)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                sublime.set_timeout(lambda: sublime.error_message("EPANEL_STOP"))
        sublime.set_timeout_async(control)
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


def plugin_loaded():
    """Register editor services when the optional native LSP package is installed."""
    if AbstractPlugin is not None:
        register_plugin(MuseSparkLspPlugin)


def plugin_unloaded():
    """Stop owned runtimes on package reload or removal."""
    if AbstractPlugin is not None:
        unregister_plugin(MuseSparkLspPlugin)
    for window_id, running in list(_processes.items()):
        try:
            if running.poll() is None:
                running.terminate()
            if _processes.get(window_id) is running:
                _processes.pop(window_id)
        except OSError:
            # One failed window must not prevent cleanup of the remaining windows.
            sublime.error_message("EPANEL_STOP")
