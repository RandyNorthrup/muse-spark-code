"""Tests for runtime lifecycle: start, announce, stop, and the never-gated stop."""

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
