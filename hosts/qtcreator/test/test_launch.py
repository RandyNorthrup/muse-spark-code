"""Qt Creator's trusted bootstrap tests, independent of a GUI installation."""

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "qt_launch", Path(__file__).parents[1] / "musespark" / "launch.py"
)
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


class LauncherTests(unittest.TestCase):
    def test_runtime_exec_removes_credentials_and_keeps_argv(self):
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
            command, argv, env = execute.call_args.args
            self.assertEqual(command, "/agent with spaces")
            self.assertEqual(argv, [command, "supervise", "panel", "--companion"])
            self.assertNotIn("M104_API_KEY", env)
            self.assertNotIn("OPENAI_KEY", env)
            self.assertNotIn("m104_api_key", env)

    def test_browser_exec_keeps_fragment_and_clean_environment(self):
        url = "http://127.0.0.1:41234/#k=test-launch"
        with (
            patch.dict(os.environ, {"M104_API_KEY": "test-sentinel"}),
            patch.object(
                launch.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0),
            ) as execute,
        ):
            launch.main(["open", url])
            self.assertEqual(execute.call_args.args[0][1:], [url])
            self.assertNotIn("M104_API_KEY", execute.call_args.kwargs["env"])
            self.assertEqual(execute.call_args.kwargs["stderr"], subprocess.DEVNULL)

    def test_rejects_unsafe_urls_and_unknown_modes(self):
        with patch.object(launch.os, "execvpe") as execute:
            for args in (
                ["open", "file:///private"],
                ["open", "http://localhost:41234/#k=test-launch"],
                ["open", "http://127.0.0.1:65536/#k=test-launch"],
                ["unknown", "agent"],
                ["panel"],
                ["panel", "agent", "secret"],
                ["panel", "agent", "--agent-script", ""],
                ["panel", "agent", "--unknown", "script"],
                ["open", "url", "--agent-script", "script"],
            ):
                with self.assertRaises(ValueError):
                    launch.main(args)
            execute.assert_not_called()

    def test_real_runtime_has_no_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            agent = Path(directory) / "fake agent with spaces"
            agent.write_text(
                f"#!{sys.executable}\nimport os,sys\n"
                "assert not any(k.upper().endswith('_API_KEY') or k == 'OPENAI_KEY' for k in os.environ)\n"
                "assert sys.argv[1:] == ['supervise', 'panel', '--companion']\n"
            )
            agent.chmod(0o700)
            child = subprocess.run(
                [sys.executable, "-I", launch.__file__, "panel", str(agent)],
                env={**os.environ, "M104_API_KEY": "test-sentinel"},
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(child.returncode, 0, child.stderr)
            self.assertEqual(child.stdout, "")

    def test_missing_runtime_failure_does_not_expose_paths(self):
        child = subprocess.run(
            [sys.executable, "-I", launch.__file__, "panel", "/private/not-installed"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(child.returncode, 0)
        self.assertEqual(child.stderr.strip(), "EPANEL_LAUNCH")

    def test_windows_browser_needs_native_opener(self):
        with (
            patch.object(launch.sys, "platform", "win32"),
            patch.object(launch.os, "execvpe") as execute,
        ):
            with self.assertRaises(ValueError):
                launch.main(["open", "http://127.0.0.1:41234/#k=test-launch"])
            execute.assert_not_called()

    def test_node_script_prefix_is_argv_on_windows_and_real_child(self):
        with (
            patch.object(launch.sys, "platform", "win32"),
            patch.object(launch.os, "execvpe") as execute,
        ):
            launch.main(
                ["panel", "C:/Node/node.exe", "--agent-script", "C:/ACP/dist/acp.js"]
            )
            self.assertEqual(
                execute.call_args.args[1],
                ["C:/Node/node.exe", "C:/ACP/dist/acp.js", "supervise", "panel", "--companion"],
            )
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "script with spaces.py"
            script.write_text(
                "import sys; assert sys.argv[1:] == ['supervise', 'panel', '--companion']\n"
            )
            child = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    launch.__file__,
                    "panel",
                    sys.executable,
                    "--agent-script",
                    str(script),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(child.returncode, 0, child.stderr)

    def test_browser_nonzero_exit_is_visible_without_private_output(self):
        with tempfile.TemporaryDirectory() as directory:
            opener = Path(directory) / (
                "open" if sys.platform == "darwin" else "xdg-open"
            )
            opener.write_text("#!/bin/sh\nprintf 'private-launch-detail' >&2\nexit 1\n")
            opener.chmod(0o700)
            child = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    launch.__file__,
                    "open",
                    "http://127.0.0.1:41234/#k=test-launch",
                ],
                env={**os.environ, "PATH": directory},
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(child.returncode, 0)
            self.assertEqual(child.stderr.strip(), "EPANEL_LAUNCH")
            self.assertEqual(child.stdout, "")


if __name__ == "__main__":
    unittest.main()
