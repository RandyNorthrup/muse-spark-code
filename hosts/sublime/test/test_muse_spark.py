"""Offline Sublime API doubles; no real credentials or model calls."""

import importlib.util
import os
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class WindowCommand:
    def __init__(self, window):
        self.window = window


settings = {
    "command": ["agent with spaces", "--backend", "museCode"],
    "opener": ["browser"],
}
errors = []
scheduled = []
sys.modules["sublime"] = types.SimpleNamespace(
    load_settings=lambda _name: settings,
    error_message=errors.append,
    set_timeout=lambda callback: callback(),
    set_timeout_async=scheduled.append,
)
sys.modules["sublime_plugin"] = types.SimpleNamespace(
    WindowCommand=WindowCommand, EventListener=object
)
spec = importlib.util.spec_from_file_location(
    "muse_spark", Path(__file__).parents[1] / "muse_spark.py"
)
muse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(muse)


class Process:
    stopped = False

    def poll(self):
        return 0 if self.stopped else None

    def terminate(self):
        self.stopped = True

    def wait(self):
        return 1


class ShimTests(unittest.TestCase):
    def setUp(self):
        errors.clear()
        scheduled.clear()
        muse._processes.clear()
        self.window = types.SimpleNamespace(
            id=lambda: 1, folders=lambda: ["/workspace with spaces"]
        )
        self.url = "http://127.0.0.1:41234/#k=test-launch"

    def test_independent_stop_is_bounded_and_sanitized(self):
        with patch.dict(os.environ, {"M104_API_KEY": "test-sentinel"}), patch.object(muse.subprocess, "run", return_value=types.SimpleNamespace(returncode=0)) as run:
            muse.MuseStopCommand(self.window).run()
            scheduled[-1]()
            self.assertEqual(run.call_args.args[0], ["agent with spaces", "stop", "--backend", "museCode"])
            self.assertEqual(run.call_args.kwargs["cwd"], "/workspace with spaces")
            self.assertNotIn("M104_API_KEY", run.call_args.kwargs["env"])
            self.assertEqual(run.call_args.kwargs["timeout"], 15)
            self.assertFalse(run.call_args.kwargs["shell"])

    def test_lsp_registration_and_environment_override(self):
        registered = []
        fake_lsp = types.ModuleType("LSP.plugin")
        fake_lsp.AbstractPlugin = object
        fake_lsp.register_plugin = registered.append
        fake_lsp.unregister_plugin = registered.remove
        with patch.dict(sys.modules, {"LSP": types.ModuleType("LSP"), "LSP.plugin": fake_lsp}):
            spec = importlib.util.spec_from_file_location("muse_lsp_fixture", Path(__file__).parents[1] / "muse_spark.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        module.plugin_loaded()
        self.assertEqual(registered, [module.MuseSparkLspPlugin])
        configuration = types.SimpleNamespace(env={"PATH": "retained"})
        with patch.dict(os.environ, {"M104_API_KEY": "test-sentinel", "OPENAI_KEY": "test-sentinel"}):
            module.MuseSparkLspPlugin.on_pre_start(None, None, [], configuration)
        self.assertEqual(configuration.env["M104_API_KEY"], "")
        self.assertEqual(configuration.env["OPENAI_KEY"], "")
        self.assertEqual(configuration.env["PATH"], "retained")
        module.plugin_unloaded()
        self.assertEqual(registered, [])

    def test_fragment_launch_only(self):
        self.assertTrue(muse.valid_launch_url(self.url))
        self.assertTrue(muse.valid_launch_url("http://[::1]:41234/#k=test-launch"))
        for url in (
            "http://localhost:41234/#k=test-launch",
            "http://127.0.0.1.evil:41234/#k=test-launch",
            "http://127.0.0.1:0/#k=test-launch",
            "http://127.0.0.1:65536/#k=test-launch",
            "http://127.0.0.1:41234/?k=test-launch",
            self.url + "\n",
            self.url + "&token=value",
            None,
        ):
            self.assertFalse(muse.valid_launch_url(url))

    def test_real_child_environment(self):
        with patch.dict(
            os.environ,
            {
                "M104_API_KEY": "test-sentinel",
                "OPENAI_KEY": "test-sentinel",
                "m104_api_key": "test-sentinel",
            },
        ):
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import os; assert not any(k.upper().endswith('_API_KEY') or k == 'OPENAI_KEY' for k in os.environ)",
                ],
                env=muse.clean_environment(),
                check=False,
            )
            self.assertEqual(result.returncode, 0)
            self.assertEqual(os.environ["M104_API_KEY"], "test-sentinel")

    def test_companion_argv_sanitized_and_duplicate_refused(self):
        child = Process()
        with patch.object(muse.subprocess, "Popen", return_value=child) as spawn:
            with patch.dict(os.environ, {"M104_API_KEY": "test-sentinel"}):
                muse.MusePanelCommand(self.window).run()
            args, kwargs = spawn.call_args
            self.assertEqual(args[0], ["agent with spaces", "supervise", "panel", "--backend", "museCode", "--companion"])
            self.assertEqual(kwargs["cwd"], "/workspace with spaces")
            self.assertNotIn("M104_API_KEY", kwargs["env"])
            self.assertFalse(kwargs["shell"])
            self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
            muse.MusePanelCommand(self.window).run()
            self.assertEqual(spawn.call_count, 1)
            self.assertEqual(errors, ["EPANEL_LAUNCH"])

    def test_browser_opens_only_safe_fragment(self):
        with patch.object(muse.subprocess, "Popen", return_value=Process()) as spawn:
            muse.MusePanelCommand(self.window).run(url=self.url)
            self.assertEqual(spawn.call_args.args[0], ["browser", self.url])
            muse.MusePanelCommand(self.window).run(url="file:///private")
            self.assertEqual(spawn.call_count, 1)

    def test_stop_and_window_close_are_isolated(self):
        first, other = Process(), Process()
        muse._processes.update({1: first, 2: other})
        muse.MuseLifecycle().on_pre_close_window(self.window)
        self.assertTrue(first.stopped)
        self.assertFalse(other.stopped)
        muse.MuseStopCommand(self.window).run()
        muse.plugin_unloaded()
        self.assertTrue(other.stopped)
        self.assertEqual(muse._processes, {})

    def test_no_workspace_or_invalid_command_refused(self):
        with patch.object(muse.subprocess, "Popen") as spawn:
            muse.MusePanelCommand(
                types.SimpleNamespace(id=lambda: 1, folders=list)
            ).run()
            with patch.dict(settings, {"command": "shell text"}):
                muse.MusePanelCommand(self.window).run()
            self.assertEqual(spawn.call_count, 0)
            self.assertEqual(errors, ["EPANEL_LAUNCH", "EPANEL_LAUNCH"])

    def test_launch_failure_does_not_print_paths_or_url(self):
        with patch.object(muse.subprocess, "Popen", side_effect=OSError(self.url)):
            muse.MusePanelCommand(self.window).run(url=self.url)
        self.assertEqual(errors, ["EPANEL_LAUNCH"])
        self.assertEqual(muse._processes, {})

    def test_exit_reports_failure_and_preserves_new_process(self):
        child, new = Process(), Process()
        with patch.object(muse.subprocess, "Popen", return_value=child):
            muse.MusePanelCommand(self.window).run()
        scheduled[0]()
        self.assertEqual(errors, ["EPANEL_EXIT"])
        self.assertEqual(muse._processes, {})
        muse._processes[1] = new
        muse._watch(1, child)
        self.assertIs(muse._processes[1], new)
        self.assertEqual(errors, ["EPANEL_EXIT"])

    def test_invalid_opener_refused(self):
        with patch.object(muse.subprocess, "Popen") as spawn:
            with patch.dict(settings, {"opener": "shell text"}):
                muse.MusePanelCommand(self.window).run(url=self.url)
            self.assertEqual(spawn.call_count, 0)

    def test_windows_browser_requires_explicit_opener(self):
        with (
            patch.dict(settings, {"opener": []}),
            patch.object(muse.sys, "platform", "win32"),
            patch.object(muse.subprocess, "Popen") as spawn,
        ):
            muse.MusePanelCommand(self.window).run(url=self.url)
            spawn.assert_not_called()
            self.assertEqual(errors, ["EPANEL_LAUNCH"])

    def test_stop_failure_retains_ownership_for_retry(self):
        child = Process()
        muse._processes[1] = child
        with patch.object(
            child, "terminate", side_effect=OSError("private profile path")
        ):
            muse.MuseStopCommand(self.window).run()
        self.assertIs(muse._processes[1], child)
        self.assertEqual(errors, ["EPANEL_STOP"])
        muse.MuseStopCommand(self.window).run()
        self.assertTrue(child.stopped)
        self.assertNotIn(1, muse._processes)

    def test_browser_failure_is_visible_and_redacted(self):
        child = Process()
        with patch.object(muse.subprocess, "Popen", return_value=child):
            muse.MusePanelCommand(self.window).run(url=self.url)
        self.assertEqual(len(scheduled), 1)
        scheduled[0]()
        self.assertEqual(errors, ["EPANEL_LAUNCH"])
        self.assertEqual(muse._processes, {})
        errors.clear()
        with patch.object(child, "wait", return_value=0):
            muse._watch(None, child)
        self.assertEqual(errors, [])

    def test_unload_failure_does_not_block_other_windows(self):
        first, second = Process(), Process()
        muse._processes.update({1: first, 2: second})
        with patch.object(first, "terminate", side_effect=OSError("private path")):
            muse.plugin_unloaded()
        self.assertTrue(second.stopped)
        self.assertIs(muse._processes[1], first)
        self.assertNotIn(2, muse._processes)
        self.assertEqual(errors, ["EPANEL_STOP"])
        muse.plugin_unloaded()
        self.assertTrue(first.stopped)
        self.assertEqual(muse._processes, {})


if __name__ == "__main__":
    unittest.main()
