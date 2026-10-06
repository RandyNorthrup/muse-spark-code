"""Tests for the plugin entry point: menus, Open/Stop flows, and the M103
acceptance walk (start runtime, open companion, device read through a fake
runner without opening the port)."""

import sys
import threading
import time

from thonnycontrib.muse_spark import (
    CAPTION_STOP,
    COMMAND_OPEN_ID,
    COMMAND_STOP_ID,
    LABEL_OPEN,
    LABEL_STOP,
    MENU,
    Plugin,
)
from thonnycontrib.muse_spark.bridge import ProviderClient
from thonnycontrib.muse_spark.runner import BridgeEngine
from thonnycontrib.muse_spark.runtime import RuntimeInfo, RuntimeMissing

from .fakes import FakeBackend, FakeRunner, FakeWorkbench
from .test_bridge import Peer, _read_frame, pumping


def test_package_import_needs_no_thonny():
    assert "thonny" not in sys.modules


class FakeNotices:
    def __init__(self):
        self.errors = []
        self.infos = []

    def show_error(self, title, message):
        self.errors.append((title, message))

    def show_info(self, title, message):
        self.infos.append((title, message))


class FakeController:
    def __init__(self, info=None, start_error=None, stop_error=None):
        self._info = info or RuntimeInfo(
            binary="/bin/muse-spark-code-acp",
            companion_url="http://127.0.0.1:4311/",
            launch_code="launch-abc",
            provider_host="127.0.0.1",
            provider_port=4321,
            provider_token="tok-1",
        )
        self._start_error = start_error
        self._stop_error = stop_error
        self.starts = 0
        self.stops = 0
        self.machine_stops = 0

    def start(self):
        self.starts += 1
        if self._start_error is not None:
            raise self._start_error
        return self._info

    def stop(self):
        self.stops += 1

    def stop_machine(self):
        self.machine_stops += 1
        if self._stop_error is not None:
            raise self._stop_error


class FakeClient:
    def __init__(self, *args, connected=True, connect_error=None):
        self.args = args
        self._connected = connected
        self._connect_error = connect_error
        self.connects = 0
        self.threads = 0
        self.closes = 0

    @property
    def is_connected(self):
        return self._connected

    def connect(self):
        self.connects += 1
        if self._connect_error is not None:
            raise self._connect_error

    def start_thread(self):
        self.threads += 1
        return threading.Thread(daemon=True)

    def close(self):
        self.closes += 1
        self._connected = False


def _plugin(workbench=None, **overrides):
    notices = FakeNotices()
    opened = []
    clients = []

    def factory(*args):
        client = FakeClient(*args)
        clients.append(client)
        return client

    kwargs = {
        "controller": FakeController(),
        "notices": notices,
        "opener": lambda url, code: opened.append((url, code)) or "opened",
        "client_factory": factory,
        "register_exit": lambda fn: None,
    }
    kwargs.update(overrides)
    plugin = Plugin(workbench or FakeWorkbench(), **kwargs)
    return plugin, notices, opened, clients


def _wait_for(condition, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "timed out waiting for worker thread"
        time.sleep(0.01)


def test_register_adds_open_and_stop():
    workbench = FakeWorkbench()
    plugin, _, _, _ = _plugin(workbench=workbench)
    plugin.register()
    by_id = {c["command_id"]: c for c in workbench.commands}
    assert set(by_id) == {COMMAND_OPEN_ID, COMMAND_STOP_ID}
    assert (by_id[COMMAND_OPEN_ID]["menu_name"], by_id[COMMAND_OPEN_ID]["command_label"]) == (
        MENU,
        LABEL_OPEN,
    )
    assert by_id[COMMAND_OPEN_ID]["command_label"] == "Open Muse Spark"
    stop = by_id[COMMAND_STOP_ID]
    assert (stop["menu_name"], stop["command_label"]) == (MENU, LABEL_STOP)
    assert stop["command_label"] == "Stop machine"
    assert stop["kwargs"].get("caption") == CAPTION_STOP
    assert stop["kwargs"].get("include_in_toolbar") is True
    assert callable(stop["handler"])


def test_open_starts_runtime_connects_and_opens_companion():
    workbench = FakeWorkbench()
    plugin, _, opened, clients = _plugin(workbench=workbench)
    plugin.register()
    by_id = {c["command_id"]: c for c in workbench.commands}
    by_id[COMMAND_OPEN_ID]["handler"]()
    _wait_for(lambda: opened != [])
    assert opened == [("http://127.0.0.1:4311/", "launch-abc")]
    assert len(clients) == 1
    assert clients[0].args[:3] == ("127.0.0.1", 4321, "tok-1")
    assert clients[0].connects == 1
    assert clients[0].threads == 1


def test_open_without_runtime_shows_error_and_starts_nothing():
    workbench = FakeWorkbench()
    plugin, notices, opened, clients = _plugin(
        workbench=workbench,
        controller=FakeController(start_error=RuntimeMissing("nope")),
    )
    plugin.register()
    plugin.on_open()
    _wait_for(lambda: notices.errors != [])
    assert opened == []
    assert clients == []
    assert "Muse Spark" in notices.errors[0][0]


def test_stop_machine_is_never_gated():
    workbench = FakeWorkbench()
    controller = FakeController()
    plugin, notices, _, _ = _plugin(workbench=workbench, controller=controller)
    plugin.register()
    by_id = {c["command_id"]: c for c in workbench.commands}
    by_id[COMMAND_STOP_ID]["handler"]()
    _wait_for(lambda: controller.machine_stops == 1)
    assert notices.errors == []


def test_stop_machine_failure_is_reported():
    workbench = FakeWorkbench()
    plugin, notices, _, _ = _plugin(
        workbench=workbench,
        controller=FakeController(stop_error=RuntimeMissing("nope")),
    )
    plugin.on_stop()
    _wait_for(lambda: notices.errors != [])
    assert "Muse Spark" in notices.errors[0][0]


def test_shutdown_closes_client_and_stops_runtime():
    workbench = FakeWorkbench()
    controller = FakeController()
    plugin, _, _, clients = _plugin(workbench=workbench, controller=controller)
    plugin.register()
    plugin.on_open()
    _wait_for(lambda: clients != [] and clients[0].threads == 1)
    plugin.shutdown()
    plugin.shutdown()
    assert clients[0].closes >= 1
    assert controller.stops == 2


def test_acceptance_open_to_device_read_without_opening_port():
    """M103 acceptance 27 (Thonny row): start the runtime, open the
    companion page, and route a device read through a fake Thonny runner
    without opening the port."""
    peer = Peer()
    lines = [
        "MUSE_SPARK_COMPANION_URL http://127.0.0.1:4311/\n",
        "MUSE_SPARK_COMPANION_LAUNCH launch-abc\n",
        "MUSE_SPARK_PROVIDER 127.0.0.1 4321 tok-1\n",
    ]
    from .test_runtime import Harness

    harness = Harness(lines)
    controller = harness.controller()
    workbench = FakeWorkbench()
    runner = FakeRunner(workbench, files={"main.py": b"print('hi')\n"})
    engine = BridgeEngine(FakeBackend(workbench, runner))
    opened = []
    plugin = Plugin(
        workbench,
        controller=controller,
        notices=FakeNotices(),
        opener=lambda url, code: opened.append((url, code)) or url,
        client_factory=lambda *a: ProviderClient(
            *a, connect=lambda *c, **k: peer.plugin_side
        ),
        engine=engine,
        register_exit=lambda fn: None,
    )
    plugin.register()
    with pumping(engine):
        handshake = threading.Thread(
            target=lambda: (peer.read_frame(), peer.send({"v": 1, "type": "welcome"})),
            daemon=True,
        )
        handshake.start()
        plugin._open_worker()
        handshake.join(timeout=5)
        assert opened == [("http://127.0.0.1:4311/", "launch-abc")]
        peer.send(_read_frame())
        reply = peer.read_frame()
    assert reply["ok"] is True
    assert reply["result"]["path"] == "main.py"
    assert runner.sent and runner.sent[0]["name"] == "read_file"
    assert "serial" not in sys.modules
    plugin.shutdown()
    peer.close()
    assert harness.spawned == [[harness.binary, "panel"]]
