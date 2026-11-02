"""In-editor harness for the MuseSpark package (tests only).

Installed as Packages/MuseSparkHarness by test/test_in_editor.py inside
a scratch Sublime profile. It drives the real MuseSpark commands
against the real agent and records its checks as JSON for the outer
runner, which then stops the editor. Nothing in the package under
test is replaced.

Threading, measured in this editor: the plugin host has one async
thread (the package's exit watcher needs it), and a refusal's
sublime.error_message dialog holds the main thread until dismissed.
So commands run in one short main-thread phase, and a plain Python
thread observes the outcomes (the watcher's ownership cleanup pops
before its dialog). Refusal paths that only a dismissed dialog would
release (duplicate start, unsafe URL, stop) are recorded as unproven
for an interactive in-editor run.
"""

import json
import os
import threading
import time

import sublime

RESULT = os.environ.get("MUSE_HARNESS_RESULT", "")
NODE = os.environ.get("MUSE_HARNESS_NODE", "")
AGENT = os.environ.get("MUSE_HARNESS_AGENT", "")
WORKSPACE = os.environ.get("MUSE_HARNESS_WORKSPACE", "")
OPENER = os.environ.get("MUSE_HARNESS_OPENER", "")
OPENER_RECORD = os.environ.get("MUSE_HARNESS_OPENER_RECORD", "")
WAIT_SECONDS = 60
URL = "http://127.0.0.1:41234/#k=test-launch"

_checks = []


def check(name, ok, detail=""):
    _checks.append({"name": name, "ok": bool(ok), "detail": str(detail)[:200]})


def write_result():
    with open(RESULT, "w", encoding="utf-8") as handle:
        json.dump({"checks": _checks}, handle)


def observe(pkg):
    deadline = time.time() + WAIT_SECONDS
    record = ""
    cleared = False
    while time.time() < deadline and (not record or not cleared):
        if not record and os.path.exists(OPENER_RECORD):
            with open(OPENER_RECORD, encoding="utf-8") as handle:
                record = handle.read()
        if not pkg._processes:
            cleared = True
        time.sleep(0.05)
    check("URL route reaches the opener with the exact URL", record == URL, record)
    check("refused child exit clears ownership", cleared)
    write_result()


def main_phase():
    try:
        import MuseSpark.muse_spark as pkg
    except Exception as error:  # the package did not load in this host
        check("package loads", False, repr(error))
        write_result()
        return
    check("package loads", True)
    try:
        check("launch URL guard accepts fragment", pkg.valid_launch_url(URL))
        check("launch URL guard refuses https",
              not pkg.valid_launch_url("https://127.0.0.1:41234/#k=test-launch"))
        env = pkg.clean_environment()
        check("sentinel present in editor env", "M104_API_KEY" in os.environ)
        check("environment scrub removes credentials",
              "M104_API_KEY" not in env and "HOME" in env)

        settings = sublime.load_settings("MuseSpark.sublime-settings")
        settings.set("command", [NODE, AGENT])
        settings.set("opener", ["/usr/bin/python3", OPENER])

        window = sublime.active_window() or sublime.new_window()
        window.set_project_data({"folders": [{"path": WORKSPACE}]})
        check("workspace folder set", window.folders() == [WORKSPACE],
              window.folders())

        window.run_command("muse_panel", {"url": URL})
        window.run_command("muse_panel")
        check("muse_panel owns a child", bool(pkg._processes))
        child = list(pkg._processes.values())[0]
        cmdline = ""
        if os.path.exists("/proc/%d/cmdline" % child.pid):
            with open("/proc/%d/cmdline" % child.pid, "rb") as handle:
                cmdline = handle.read().replace(b"\0", b" ").decode("utf-8", "replace")
        check("child is the real supervised companion",
              AGENT in cmdline and "supervise" in cmdline and "--companion" in cmdline,
              cmdline)
    except Exception as error:
        check("harness completes", False, repr(error))
        write_result()
        return
    threading.Thread(target=observe, args=(pkg,), daemon=True).start()


def plugin_loaded():
    if RESULT:
        sublime.set_timeout(main_phase, 500)
