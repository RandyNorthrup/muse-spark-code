"""Offline Zed settings/task contract and real bootstrap execution tests."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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
        self.assertEqual(task["args"][2:], ["panel", "/agent with spaces"])
        self.assertFalse(task["allow_concurrent_runs"])
        self.assertFalse(task["show_command"])
        self.assertEqual(task["save"], "none")

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

    def test_bootstrap_sanitizes_argv_and_environment(self):
        with (
            patch.dict(
                os.environ,
                {
                    "M104_API_KEY": "test-sentinel",
                    "OPENAI_KEY": "test-sentinel",
                    "m104_api_key": "test-sentinel",
                },
            ),
            patch.object(launch.os, "execvpe") as execute,
        ):
            launch.main(["panel", "/agent with spaces"])
            agent, argv, env = execute.call_args.args
            self.assertEqual(agent, "/agent with spaces")
            self.assertEqual(argv, [agent, "panel", "--companion"])
            self.assertNotIn("M104_API_KEY", env)
            self.assertNotIn("OPENAI_KEY", env)
            self.assertNotIn("m104_api_key", env)
            self.assertEqual(env["PATH"], os.environ["PATH"])

    def test_acp_stdio_preserved_and_real_child_has_no_credentials(self):
        # A real installed test executable receives exactly ACP stdin/stdout.
        with tempfile.TemporaryDirectory() as temporary:
            agent = Path(temporary) / "fake agent with spaces"
            agent.write_text(
                f"#!{sys.executable}\nimport os,sys\n"
                "assert not any(k.upper().endswith('_API_KEY') or k == 'OPENAI_KEY' for k in os.environ)\n"
                "assert len(sys.argv) == 1\nprint(sys.stdin.read(),end='')\n"
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

    def test_invalid_mode_or_argument_count_refused(self):
        with patch.object(launch.os, "execvpe") as execute:
            for args in (
                [],
                ["panel"],
                ["exec", "agent"],
                ["panel", "agent", "secret"],
                ["acp", ""],
            ):
                with self.assertRaises(ValueError):
                    launch.main(args)
            execute.assert_not_called()

    def test_missing_runtime_does_not_expose_private_paths(self):
        result = subprocess.run(
            [sys.executable, launch.__file__, "panel", "/private/not-installed"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.strip(), "EPANEL_LAUNCH")


if __name__ == "__main__":
    unittest.main()
