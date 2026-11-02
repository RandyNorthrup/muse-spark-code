"""Qt Creator's trusted bootstrap against the real agent.

Every runtime child is this tree's real dist/acp.js (run `npm run build`
first), reached through musespark/launch.py exactly as the Lua plugin
reaches it. The Lua half itself runs only inside Qt Creator; what only
that proves is recorded in docs/real-life/unproven.md. Supervised modes
skip where the machine refuses supervision's owner-only root.
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "qt_launch", Path(__file__).parents[1] / "musespark" / "launch.py"
)
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)

ROOT = Path(__file__).parents[3]
AGENT = ROOT / "dist" / "acp.js"
NODE = shutil.which("node")


def supervision_possible():
    if sys.platform == "win32":
        return True
    return os.stat("/").st_uid in (0, os.getuid())


class LauncherTests(unittest.TestCase):
    def setUp(self):
        if NODE is None:
            self.skipTest("node is required")
        if not AGENT.is_file():
            self.fail("dist/acp.js missing: run npm run build first")

    def scratch_env(self, directory, **extra):
        home = Path(directory) / "home"
        env = {
            **os.environ,
            "HOME": str(home),
            "XDG_DATA_HOME": str(home / "data"),
            "XDG_CONFIG_HOME": str(home / "config"),
            "M104_API_KEY": "test-sentinel",
            **extra,
        }
        env.pop("META_API_KEY", None)
        return env

    def test_lsp_real_agent_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "ws"
            workspace.mkdir()
            child = subprocess.Popen(
                [sys.executable, "-I", launch.__file__, "lsp", NODE,
                 "--agent-script", str(AGENT)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, cwd=workspace,
                env=self.scratch_env(directory),
            )
            try:
                if sys.platform.startswith("linux"):
                    deadline = time.monotonic() + 30
                    cmdline = b""
                    while time.monotonic() < deadline:
                        cmdline = Path(f"/proc/{child.pid}/cmdline").read_bytes()
                        if cmdline.split(b"\0")[0] == NODE.encode():
                            break
                        time.sleep(0.05)
                    self.assertEqual(cmdline.split(b"\0")[0], NODE.encode())
                    names = Path(f"/proc/{child.pid}/environ").read_bytes()
                    self.assertNotIn(b"M104_API_KEY", names)

                def send(payload):
                    body = json.dumps(payload).encode()
                    child.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
                    child.stdin.flush()

                def receive():
                    header = b""
                    while not header.endswith(b"\r\n\r\n"):
                        chunk = child.stdout.read(1)
                        self.assertTrue(chunk, "agent closed stdout")
                        header += chunk
                    length = int(header.split(b":")[1].split(b"\r\n")[0])
                    return json.loads(child.stdout.read(length))

                send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                      "params": {"processId": os.getpid(),
                                 "rootUri": workspace.as_uri(),
                                 "capabilities": {},
                                 "workspaceFolders": [{"uri": workspace.as_uri(), "name": "ws"}]}})
                reply = receive()
                commands = reply["result"]["capabilities"]["executeCommandProvider"]["commands"]
                self.assertIn("muse.stop", commands)
                send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
                send({"jsonrpc": "2.0", "id": 2, "method": "shutdown", "params": None})
                self.assertIsNone(receive()["result"])
                send({"jsonrpc": "2.0", "method": "exit"})
                self.assertEqual(child.wait(timeout=30), 0)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=30)

    def test_panel_reaches_the_real_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "ws"
            workspace.mkdir()
            child = subprocess.run(
                [sys.executable, "-I", launch.__file__, "panel", NODE,
                 "--agent-script", str(AGENT)],
                capture_output=True, text=True, check=False, timeout=60,
                cwd=workspace, env=self.scratch_env(directory),
            )
            # The agent's own companion refusal answers, not the
            # launcher's EPANEL_LAUNCH (which would mean never execed).
            self.assertNotEqual(child.returncode, 0)
            self.assertNotEqual(child.stderr.strip(), "EPANEL_LAUNCH")

    @unittest.skipUnless(supervision_possible(),
                         "supervision's owner-only root refused on this machine")
    def test_stop_real_agent_says_its_outcome(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "ws"
            workspace.mkdir()
            child = subprocess.run(
                [sys.executable, "-I", launch.__file__, "stop", NODE,
                 "--agent-script", str(AGENT)],
                capture_output=True, text=True, check=False, timeout=60,
                cwd=workspace, env=self.scratch_env(directory),
            )
            # Nothing runs in the scratch workspace: the agent says so
            # and exits non-zero, in words rather than silence.
            self.assertNotEqual(child.returncode, 0)
            self.assertTrue(child.stdout.strip())

    def test_missing_runtime_failure_does_not_expose_paths(self):
        child = subprocess.run(
            [sys.executable, "-I", launch.__file__, "panel", "/private/not-installed"],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
        self.assertNotEqual(child.returncode, 0)
        self.assertEqual(child.stderr.strip(), "EPANEL_LAUNCH")

    def test_open_runs_the_system_opener_scrubbed(self):
        if sys.platform == "win32":
            self.skipTest("Windows requires an explicit opener")
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / "opener-record"
            opener = Path(directory) / ("open" if sys.platform == "darwin" else "xdg-open")
            opener.write_text(
                "#!/bin/sh\n"
                f"printf '%s|%s' \"$1\" \"${{M104_API_KEY:-absent}}\" > {record}\n"
            )
            opener.chmod(0o700)
            url = "http://127.0.0.1:41234/#k=test-launch"
            child = subprocess.run(
                [sys.executable, "-I", launch.__file__, "open", url],
                env=self.scratch_env(directory, PATH=directory),
                capture_output=True, text=True, check=False, timeout=60,
            )
            self.assertEqual(child.returncode, 0, child.stderr)
            self.assertEqual(record.read_text(), f"{url}|absent")

    def test_open_refuses_unsafe_urls(self):
        if sys.platform == "win32":
            self.skipTest("Windows requires an explicit opener")
        with tempfile.TemporaryDirectory() as directory:
            # A succeeding opener: only the launcher's own refusal can
            # keep these URLs from reaching it.
            record = Path(directory) / "opener-record"
            opener = Path(directory) / ("open" if sys.platform == "darwin" else "xdg-open")
            opener.write_text(f"#!/bin/sh\nprintf x > {record}\n")
            opener.chmod(0o700)
            for url in ("https://127.0.0.1:41234/#k=test-launch",
                        "http://127.0.0.1:0/#k=test-launch",
                        "http://localhost:41234/#k=test-launch"):
                child = subprocess.run(
                    [sys.executable, "-I", launch.__file__, "open", url],
                    env=self.scratch_env(directory, PATH=directory),
                    capture_output=True, text=True, check=False, timeout=60,
                )
                self.assertNotEqual(child.returncode, 0, url)
                self.assertEqual(child.stderr.strip(), "EPANEL_LAUNCH", url)
                self.assertFalse(record.exists(), url)


if __name__ == "__main__":
    unittest.main()
