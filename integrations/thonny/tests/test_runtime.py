"""Tests for runtime lifecycle: start, announce, stop, and the never-gated stop."""

import itertools
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

import pytest

from thonnycontrib.muse_spark import runtime
from thonnycontrib.muse_spark.runtime import (
    AnnounceTimeout,
    RuntimeController,
    RuntimeMissing,
)


class FakeStream:
    def __init__(self, lines):
        self._lines = list(lines)

    def readline(self):
        if not self._lines:
            return ""
        return self._lines.pop(0)


class FakeProcess:
    def __init__(self, lines):
        self.stdout = FakeStream(lines)
        self.argv = None
        self.terminated = False
        self.killed = False
        self._returncode = None

    def poll(self):
        return self._returncode

    def terminate(self):
        self.terminated = True
        self._returncode = -15

    def kill(self):
        self.killed = True
        self._returncode = -9

    def wait(self, timeout=None):
        return self._returncode


class Harness:
    def __init__(self, lines=(), binary="/bin/muse-spark-code-acp"):
        self.process = FakeProcess(lines)
        self.binary = binary
        self.spawned = []
        self.runs = []

    def which(self, name):
        assert name == runtime.RUNTIME_BINARY
        return self.binary

    def popen(self, argv, **kwargs):
        self.spawned.append(argv)
        self.process.argv = argv
        return self.process

    def run(self, argv, **kwargs):
        self.runs.append(argv)

        class Done:
            returncode = 0
            stdout = ""
            stderr = ""

        return Done()

    def controller(self, **overrides):
        kwargs = {"which": self.which, "popen": self.popen, "run": self.run}
        kwargs.update(overrides)
        return RuntimeController(**kwargs)


ANNOUNCE = [
    "[panel] listening on 127.0.0.1:4311\n",
    "MUSE_SPARK_COMPANION_URL http://127.0.0.1:4311/\n",
    "MUSE_SPARK_COMPANION_LAUNCH launch-abc\n",
    "MUSE_SPARK_PROVIDER 127.0.0.1 4321 provider-tok\n",
]


def test_start_reads_announcements_and_ignores_logs():
    harness = Harness(ANNOUNCE)
    info = harness.controller().start()
    assert harness.spawned == [["/bin/muse-spark-code-acp", "panel"]]
    assert info.companion_url == "http://127.0.0.1:4311/"
    assert info.launch_code == "launch-abc"
    assert (info.provider_host, info.provider_port) == ("127.0.0.1", 4321)


def test_start_reuses_live_runtime():
    harness = Harness(ANNOUNCE)
    ctl = harness.controller()
    first = ctl.start()
    assert ctl.start() is first
    assert len(harness.spawned) == 1


def test_missing_binary_raises_and_spawns_nothing():
    harness = Harness(ANNOUNCE, binary=None)
    with pytest.raises(RuntimeMissing):
        harness.controller().start()
    assert harness.spawned == []


def test_silent_runtime_is_terminated_and_raises(caplog):
    harness = Harness(["[panel] warming up\n"])
    ctl = harness.controller(announce_timeout=0.2)
    with caplog.at_level("INFO", logger="thonnycontrib.muse_spark"):
        with pytest.raises(AnnounceTimeout):
            ctl.start()
    assert harness.process.terminated
    assert not ctl.is_running
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert "launch-abc" not in logged


def test_announcements_never_log_secrets(caplog):
    harness = Harness(ANNOUNCE)
    with caplog.at_level("INFO", logger="thonnycontrib.muse_spark"):
        harness.controller().start()
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert "launch-abc" not in logged
    assert "provider-tok" not in logged


def test_stop_terminates_and_is_idempotent():
    harness = Harness(ANNOUNCE)
    ctl = harness.controller()
    ctl.start()
    assert ctl.is_running
    ctl.stop()
    ctl.stop()
    assert harness.process.terminated
    assert not ctl.is_running
    assert ctl.info is None


def test_stop_machine_calls_cli_directly_and_needs_nothing_running():
    harness = Harness()
    ctl = harness.controller()
    assert not ctl.is_running
    ctl.stop_machine()
    assert harness.runs == [["/bin/muse-spark-code-acp", "stop-machine"]]
    assert harness.spawned == []


def test_stop_machine_without_binary_raises():
    harness = Harness(binary=None)
    with pytest.raises(RuntimeMissing):
        harness.controller().stop_machine()


def test_stop_machine_failure_raises():
    harness = Harness()

    def failing_run(argv, **kwargs):
        harness.runs.append(argv)

        class Done:
            returncode = 1
            stdout = ""
            stderr = "machine unreachable"

        return Done()

    with pytest.raises(runtime.RuntimeError, match="machine unreachable"):
        harness.controller(run=failing_run).stop_machine()
    assert harness.runs == [["/bin/muse-spark-code-acp", "stop-machine"]]


@pytest.mark.parametrize("order", list(itertools.permutations(ANNOUNCE[1:])))
def test_every_announcement_order_requires_all_kinds(order):
    harness = Harness(order)
    ctl = harness.controller()
    try:
        info = ctl.start()
        assert info.companion_url == "http://127.0.0.1:4311/"
        assert info.launch_code == "launch-abc"
        assert info.provider_port == 4321
    finally:
        ctl.stop()


def test_incomplete_or_bad_announcement_cleans_up_and_normalizes_failure():
    for lines in ([ANNOUNCE[-1]], ["MUSE_SPARK_PROVIDER 203.0.113.10 4321 synthetic\n"]):
        harness = Harness(lines)
        ctl = harness.controller()
        with pytest.raises(runtime.RuntimeError):
            ctl.start()
        assert harness.process.terminated
        assert not ctl.is_running


def test_concurrent_starts_spawn_one_child():
    harness = Harness(ANNOUNCE)
    entered, release = threading.Event(), threading.Event()

    def spawn(*args, **kwargs):
        entered.set()
        assert release.wait(2)
        return harness.popen(*args, **kwargs)

    ctl = harness.controller(popen=spawn)
    results = []
    workers = [threading.Thread(target=lambda: results.append(ctl.start())) for _ in range(2)]
    workers[0].start()
    assert entered.wait(2)
    workers[1].start()
    release.set()
    for worker in workers:
        worker.join(2)
    try:
        assert all(not worker.is_alive() for worker in workers)
        assert len(harness.spawned) == 1
        assert len(results) == 2 and results[0] is results[1]
    finally:
        ctl.stop()


def test_stop_cancels_start_before_spawn_returns():
    harness = Harness(ANNOUNCE)
    entered, release = threading.Event(), threading.Event()

    def spawn(*args, **kwargs):
        entered.set()
        assert release.wait(2)
        return harness.popen(*args, **kwargs)

    ctl = harness.controller(popen=spawn)
    errors = []

    def start():
        try:
            ctl.start()
        except runtime.RuntimeError as exc:
            errors.append(exc)

    worker = threading.Thread(target=start)
    worker.start()
    assert entered.wait(2)
    ctl.stop()
    release.set()
    worker.join(2)
    assert not worker.is_alive()
    assert errors and "cancelled" in str(errors[0])
    assert not ctl.is_running and ctl.info is None
    assert harness.process.terminated


def test_kill_fallback_is_reaped():
    harness = Harness(ANNOUNCE)
    waits = []

    def wait(timeout=None):
        waits.append(timeout)
        if not harness.process.killed:
            raise subprocess.TimeoutExpired("fake-runtime", timeout)
        return -9

    harness.process.wait = wait
    ctl = harness.controller()
    ctl.start()
    ctl.stop()
    assert harness.process.killed
    assert waits == [runtime.CHILD_WAIT_S, runtime.CHILD_WAIT_S]


def _wait_for_file(path, timeout=3):
    deadline = time.monotonic() + timeout
    while not path.exists():
        assert time.monotonic() < deadline, "fake runtime did not finish stdout writes"
        time.sleep(0.01)


def _real_fake_controller(tmp_path, extra):
    from thonnycontrib.muse_spark.process_tree import spawn_runtime

    script = tmp_path / "fake_runtime.py"
    script.write_text("import os, sys, time, subprocess\nfrom pathlib import Path\n" + extra)
    return RuntimeController(
        which=lambda _: sys.executable,
        popen=lambda argv, **kwargs: spawn_runtime([sys.executable, str(script)], **kwargs),
    )


def test_stdout_is_drained_after_announcements(tmp_path):
    marker = tmp_path / "output-complete"
    extra = "\n".join("print(" + repr(line.strip()) + ", flush=True)" for line in ANNOUNCE[1:])
    extra += "\nfor _ in range(2):\n    sys.stdout.write('x' * (1024 * 1024) + '\\n'); sys.stdout.flush()\n"
    extra += "Path(" + repr(str(marker)) + ").write_text('done')\ntime.sleep(90)\n"
    ctl = _real_fake_controller(tmp_path, extra)
    try:
        ctl.start()
        _wait_for_file(marker)
        reader = ctl._reader
    finally:
        ctl.stop()
    assert not reader.is_alive()


@pytest.mark.parametrize("parent_exits", [False, True])
def test_stop_kills_real_fake_runtime_descendant(tmp_path, parent_exits):
    marker = tmp_path / "child-pid"
    parent_marker = tmp_path / "parent-pid"
    extra = "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(90)'])\n"
    extra += "Path(" + repr(str(marker)) + ").write_text(str(child.pid))\n"
    extra += "Path(" + repr(str(parent_marker)) + ").write_text(str(os.getpid()))\n"
    extra += "\n".join("print(" + repr(line.strip()) + ", flush=True)" for line in ANNOUNCE[1:])
    extra += "\n" + ("sys.exit(0)" if parent_exits else "time.sleep(90)") + "\n"
    ctl = _real_fake_controller(tmp_path, extra)
    handle = None
    parent_handle = None
    pid = None
    try:
        ctl.start()
        _wait_for_file(marker)
        pid = int(marker.read_text())
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            api = ctypes.WinDLL("kernel32", use_last_error=True)
            api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            api.OpenProcess.restype = wintypes.HANDLE
            api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            api.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
            api.CloseHandle.argtypes = [wintypes.HANDLE]
            parent_handle = api.OpenProcess(0x00100001, False, int(parent_marker.read_text()))
            handle = api.OpenProcess(0x00100001, False, pid)
            if not handle:
                assert parent_exits and ctypes.get_last_error() == 87
            elif not parent_exits:
                assert api.WaitForSingleObject(handle, 0) == 258
        if parent_exits:
            ctl._process.wait(3)
        ctl.stop()
        if os.name == "nt" and handle:
            assert api.WaitForSingleObject(handle, 2000) == 0, "runtime descendant survived shutdown"
        elif os.name != "nt":
            # Let an orphan be reaped; Linux may retain a killed zombie briefly.
            deadline = time.monotonic() + 2
            while True:
                status = Path("/proc") / str(pid) / "stat"
                try:
                    if status.exists() and status.read_text().split()[2] == "Z":
                        break
                    os.kill(pid, 0)
                except (FileNotFoundError, ProcessLookupError):
                    break
                assert time.monotonic() < deadline, "runtime descendant survived shutdown"
                time.sleep(0.01)
    finally:
        ctl.stop()
        if handle:
            if api.WaitForSingleObject(handle, 0) != 0:
                api.TerminateProcess(handle, 1)
                api.WaitForSingleObject(handle, 2000)
            api.CloseHandle(handle)
        if parent_handle:
            if api.WaitForSingleObject(parent_handle, 0) != 0:
                api.TerminateProcess(parent_handle, 1)
                api.WaitForSingleObject(parent_handle, 2000)
            api.CloseHandle(parent_handle)
        if pid and os.name != "nt":
            import signal
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def test_posix_launcher_owns_a_session_and_signals_group(monkeypatch):
    from types import SimpleNamespace
    from thonnycontrib.muse_spark import process_tree

    calls = []
    process = SimpleNamespace(pid=123, stdout=None)
    monkeypatch.setattr(process_tree, "os", SimpleNamespace(name="posix", killpg=lambda *args: calls.append(args)))
    monkeypatch.setattr(process_tree, "signal", SimpleNamespace(SIGTERM=15, SIGKILL=9))
    spawned = []
    monkeypatch.setattr(process_tree.subprocess, "Popen", lambda argv, **kwargs: spawned.append((argv, kwargs)) or process)
    owned = process_tree.spawn_runtime(["fake-runtime", "panel"])
    owned.terminate()
    owned.kill()
    owned.close()
    assert spawned == [(["fake-runtime", "panel"], {"start_new_session": True})]
    assert calls == [(123, 15), (123, 9)]


def test_command_shim_announces_through_owned_tree(tmp_path):
    from thonnycontrib.muse_spark.process_tree import spawn_runtime

    script = tmp_path / "fake runtime.py"
    script.write_text("import time\n" + "\n".join("print(" + repr(line.strip()) + ", flush=True)" for line in ANNOUNCE[1:]) + "\ntime.sleep(90)\n")
    if os.name == "nt":
        shim = tmp_path / "fake runtime.cmd"
        shim.write_text('@echo off\n"' + sys.executable + '" "' + str(script) + '"\n')
    else:
        import shlex

        shim = tmp_path / "fake runtime.sh"
        shim.write_text("#!/bin/sh\nexec " + shlex.quote(sys.executable) + " " + shlex.quote(str(script)) + "\n")
        shim.chmod(0o700)
    ctl = RuntimeController(which=lambda _: str(shim), popen=spawn_runtime)
    try:
        assert ctl.start().provider_host == "127.0.0.1"
    finally:
        ctl.stop()
