"""Offline Zed settings/task contract and real bootstrap execution tests."""

import importlib.util
import json
import os
import shlex
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


class ZedTests(unittest.TestCase):

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
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "injected"
            agent = Path(directory) / "agent ; $() ' with spaces"
            agent.write_text(
                f"#!{sys.executable}\nimport sys,json\n"
                "print(json.dumps(sys.argv[1:]))\n"
            )
            agent.chmod(0o700)
            value = f"{agent} $(touch {marker})"
            result = register.configuration(value, sys.executable)
            task = result["tasks"][0]
            # Zed joins command and args as shell text, rather than exec argv.
            self.assertEqual(task["shell"], {"program": "/bin/sh"})
            command = " ".join([task["command"], *task["args"]])
            child = subprocess.run(
                ["/bin/sh", "-c", command], text=True, capture_output=True,
                check=False,
            )
            self.assertEqual(child.returncode, 1)
            self.assertEqual(child.stderr.strip(), "EPANEL_LAUNCH")
            self.assertFalse(marker.exists())
            # A literal executable path with spaces, quotes and dollar signs works.
            task = register.configuration(str(agent), sys.executable)["tasks"][0]
            child = subprocess.run(
                ["/bin/sh", "-c", " ".join([task["command"], *task["args"]])],
                text=True, capture_output=True, check=False,
            )
            self.assertEqual(child.returncode, 0, child.stderr)
            self.assertEqual(json.loads(child.stdout), ["supervise", "panel", "--companion"])

    def test_cli_emits_only_authored_configuration(self):
        output = subprocess.check_output(
            [
                sys.executable,
                str(Path(register.__file__)),
                "--agent",
                "/agent with spaces",
            ],
            text=True,
        )
        self.assertEqual(
            json.loads(output),
            register.configuration("/agent with spaces", sys.executable),
        )

    def test_acp_stdio_preserved_and_real_child_has_no_credentials(self):
        # A real installed test executable receives exactly ACP stdin/stdout.
        with tempfile.TemporaryDirectory() as temporary:
            agent = Path(temporary) / "fake agent with spaces"
            agent.write_text(
                f"#!{sys.executable}\nimport os,sys\n"
                "assert not any(k.upper().endswith('_API_KEY') or k == 'OPENAI_KEY' for k in os.environ)\n"
                "assert sys.argv[1:] == ['supervise']\nprint(sys.stdin.read(),end='')\n"
            )
            agent.chmod(0o700)
            result = subprocess.run(
                [sys.executable, launch.__file__, "acp", str(agent)],
                input="authored ACP test frame\n",
                text=True,
                capture_output=True,
                env={
                    **os.environ,
                    "M104_API_KEY": "test-sentinel",
                    "OPENAI_KEY": "test-sentinel",
                },
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "authored ACP test frame\n")

    def test_missing_runtime_does_not_expose_private_paths(self):
        result = subprocess.run(
            [sys.executable, launch.__file__, "panel", "/private/not-installed"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.strip(), "EPANEL_LAUNCH")

    def test_node_script_prefix_registration_and_execution(self):
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
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "script with spaces.py"
            script.write_text("import sys; print(sys.stdin.read(), end='')\n")
            child = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    launch.__file__,
                    "acp",
                    sys.executable,
                    "--agent-script",
                    str(script),
                ],
                input="ACP test frame\n",
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(child.returncode, 0, child.stderr)
            self.assertEqual(child.stdout, "ACP test frame\n")


if __name__ == "__main__":
    unittest.main()
