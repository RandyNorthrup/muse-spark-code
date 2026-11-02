"""The MuseSpark package inside real Sublime Text, on the real agent.

Installs the shipped package into a scratch Sublime profile, starts the
editor under Xvfb, and lets the harness package drive its commands
against this tree's dist/acp.js (run `npm run build` first). Skips
where Sublime Text or Xvfb is absent.

The shipped package asks for the Python 3.14 plugin host (Sublime
build 4205+). On an older editor the installed copy's version marker
is lowered to the newest host that build ships, so the identical
plugin code runs; the 3.14 host itself is qualified on build 4205+.
"""

import glob
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).parent
PACKAGE = HERE.parent
ROOT = PACKAGE.parents[1]
AGENT = ROOT / "dist" / "acp.js"
NODE = shutil.which("node")
SUBL = shutil.which("subl")
XVFB = shutil.which("xvfb-run")


def sublime_binary():
    for candidate in ("/opt/sublime_text/sublime_text",):
        if os.path.exists(candidate):
            return candidate
    return SUBL


def sublime_build():
    try:
        out = subprocess.run([SUBL, "--version"], capture_output=True,
                             text=True, timeout=30).stdout
    except (OSError, subprocess.TimeoutExpired):
        return 0
    match = re.search(r"Build (\d+)", out)
    return int(match.group(1)) if match else 0


@unittest.skipUnless(SUBL and XVFB, "needs Sublime Text and xvfb-run")
class InEditorTests(unittest.TestCase):
    def test_package_in_sublime(self):
        if NODE is None:
            self.skipTest("node is required")
        if not AGENT.is_file():
            self.fail("dist/acp.js missing: run npm run build first")
        with tempfile.TemporaryDirectory(prefix="muse-sublime-") as directory:
            base = Path(directory)
            home = base / "home"
            workspace = base / "workspace"
            workspace.mkdir(parents=True)
            packages = home / ".config" / "sublime-text" / "Packages"
            target = packages / "MuseSpark"
            shutil.copytree(PACKAGE, target,
                            ignore=shutil.ignore_patterns("test", "__pycache__"))
            marker = "3.14" if sublime_build() >= 4205 else "3.8"
            (target / ".python-version").write_text(marker + "\n")
            harness = packages / "MuseSparkHarness"
            harness.mkdir(parents=True)
            shutil.copy(HERE / "harness" / "muse_harness.py", harness)
            (harness / ".python-version").write_text(marker + "\n")

            opener = base / "opener.py"
            record = base / "opener-record"
            opener.write_text(
                "import os, sys\n"
                "assert 'M104_API_KEY' not in os.environ\n"
                "open(os.environ['MUSE_HARNESS_OPENER_RECORD'], 'w').write(sys.argv[1])\n"
            )
            result = base / "result.json"
            env = {
                **os.environ,
                "HOME": str(home),
                "XDG_DATA_HOME": str(home / ".local" / "share"),
                "XDG_CONFIG_HOME": str(home / ".config"),
                "M104_API_KEY": "test-sentinel",
                "MUSE_HARNESS_RESULT": str(result),
                "MUSE_HARNESS_NODE": NODE,
                "MUSE_HARNESS_AGENT": str(AGENT),
                "MUSE_HARNESS_WORKSPACE": str(workspace),
                "MUSE_HARNESS_OPENER": str(opener),
                "MUSE_HARNESS_OPENER_RECORD": str(record),
            }
            env.pop("META_API_KEY", None)
            # The editor daemonizes; a waiter holds the virtual display
            # up until the harness reports, then lets the editor's own
            # exit land.
            waiter = base / "waiter.py"
            waiter.write_text(
                "import os, subprocess, sys, time\n"
                "subprocess.Popen([sys.argv[1], sys.argv[2]], env=os.environ,\n"
                "                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
                "deadline = time.time() + 140\n"
                "while time.time() < deadline and not os.path.exists(sys.argv[3]):\n"
                "    time.sleep(0.2)\n"
                "time.sleep(3)\n"
            )
            editor = subprocess.Popen(
                [XVFB, "-a", sys.executable, str(waiter), sublime_binary(),
                 str(workspace), str(result)],
                env=env, cwd=workspace, start_new_session=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            seen_cmdlines = set()
            seen_environs = []
            try:
                deadline = time.monotonic() + 150
                while time.monotonic() < deadline and not result.exists():
                    if sys.platform.startswith("linux"):
                        for entry in glob.glob("/proc/[0-9]*/cmdline"):
                            try:
                                line = Path(entry).read_bytes()
                            except OSError:
                                continue
                            if str(AGENT).encode() in line:
                                seen_cmdlines.add(
                                    line.replace(b"\0", b" ").decode("utf-8", "replace"))
                                pid = entry.split("/")[2]
                                try:
                                    seen_environs.append(
                                        Path(f"/proc/{pid}/environ").read_bytes())
                                except OSError:
                                    pass
                    time.sleep(0.02)
                self.assertTrue(result.exists(), "harness wrote no result")
                payload = json.loads(result.read_text())
                for entry in payload["checks"]:
                    self.assertTrue(entry["ok"], f"{entry['name']}: {entry['detail']}")
                self.assertTrue(
                    any("supervise" in line and "--companion" in line
                        for line in seen_cmdlines),
                    f"no real companion child observed: {sorted(seen_cmdlines)}",
                )
                if seen_environs:
                    self.assertTrue(
                        all(b"M104_API_KEY" not in env for env in seen_environs),
                        "sentinel reached an agent child",
                    )
            finally:
                # The daemonized editor escapes the waiter's group; stop
                # the one whose home is this scratch profile.
                if sys.platform.startswith("linux"):
                    for entry in glob.glob("/proc/[0-9]*/environ"):
                        try:
                            if f"HOME={home}".encode() in Path(entry).read_bytes():
                                os.kill(int(entry.split("/")[2]), signal.SIGTERM)
                        except (OSError, ProcessLookupError):
                            pass
                try:
                    os.killpg(os.getpgid(editor.pid), signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    pass
                try:
                    editor.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    editor.kill()
                    editor.wait(timeout=30)


if __name__ == "__main__":
    unittest.main()
