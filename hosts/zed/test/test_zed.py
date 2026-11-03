"""Zed settings/task contract and real-agent bootstrap execution tests.

Every executed child is this tree's real dist/acp.js (run `npm run build`
first), reached through launch.py exactly as Zed's generated settings
and tasks reach it. Supervised modes need supervision's owner-only root;
where the machine refuses that root (this lane's sandbox: `/` is uid
65534), those legs skip with the reason instead of pretending.
"""

import importlib.util
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


def module(name):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).parents[1] / f"{name}.py"
    )
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


register = module("register")
launch = module("launch")

ROOT = Path(__file__).parents[3]
AGENT = ROOT / "dist" / "acp.js"
NODE = shutil.which("node")


def supervision_possible():
    """Supervise's ancestor rule admits only root or the caller above it."""
    if sys.platform == "win32":
        return True
    return os.stat("/").st_uid in (0, os.getuid())


class ZedTests(unittest.TestCase):
    def setUp(self):
        if NODE is None:
            self.skipTest("node is required")
        if not AGENT.is_file():
            self.fail("dist/acp.js missing: run npm run build first")

    def scratch_env(self, directory):
        home = Path(directory) / "home"
        env = {
            **os.environ,
            "HOME": str(home),
            "XDG_DATA_HOME": str(home / "data"),
            "XDG_CONFIG_HOME": str(home / "config"),
            "M104_API_KEY": "test-sentinel",
            "OPENAI_KEY": "test-sentinel",
        }
        env.pop("META_API_KEY", None)
        return env

    def test_custom_agent_and_companion_task(self):
        result = register.configuration("/agent with spaces", "/python with spaces")
        agent = result["settings"]["agent_servers"]["Muse Spark Code (Unofficial)"]
        self.assertEqual(agent["type"], "custom")
        self.assertEqual(agent["command"], "/python with spaces")
        self.assertEqual(agent["args"][:1], ["-I"])
        self.assertEqual(agent["args"][2:], ["acp", "/agent with spaces"])
        self.assertEqual(agent["env"], {})
        task = result["tasks"][0]
        self.assertEqual(task["args"][:1], ["-I"])
        self.assertEqual([shlex.split(arg)[0] for arg in task["args"]][2:], ["panel", "/agent with spaces"])
        self.assertFalse(task["allow_concurrent_runs"])
        self.assertFalse(task["show_command"])
        self.assertEqual(task["save"], "none")

    def test_task_shell_keeps_metacharacters_literal(self):
        if sys.platform == "win32":
            self.skipTest("the PowerShell task form is qualified on Windows")
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "injected"
            value = f"/agent $(touch {marker})"
            task = register.configuration(value, sys.executable)["tasks"][0]
            self.assertEqual(task["shell"], {"program": "/bin/sh"})
            command = " ".join([task["command"], *task["args"]])
            child = subprocess.run(
                ["/bin/sh", "-c", command], text=True, capture_output=True,
                check=False, timeout=60,
            )
            self.assertEqual(child.returncode, 1)
            self.assertEqual(child.stderr.strip(), "EPANEL_LAUNCH")
            self.assertFalse(marker.exists())

    def test_task_shell_reaches_the_real_agent(self):
        if sys.platform == "win32":
            self.skipTest("the PowerShell task form is qualified on Windows")
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "ws"
            workspace.mkdir()
            task = register.configuration(NODE, sys.executable, str(AGENT))["tasks"][0]
            command = " ".join([task["command"], *task["args"]])
            child = subprocess.run(
                ["/bin/sh", "-c", command], text=True, capture_output=True,
                check=False, timeout=60, cwd=workspace,
                env=self.scratch_env(directory),
            )
            # Correct quoting execs the real agent, whose own refusal of
            # the companion start is what answers — not EPANEL_LAUNCH,
            # which would mean the launcher never reached it.
            self.assertNotEqual(child.returncode, 0, child.stdout)
            self.assertNotEqual(child.stderr.strip(), "EPANEL_LAUNCH")

    def test_cli_emits_only_authored_configuration(self):
        output = subprocess.check_output(
            [
                sys.executable,
                str(Path(register.__file__)),
                "--agent",
                "/agent with spaces",
            ],
            text=True,
            timeout=60,
        )
        self.assertEqual(
            json.loads(output),
            register.configuration("/agent with spaces", sys.executable),
        )

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
                    # The launcher scrubs, then execs: wait for the agent's
                    # own argv before reading its live environment.
                    import time

                    deadline = time.monotonic() + 30
                    cmdline = b""
                    while time.monotonic() < deadline:
                        cmdline = Path(f"/proc/{child.pid}/cmdline").read_bytes()
                        if cmdline.split(b"\0")[0] == NODE.encode():
                            break
                        time.sleep(0.05)
                    parts = [part for part in cmdline.split(b"\0") if part]
                    self.assertEqual(parts[0], NODE.encode())
                    self.assertIn(str(AGENT).encode(), parts)
                    names = Path(f"/proc/{child.pid}/environ").read_bytes()
                    self.assertNotIn(b"M104_API_KEY", names)
                    self.assertNotIn(b"OPENAI_KEY", names)

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
                self.assertEqual(reply["id"], 1)
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

    @unittest.skipUnless(supervision_possible(),
                         "supervision's owner-only root refused on this machine")
    def test_acp_real_agent_handshake(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "ws"
            workspace.mkdir()
            child = subprocess.Popen(
                [sys.executable, "-I", launch.__file__, "acp", NODE,
                 "--agent-script", str(AGENT)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, cwd=workspace, text=True,
                env=self.scratch_env(directory),
            )
            try:
                child.stdin.write(json.dumps(
                    {"jsonrpc": "2.0", "id": 0, "method": "initialize",
                     "params": {"protocolVersion": 1, "clientCapabilities": {},
                                "clientInfo": {"name": "zed-test", "version": "0"}}}) + "\n")
                child.stdin.flush()
                reply = json.loads(child.stdout.readline())
                self.assertEqual(reply["result"]["protocolVersion"], 1)
                self.assertEqual(reply["result"]["agentInfo"]["name"],
                                 "muse-spark-code-acp")
                child.stdin.write(json.dumps(
                    {"jsonrpc": "2.0", "id": 1, "method": "session/new",
                     "params": {"cwd": str(workspace), "mcpServers": []}}) + "\n")
                child.stdin.flush()
                refusal = json.loads(child.stdout.readline())
                # No sign-in in the scratch home: said refusal, no model call.
                self.assertEqual(refusal["error"]["data"]["kind"], "authRequired")
                child.stdin.close()
                self.assertEqual(child.wait(timeout=30), 0)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=30)

    def test_missing_runtime_does_not_expose_private_paths(self):
        result = subprocess.run(
            [sys.executable, launch.__file__, "panel", "/private/not-installed"],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.strip(), "EPANEL_LAUNCH")

    def test_node_script_prefix_registration(self):
        result = register.configuration(
            "C:/Node/node.exe", sys.executable, "C:/ACP/dist/acp.js"
        )
        agent = result["settings"]["agent_servers"]["Muse Spark Code (Unofficial)"]
        self.assertEqual(
            agent["args"][2:],
            ["acp", "C:/Node/node.exe", "--agent-script", "C:/ACP/dist/acp.js"],
        )
        self.assertEqual(
            [shlex.split(arg)[0] for arg in result["tasks"][0]["args"]][2:],
            ["panel", "C:/Node/node.exe", "--agent-script", "C:/ACP/dist/acp.js"],
        )


if __name__ == "__main__":
    unittest.main()
