"""Plugin menus/lifecycle, displayed context, and explicit fake-port transfer."""

import pytest
import sys
import threading
import time

from thonnycontrib.muse_spark import (
    CAPTION_STOP,
    COMMAND_OPEN_ID,
    COMMAND_STOP_ID,
    COMMAND_HAND_ID, COMMAND_BACK_ID,
    LABEL_OPEN,
    LABEL_STOP,
    MENU,
    Plugin,
)
from thonnycontrib.muse_spark import protocol
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
    assert set(by_id) == {COMMAND_OPEN_ID, COMMAND_STOP_ID, COMMAND_HAND_ID, COMMAND_BACK_ID}
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


def test_acceptance_open_to_displayed_context_without_device_command():
    """Start, open companion, and read already displayed context only."""
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
            target=lambda: (peer.read_frame(), peer.send({"v": protocol.PROTOCOL_VERSION, "type": "welcome"})),
            daemon=True,
        )
        handshake.start()
        plugin._open_worker()
        handshake.join(timeout=5)
        assert opened == [("http://127.0.0.1:4311/", "launch-abc")]
        peer.send(_read_frame())
        reply = peer.read_frame()
    assert reply["ok"] is True
    assert reply["result"]["text"] == workbench.console
    assert runner.sent == []
    assert "serial" not in sys.modules
    plugin.shutdown()
    peer.close()
    assert harness.spawned == [[harness.binary, "panel"]]


def test_simultaneous_open_clicks_are_serialized():
    entered, release = threading.Event(), threading.Event()
    controller = FakeController()
    start = controller.start

    def blocked_start():
        entered.set()
        assert release.wait(2)
        return start()

    controller.start = blocked_start
    plugin, _, opened, clients = _plugin(controller=controller)
    plugin.on_open()
    assert entered.wait(2)
    plugin.on_open()
    release.set()
    _wait_for(lambda: opened)
    plugin.shutdown()
    assert controller.starts == len(clients) == 1
    assert all(client.closes for client in clients)


def test_shutdown_during_open_cancels_worker_and_stays_closed():
    entered, release = threading.Event(), threading.Event()
    controller = FakeController()
    start = controller.start

    def blocked_start():
        entered.set()
        assert release.wait(2)
        return start()

    controller.start = blocked_start
    plugin, notices, opened, clients = _plugin(controller=controller)
    plugin.on_open()
    assert entered.wait(2)
    closer = threading.Thread(target=plugin.shutdown)
    closer.start()
    _wait_for(lambda: controller.stops)
    release.set()
    closer.join(2)
    plugin.on_open()
    assert not closer.is_alive() and not plugin._open_thread.is_alive()
    assert opened == clients == notices.errors == []
    assert plugin._state == "stopped" and plugin._client is None


def test_shutdown_cancels_blocked_provider_handshake():
    entered = threading.Event()
    client = FakeClient(connected=False)
    closed = threading.Event()

    def connect():
        entered.set()
        from thonnycontrib.muse_spark.bridge import ConnectionFailed
        if not closed.wait(2):
            raise ConnectionFailed("handshake timed out")
        raise ConnectionFailed("closed")

    close = client.close
    client.connect = connect
    client.close = lambda: (close(), closed.set())
    plugin, notices, opened, _ = _plugin(client_factory=lambda *a: client)
    plugin.on_open()
    assert entered.wait(2)
    plugin.shutdown()
    assert closed.is_set() and client.closes
    assert not plugin._open_thread.is_alive()
    assert not client.threads
    assert notices.errors == opened == []


def test_open_reports_malformed_handshake():
    peer = Peer()
    workbench = FakeWorkbench()
    engine = BridgeEngine(FakeBackend(workbench, FakeRunner(workbench)))
    peer.send({"v": protocol.PROTOCOL_VERSION, "type": "error", "error": "malformed peer"})
    plugin, notices, opened, _ = _plugin(
        workbench=workbench, engine=engine,
        client_factory=lambda *args: ProviderClient(*args, connect=lambda *a, **k: peer.plugin_side),
    )
    try:
        plugin._open_worker()
        assert notices.errors and "Cannot reach" in notices.errors[0][0]
        assert not opened and plugin._state == "stopped"
    finally:
        plugin.shutdown()
        peer.close()


def test_open_reports_browser_refusal():
    from thonnycontrib.muse_spark.companion import open_companion

    plugin, notices, _, _ = _plugin(
        opener=lambda url, code: open_companion(url, code, opener=lambda _: False),
    )
    plugin._open_worker()
    assert notices.errors and "Cannot open" in notices.errors[0][0]
    assert plugin._state == "stopped"
    plugin.shutdown()

class FakeSerialSession:
    """Runtime-side fake: lease before open, close before lease release."""
    def __init__(self, runner):
        self.runner = runner
        self.leased = False
        self.opened = False
        self.events = []

    def handle(self, request):
        assert not self.runner.get_backend_proxy(), 'Thonny still owns port'
        if request['op'] == 'acquire':
            assert not self.leased and not self.opened
            self.leased = True
            self.events.append('lease acquired')
            self.opened = True
            self.events.append('serial opened')
            owner = 'runtime'
        else:
            self.opened = False
            self.events.append('serial closed')
            self.leased = False
            self.events.append('lease released')
            owner = 'released'
        return dict(request, type='port_response', ok=True, owner=owner)


def test_hand_over_give_back_disconnect_lease_open_close_release_reconnect():
    peer = Peer()
    workbench, runner = FakeWorkbench(), None
    runner = FakeRunner(workbench)
    backend = FakeBackend(workbench, runner)
    session = FakeSerialSession(runner)
    engine = BridgeEngine(backend)
    plugin, notices, _, _ = _plugin(workbench=workbench, engine=engine,
        client_factory=lambda *a: ProviderClient(*a, connect=lambda *c, **k: peer.plugin_side))
    peer.send({'v': protocol.PROTOCOL_VERSION, 'type': 'welcome'})
    plugin.register()
    try:
        plugin._open_worker()
        assert peer.read_frame()['type'] == 'hello'
        assert runner.disconnected == runner.reconnected == 0 and not session.leased
        by_id = {c['command_id']: c for c in workbench.commands}
        by_id[COMMAND_HAND_ID]['handler']()
        assert runner.disconnected == 1 and not runner.get_backend_proxy()
        request = peer.read_frame()
        assert (request['type'], request['op'], request['port']) == ('port_request', 'acquire', 'COM7')
        peer.send(session.handle(request))
        _wait_for(lambda: not plugin._completions.empty())
        plugin._pump()
        assert session.leased and session.opened and runner.reconnected == 0
        # Ordinary context/device requests can never trigger a transfer.
        peer.send(_read_frame(op='write', approval={'request_id': 'approved'}, content_b64='eA=='))
        assert peer.read_frame()['ok'] is False and not runner.sent
        by_id[COMMAND_BACK_ID]['handler']()
        request = peer.read_frame()
        assert request['op'] == 'release' and runner.reconnected == 0
        peer.send(session.handle(request))
        _wait_for(lambda: not plugin._completions.empty())
        plugin._pump()
        assert not session.leased and not session.opened
        assert runner.reconnected == 1 and runner.get_backend_proxy()
        assert plugin._port_saved is None and notices.errors == []
        assert session.events == ['lease acquired', 'serial opened', 'serial closed', 'lease released']
    finally:
        plugin.shutdown()
        peer.close()


@pytest.mark.parametrize('stage', ['before_hello', 'before_welcome'])
def test_round3_hand_over_waits_for_validated_welcome_and_held_lease(stage):
    peer = Peer()
    workbench = FakeWorkbench()
    runner = FakeRunner(workbench)
    engine = BridgeEngine(FakeBackend(workbench, runner))
    entered, proceed = threading.Event(), threading.Event()

    def factory(*args):
        client = ProviderClient(*args, connect=lambda *a, **k: peer.plugin_side)
        send = client._send

        def send_hello(message):
            if message['type'] == 'hello' and stage == 'before_hello':
                entered.set()
                assert proceed.wait(5)
            send(message)

        client._send = send_hello
        return client

    plugin, notices, opened, _ = _plugin(workbench=workbench, engine=engine,
                                        client_factory=factory)
    session = FakeSerialSession(runner)
    try:
        plugin.on_open()
        if stage == 'before_hello':
            assert entered.wait(5)
        else:
            assert peer.read_frame()['type'] == 'hello'
        plugin.on_hand_port()
        assert not plugin._client.is_connected
        assert runner.disconnected == 0 and runner.get_backend_proxy()
        assert plugin._port_saved is None and plugin._port_thread is None
        assert notices.errors and not opened

        proceed.set()
        if stage == 'before_hello':
            assert peer.read_frame()['type'] == 'hello'
        peer.send({'v': protocol.PROTOCOL_VERSION, 'type': 'welcome'})
        plugin._open_thread.join(5)
        assert not plugin._open_thread.is_alive() and opened
        assert plugin._client.is_connected
        plugin.on_hand_port()
        request = peer.read_frame()
        assert request['type'] == 'port_request' and request['op'] == 'acquire'
        assert runner.disconnected == 1 and runner.reconnected == 0
        assert plugin._port_busy and plugin._completions.empty()
        assert not session.leased and not session.opened
        reply = session.handle(request)
        assert session.leased and session.opened
        peer.send(reply)
        plugin._port_thread.join(5)
        assert not plugin._port_thread.is_alive()
        plugin._pump()
        assert not plugin._port_busy and plugin._port_saved is not None
        assert runner.reconnected == 0
    finally:
        proceed.set()
        plugin.shutdown()
        peer.close()


def test_port_transfer_failure_never_reconnects_automatically():
    workbench = FakeWorkbench()
    runner = FakeRunner(workbench)
    engine = BridgeEngine(FakeBackend(workbench, runner))
    client = FakeClient()
    def refuse(*args):
        from thonnycontrib.muse_spark.bridge import ConnectionFailed
        raise ConnectionFailed('refused')
    client.change_port = refuse
    plugin, notices, _, _ = _plugin(workbench=workbench, engine=engine)
    plugin._client = client
    plugin.on_hand_port()
    _wait_for(lambda: not plugin._completions.empty())
    plugin._pump()
    assert runner.disconnected == 1 and runner.reconnected == 0 and plugin._port_saved is not None
    assert notices.errors
    plugin.shutdown()
    assert runner.reconnected == 0


@pytest.mark.parametrize('switch', ['runner', 'port', 'backend', 'connected'])
def test_round1_changed_target_give_back_is_refused(switch):
    from thonnycontrib.muse_spark.runner import ThonnyDeviceBackend, BackendUnavailable
    workbench = FakeWorkbench()
    runner = FakeRunner(workbench)
    current = [runner]
    backend = ThonnyDeviceBackend(get_workbench=lambda: workbench, get_runner=lambda: current[0])
    saved = backend.disconnect_port()
    if switch == 'runner':
        current[0] = FakeRunner(workbench)
    elif switch == 'port':
        workbench.options['MicroPython.port'] = 'COM8'
    elif switch == 'backend':
        workbench.options['run.backend_name'] = 'Other'
    else:
        runner.available, runner.proxy = True, object()
    with pytest.raises(BackendUnavailable):
        backend.reconnect_port(saved)
    assert not runner.reconnected


def test_port_release_refusal_or_bad_reply_never_reconnects():
    peer = Peer()
    workbench = FakeWorkbench()
    runner = FakeRunner(workbench)
    engine = BridgeEngine(FakeBackend(workbench, runner))
    plugin, notices, _, _ = _plugin(workbench=workbench, engine=engine,
        client_factory=lambda *a: ProviderClient(*a, connect=lambda *c, **k: peer.plugin_side))
    peer.send({'v': protocol.PROTOCOL_VERSION, 'type': 'welcome'})
    try:
        plugin._open_worker()
        peer.read_frame()
        plugin._port_saved = engine.backend.disconnect_port()
        plugin.on_give_port()
        request = peer.read_frame()
        peer.send(dict(request, type='port_response', ok=True, owner='runtime'))
        _wait_for(lambda: not plugin._completions.empty())
        plugin._pump()
        assert not runner.reconnected and notices.errors
    finally:
        plugin.shutdown()
        peer.close()


def test_round2_shutdown_joins_stop_workers_and_closed_plugin_starts_nothing():
    entered, release = threading.Event(), threading.Event()
    controller = FakeController()
    def stopping():
        entered.set()
        assert release.wait(2)
        time.sleep(0.05)
    controller.stop_machine = stopping
    original_stop = controller.stop
    controller.stop = lambda: (original_stop(), release.set())
    plugin, _, _, _ = _plugin(controller=controller)
    plugin.on_stop()
    assert entered.wait(2)
    workers = list(plugin._stop_threads)
    plugin.shutdown()
    plugin.on_stop()
    assert all(not worker.is_alive() for worker in workers) and not plugin._stop_threads
