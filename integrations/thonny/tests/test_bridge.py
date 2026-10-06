"""Tests for the serial-provider bridge.

The engine is driven deterministically: ``submit`` from the test thread,
``progress`` as the Tk thread, the fake runner answering synchronously on
the workbench bus. The provider client is tested over real loopback sockets
against a scripted peer, with a background pumper standing in for Thonny's
``after`` loop.
"""

import contextlib
import queue
import socket
import threading
import time

import pytest

from thonnycontrib.muse_spark import protocol
from thonnycontrib.muse_spark.bridge import ConnectionFailed, ProviderClient
from thonnycontrib.muse_spark.protocol import ProtocolError
from thonnycontrib.muse_spark.runner import BridgeEngine

from .fakes import FakeBackend, FakeRunner, FakeWorkbench


def _approval():
    return {"request_id": "appr-1", "digest": "sha256:abc"}


def _read_frame(request_id="req-1", **overrides):
    message = {
        "v": 1,
        "type": "device_request",
        "id": request_id,
        "approval": _approval(),
        "op": "read",
        "path": "main.py",
    }
    message.update(overrides)
    return message


def _harness(files=None, **engine_kwargs):
    workbench = FakeWorkbench()
    runner = FakeRunner(workbench, files=files or {"main.py": b"print('hi')\n"})
    backend = FakeBackend(workbench, runner)
    engine = BridgeEngine(backend, **engine_kwargs)
    engine.attach()
    return workbench, runner, backend, engine


def _round_trip(engine, message, timeout=5.0):
    pending = engine.submit(message)
    engine.progress()
    return engine.wait(pending, timeout)


@contextlib.contextmanager
def pumping(engine, interval=0.01):
    """Drive ``engine.progress`` in the background like Thonny's after loop."""
    stop = threading.Event()

    def _pump():
        while not stop.is_set():
            try:
                engine.progress()
            except Exception:
                pass
            time.sleep(interval)

    worker = threading.Thread(target=_pump, daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop.set()
        worker.join(timeout=5)


def test_read_routes_through_fake_runner_without_opening_port():
    _, runner, _, engine = _harness()
    reply = _round_trip(engine, _read_frame())
    assert reply["ok"] is True
    assert reply["id"] == "req-1"
    assert reply["result"]["path"] == "main.py"
    assert protocol.b64decode_bytes(reply["result"]["content_b64"]) == b"print('hi')\n"
    assert [(s["name"], s["fields"].get("path")) for s in runner.sent] == [
        ("read_file", "main.py")
    ]
    assert "serial" not in __import__("sys").modules


def test_write_routes_content_bytes():
    _, runner, backend, engine = _harness()
    content = b"import os\n"
    reply = _round_trip(
        engine,
        _read_frame(
            op="write",
            path="boot.py",
            content_b64=protocol.b64encode_bytes(content),
            approval=_write_approval(backend, content),
        ),
    )
    assert reply["ok"] is True
    assert runner.files["boot.py"] == b"import os\n"
    sent = runner.sent[-1]
    assert sent["name"] == "write_file"
    assert sent["fields"]["content_bytes"] == b"import os\n"
    assert sent["fields"]["make_shebang_scripts_executable"] is False


def _write_approval(backend, content=b"x", expiry=None):
    return {"request_id": "approved-write", "digest": protocol.bytes_digest(content),
            "target": backend.target_identity(), "expires_at": expiry or time.time() + 60}


def _write_frame(backend, content=b"x", expiry=None):
    return _read_frame(op="write", content_b64=protocol.b64encode_bytes(content),
                       approval=_write_approval(backend, content, expiry))


@pytest.mark.parametrize("settlement", ["detach", "deadline", "wait"])
def test_settled_or_expired_queued_write_never_dispatches(settlement):
    clock = [0.0]
    _, runner, backend, engine = _harness(monotonic=lambda: clock[0])
    pending = engine.submit(_write_frame(backend))
    if settlement == "detach":
        engine.detach()
        engine.attach()
    elif settlement == "deadline":
        clock[0] = engine.response_timeout
    else:
        assert engine.wait(pending, 0)["error"]["code"] == protocol.ERR_TIMEOUT
    engine.progress()
    assert runner.sent == []
    assert engine.wait(pending, 0)["ok"] is False
    assert not engine._pending


def test_approval_expiry_is_rechecked_at_dispatch():
    clock = [10.0]
    _, runner, backend, engine = _harness(wall_time=lambda: clock[0])
    pending = engine.submit(_write_frame(backend, expiry=11.0))
    clock[0] = 11.0
    engine.progress()
    assert runner.sent == []
    assert engine.wait(pending, 0)["error"]["code"] == protocol.ERR_EXPIRED_APPROVAL


def test_changed_bytes_are_rechecked_at_dispatch():
    _, runner, backend, engine = _harness()
    pending = engine.submit(_write_frame(backend))
    pending.content = b"different"
    engine.progress()
    assert runner.sent == []
    assert engine.wait(pending, 0)["error"]["code"] == protocol.ERR_MISSING_APPROVAL


@pytest.mark.parametrize("switch", ["runner", "proxy", "before_submit"])
def test_production_backend_refuses_changed_approved_target(switch):
    from thonnycontrib.muse_spark.runner import ThonnyDeviceBackend
    from .fakes import dict_command

    workbench = FakeWorkbench()
    board_a, board_b = FakeRunner(workbench), FakeRunner(workbench)
    current = [board_a]
    backend = ThonnyDeviceBackend(get_workbench=lambda: workbench,
                                 get_runner=lambda: current[0], command_factory=dict_command)
    engine = BridgeEngine(backend)
    engine.attach()
    message = _write_frame(backend)
    if switch == "before_submit":
        current[0] = board_b
    pending = engine.submit(message)
    if switch == "runner":
        current[0] = board_b
    elif switch == "proxy":
        board_a.proxy = object()
    engine.progress()
    assert board_a.sent == board_b.sent == []
    assert engine.wait(pending, 0)["error"]["code"] == protocol.ERR_TARGET_CHANGED


def test_empty_write_creates_and_truncates_device_files():
    _, runner, backend, engine = _harness()
    for path in ("empty.py", "main.py"):
        frame = _write_frame(backend, content=b"")
        frame["path"] = path
        assert _round_trip(engine, frame)["ok"] is True
        assert runner.files[path] == b""


def test_info_sends_nothing_to_device():
    _, runner, _, engine = _harness()
    message = _read_frame(op="info")
    del message["path"]
    reply = _round_trip(engine, message)
    assert reply["ok"] is True
    assert reply["result"]["connected"] is True
    assert runner.sent == []


def test_request_without_approval_never_reaches_runner():
    _, runner, _, engine = _harness()
    message = _read_frame()
    del message["approval"]
    with pytest.raises(ProtocolError) as caught:
        engine.submit(message)
    assert caught.value.code == protocol.ERR_MISSING_APPROVAL
    assert runner.sent == []


def test_request_with_unknown_op_never_reaches_runner():
    _, runner, _, engine = _harness()
    with pytest.raises(ProtocolError):
        engine.submit(_read_frame(op="erase"))
    assert runner.sent == []


def test_no_backend_short_circuits():
    _, runner, _, engine = _harness()
    runner.available = False
    reply = _round_trip(engine, _read_frame())
    assert reply["ok"] is False
    assert reply["error"]["code"] == protocol.ERR_NO_BACKEND
    assert runner.sent == []


def test_backend_error_surfaces():
    _, _, _, engine = _harness(files={})
    reply = _round_trip(engine, _read_frame(path="missing.py"))
    assert reply["ok"] is False
    assert reply["error"]["code"] == protocol.ERR_BACKEND_ERROR


def test_silent_backend_times_out_and_detaches_cleanly():
    workbench, runner, backend, engine = _harness()
    runner.respond = False
    quick = BridgeEngine(backend, response_timeout=0.05)
    quick.attach()
    pending = quick.submit(_read_frame())
    quick.progress()
    time.sleep(0.1)
    quick.progress()
    started = time.monotonic()
    reply = quick.wait(pending, timeout=5.0)
    assert time.monotonic() - started < 2.0, "timed-out request must not block the full wait"
    assert reply["ok"] is False
    assert reply["error"]["code"] == protocol.ERR_TIMEOUT
    quick.detach()
    assert workbench.handlers["InlineResponse"] == {engine._on_response}
    # The surviving engine still works after the timed-out one detached.
    runner.respond = True
    assert _round_trip(engine, _read_frame(request_id="req-2"))["ok"] is True


def test_detach_fails_pending_with_not_connected():
    _, _, _, engine = _harness()
    pending = engine.submit(_read_frame())
    engine.detach()
    started = time.monotonic()
    reply = engine.wait(pending, timeout=5.0)
    assert time.monotonic() - started < 2.0, "detached request must fail at once"
    assert reply["ok"] is False
    assert reply["error"]["code"] == protocol.ERR_NOT_CONNECTED


def test_stray_responses_are_ignored():
    workbench, runner, _, engine = _harness()
    runner.respond = False
    pending = engine.submit(_read_frame())
    engine.progress()
    workbench.event_generate(
        "InlineResponse", event={"command_id": "never-sent", "content_bytes": b"x"}
    )
    assert not pending.done.is_set(), "a stray response completed a request"
    workbench.event_generate(
        "InlineResponse",
        event={
            "command_id": runner.sent[0]["id"],
            "path": "main.py",
            "content_bytes": b"print('hi')\n",
        },
    )
    reply = engine.wait(pending, timeout=5.0)
    assert reply["ok"] is True
    assert protocol.b64decode_bytes(reply["result"]["content_b64"]) == b"print('hi')\n"


_CLOSED = object()


class _PipeEnd:
    """One end of an in-memory socket pair.

    Real loopback sockets are used by the product code; the tests use this
    double instead, because hermetic tests must also run where listening
    sockets are forbidden. It honours the slice of the socket API the
    provider client touches: ``sendall``, ``recv``, ``settimeout``,
    ``shutdown`` and ``close``, including waking a blocked ``recv`` on
    ``shutdown``/``close`` like a real socket does.
    """

    def __init__(self) -> None:
        self.inbox: queue.Queue = queue.Queue()
        self.peer = None
        self.timeout = 5.0
        self._buffer = b""
        self.closed = False

    def settimeout(self, timeout):
        self.timeout = timeout

    def sendall(self, data):
        if self.peer is None or self.peer.closed or self.closed:
            raise OSError("socket is closed")
        self.peer.inbox.put(bytes(data))

    def recv(self, size):
        if self._buffer:
            out, self._buffer = self._buffer[:size], self._buffer[size:]
            return out
        try:
            chunk = self.inbox.get(timeout=self.timeout)
        except queue.Empty:
            raise socket.timeout("timed out")
        if chunk is _CLOSED:
            raise OSError("socket is closed")
        if chunk == b"":
            return b""
        out, self._buffer = chunk[:size], chunk[size:]
        return out

    def shutdown(self, _how):
        self.inbox.put(_CLOSED)
        if self.peer is not None:
            self.peer.inbox.put(b"")

    def close(self):
        self.closed = True
        self.inbox.put(_CLOSED)


def _socket_pair():
    first, second = _PipeEnd(), _PipeEnd()
    first.peer, second.peer = second, first
    return first, second


class Peer:
    """The scripted runtime side of an in-memory socket pair."""

    def __init__(self):
        self.plugin_side, self.runtime_side = _socket_pair()
        self.plugin_side.settimeout(5)
        self.runtime_side.settimeout(5)

    def read_frame(self):
        chunks = []
        while True:
            piece = self.runtime_side.recv(4096)
            assert piece, "plugin hung up"
            chunks.append(piece)
            if piece.endswith(b"\n"):
                return protocol.decode_frame(b"".join(chunks))

    def send(self, message):
        self.runtime_side.sendall(protocol.encode_frame(message))

    def close(self):
        self.plugin_side.close()
        self.runtime_side.close()


def _connect_client(peer, engine, token="tok-1", welcome=True):
    """Run the hello/welcome handshake; returns the connected client."""
    received = {}

    def peer_side():
        received.update(peer.read_frame())
        if welcome:
            peer.send({"v": 1, "type": "welcome"})
        else:
            peer.send(
                {
                    "v": 1,
                    "type": "error",
                    "error": {"code": "auth_failed", "message": "bad token"},
                }
            )

    thread = threading.Thread(target=peer_side, daemon=True)
    thread.start()
    client = ProviderClient(
        "127.0.0.1", 1, token, engine, connect=lambda *a, **k: peer.plugin_side
    )
    try:
        client.connect()
    finally:
        thread.join(timeout=5)
    assert received.get("provider") == "thonny"
    assert received.get("token") == token
    return client


def test_hello_then_read_round_trip_over_socket():
    peer = Peer()
    _, runner, _, engine = _harness()
    client = _connect_client(peer, engine)
    assert client.is_connected
    with pumping(engine):
        worker = client.start_thread()
        peer.send(_read_frame())
        reply = peer.read_frame()
        client.close()
        worker.join(timeout=5)
    assert reply["ok"] is True
    assert reply["id"] == "req-1"
    assert protocol.b64decode_bytes(reply["result"]["content_b64"]) == b"print('hi')\n"
    assert [s["name"] for s in runner.sent] == ["read_file"]
    peer.close()


def test_wrong_token_is_refused_before_any_device_touch():
    peer = Peer()
    _, runner, _, engine = _harness()
    thread_holder = {}

    def peer_side():
        hello = peer.read_frame()
        thread_holder.update(hello)
        peer.send(
            {
                "v": 1,
                "type": "error",
                "error": {"code": "auth_failed", "message": "bad token"},
            }
        )

    thread = threading.Thread(target=peer_side, daemon=True)
    thread.start()
    client = ProviderClient(
        "127.0.0.1", 1, "wrong", engine, connect=lambda *a, **k: peer.plugin_side
    )
    with pytest.raises(ConnectionFailed, match="token"):
        client.connect()
    thread.join(timeout=5)
    assert thread_holder["token"] == "wrong"
    assert runner.sent == []
    assert not client.is_connected
    peer.close()


def test_unapproved_frame_gets_error_reply_and_no_device_touch():
    peer = Peer()
    _, runner, _, engine = _harness()
    client = _connect_client(peer, engine)
    with pumping(engine):
        worker = client.start_thread()
        bad = _read_frame()
        del bad["approval"]
        peer.send(bad)
        reply = peer.read_frame()
        client.close()
        worker.join(timeout=5)
    assert reply["ok"] is False
    assert reply["error"]["code"] == protocol.ERR_MISSING_APPROVAL
    assert runner.sent == []
    peer.close()


def test_oversize_frame_drops_connection_untouched():
    peer = Peer()
    _, runner, _, engine = _harness()
    client = _connect_client(peer, engine)
    worker = client.start_thread()
    peer.runtime_side.sendall(b"x" * (protocol.FRAME_MAX_BYTES + 16))
    peer.runtime_side.shutdown(socket.SHUT_WR)
    worker.join(timeout=5)
    assert runner.sent == []
    assert not client.is_connected
    peer.close()


def test_pipelined_frames_are_each_served_in_turn():
    peer = Peer()
    _, runner, _, engine = _harness()
    client = _connect_client(peer, engine)
    with pumping(engine):
        worker = client.start_thread()
        peer.runtime_side.sendall(
            protocol.encode_frame(_read_frame(request_id="req-1"))
            + protocol.encode_frame(_read_frame(request_id="req-2"))
        )
        first = peer.read_frame()
        second = peer.read_frame()
        client.close()
        worker.join(timeout=5)
    assert (first["id"], first["ok"]) == ("req-1", True)
    assert (second["id"], second["ok"]) == ("req-2", True)
    assert [s["name"] for s in runner.sent] == ["read_file", "read_file"]
    peer.close()


def test_read_frame_reports_oversize_precisely():
    peer = Peer()
    _, _, _, engine = _harness()
    client = ProviderClient(
        "127.0.0.1", 1, "tok", engine, connect=lambda *a, **k: peer.plugin_side
    )
    client._sock = peer.plugin_side
    peer.runtime_side.sendall(b"z" * (protocol.FRAME_MAX_BYTES + 16))
    peer.runtime_side.shutdown(socket.SHUT_WR)
    with pytest.raises(ProtocolError) as caught:
        client._read_frame()
    assert caught.value.code == protocol.ERR_FRAME_TOO_LARGE
    peer.close()


@pytest.mark.parametrize("host", ["203.0.113.10", "192.168.1.3", "localhost", "::1", "127.0.0.2"])
def test_foreign_provider_never_connects_or_sends_token(host):
    _, runner, _, engine = _harness()
    calls = []
    client = ProviderClient(host, 1234, "synthetic-token", engine,
                            connect=lambda *a, **k: calls.append(a))
    with pytest.raises(ConnectionFailed, match="127.0.0.1"):
        client.connect()
    assert calls == runner.sent == []


def test_idle_provider_survives_handshake_timeout_and_close_wakes_receive():
    peer = Peer()
    _, _, _, engine = _harness()
    peer.send({"v": 1, "type": "welcome"})
    client = ProviderClient("127.0.0.1", 1, "synthetic-token", engine,
                            connect=lambda *a, **k: peer.plugin_side, connect_timeout=0.02)
    client.connect()
    peer.read_frame()
    worker = client.start_thread()
    try:
        time.sleep(0.06)
        assert client.is_connected and worker.is_alive()
        with pumping(engine):
            peer.send(_read_frame())
            assert peer.read_frame()["ok"] is True
    finally:
        client.close()
        worker.join(2)
        peer.close()
    assert not worker.is_alive()


@pytest.mark.parametrize("error", ["malformed peer", [], None, {"code": 1}, {"code": "x", "message": []}])
def test_malformed_handshake_is_connection_failure(error):
    peer = Peer()
    _, runner, _, engine = _harness()
    peer.send({"v": 1, "type": "error", "error": error})
    client = ProviderClient("127.0.0.1", 1, "synthetic-token", engine,
                            connect=lambda *a, **k: peer.plugin_side)
    with pytest.raises(ConnectionFailed, match="invalid handshake answer"):
        client.connect()
    assert not client.is_connected
    assert runner.sent == []
    peer.close()
