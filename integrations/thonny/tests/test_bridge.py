"""Bounded displayed context and socket regressions; no device commands."""
import contextlib
import queue
import socket
import threading
import time
import secrets

import pytest

from thonnycontrib.muse_spark import protocol
from thonnycontrib.muse_spark.bridge import ConnectionFailed, ProviderClient
from thonnycontrib.muse_spark.protocol import ProtocolError
from thonnycontrib.muse_spark.runner import BridgeEngine, CONTEXT_MAX_CHARS
from .fakes import FakeBackend, FakeRunner, FakeWorkbench


def _read_frame(request_id="req-1", **overrides):
    message = {"v": protocol.PROTOCOL_VERSION, "type": "device_request",
               "id": request_id, "op": "context"}
    message.update(overrides)
    return message


def _harness(files=None, **engine_kwargs):
    workbench = FakeWorkbench()
    runner = FakeRunner(workbench, files)
    backend = FakeBackend(workbench, runner)
    engine = BridgeEngine(backend, **engine_kwargs)
    engine.attach()
    return workbench, runner, backend, engine


def _round_trip(engine, message, timeout=5):
    pending = engine.submit(message)
    engine.progress()
    return engine.wait(pending, timeout)


@contextlib.contextmanager
def pumping(engine, interval=0.01):
    stop = threading.Event()
    def pump():
        while not stop.is_set():
            engine.progress()
            stop.wait(interval)
    worker = threading.Thread(target=pump, daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop.set()
        worker.join(5)


def test_read_routes_only_displayed_console_without_device_commands():
    wb, runner, backend, engine = _harness()
    wb.console = 'old' * CONTEXT_MAX_CHARS + 'shown'
    reply = _round_trip(engine, _read_frame())
    assert reply['ok'] and reply['result']['text'] == wb.console[-CONTEXT_MAX_CHARS:]
    assert runner.sent == [] and backend.reads == 1


@pytest.mark.parametrize('settlement', ['detach', 'deadline', 'wait'])
def test_round1_settled_or_expired_context_never_reads_host(settlement):
    clock = [0.0]
    _, runner, backend, engine = _harness(monotonic=lambda: clock[0])
    pending = engine.submit(_read_frame())
    if settlement == 'detach':
        engine.detach()
        engine.attach()
    elif settlement == 'deadline':
        clock[0] = engine.response_timeout
    else:
        engine.wait(pending, 0)
    engine.progress()
    assert not engine.wait(pending, 0)['ok']
    assert not backend.reads and not runner.sent


@pytest.mark.parametrize('content', ['', 'eA==', '!!!'])
@pytest.mark.parametrize('settlement', ['detach', 'deadline', 'timeout', 'switch'])
def test_round1_round2_writes_absent_even_approved_busy_switched_or_empty(content, settlement):
    _, runner, _, engine = _harness()
    runner.postponed.append({'other': 'host command'})
    if settlement == 'detach':
        engine.detach()
    if settlement == 'switch':
        runner.proxy = object()
    with pytest.raises(ProtocolError) as caught:
        engine.submit(_read_frame(op='write', path='main.py', content_b64=content,
                                  approval={'request_id': 'approved', 'digest': 'sha256:exact',
                                            'target': 'board-A', 'expires_at': 2000000000}))
    assert caught.value.code == protocol.ERR_UNKNOWN_OP
    engine.progress()
    assert not runner.sent and len(runner.postponed) == 1


def test_round2_oversized_read_reports_bounded_honest_response():
    wb, runner, _, engine = _harness()
    wb.console = 'x' * (50 * 1024)
    reply = _round_trip(engine, _read_frame())
    assert protocol.decode_frame(protocol.encode_frame(reply)) == reply
    assert len(reply['result']['text']) == CONTEXT_MAX_CHARS and not runner.sent


def test_round2_unsendable_result_is_error_not_success(monkeypatch):
    import thonnycontrib.muse_spark.runner as host
    wb, _, _, engine = _harness()
    wb.console = 'x' * (50 * 1024)
    monkeypatch.setattr(host, 'CONTEXT_MAX_CHARS', len(wb.console))
    monkeypatch.setattr(protocol, 'FRAME_MAX_BYTES', 1000)
    reply = _round_trip(engine, _read_frame())
    assert not reply['ok'] and reply['error']['code'] == protocol.ERR_FRAME_TOO_LARGE
    assert protocol.decode_frame(protocol.encode_frame(reply)) == reply


def test_info_without_backend_is_honest_and_sends_nothing():
    _, runner, _, engine = _harness()
    runner.available = False
    reply = _round_trip(engine, _read_frame(op='info'))
    assert reply['result'] == {'connected': False, 'read_only': True}
    assert not _round_trip(engine, _read_frame())['ok'] and not runner.sent


def _socket_pair():
    return socket.socketpair()


class Peer:
    """The scripted runtime side of an in-memory socket pair."""

    def __init__(self):
        self.plugin_side, self.runtime_side = _socket_pair()
        self.plugin_side.settimeout(5)
        self.runtime_side.settimeout(5)
        self.leftover = b""

    def read_frame(self):
        data = self.leftover
        while b"\n" not in data:
            piece = self.runtime_side.recv(4096)
            assert piece, "plugin hung up"
            data += piece
        line, self.leftover = data.split(b"\n", 1)
        return protocol.decode_frame(line + b"\n")

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
            peer.send({"v": protocol.PROTOCOL_VERSION, "type": "welcome"})
        else:
            peer.send(
                {
                    "v": protocol.PROTOCOL_VERSION,
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
    assert reply["result"]["text"] == "print('hi')\nready\n"
    assert runner.sent == []
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
                "v": protocol.PROTOCOL_VERSION,
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


def test_round3_unready_provider_never_reads_requests_or_sends_port_control(monkeypatch):
    peer = Peer()
    _, _, _, engine = _harness()
    client = ProviderClient('127.0.0.1', 1, 'synthetic-token', engine)
    client._sock = peer.plugin_side  # The connection exists but welcome is pending.

    def premature_io(*args):
        raise AssertionError('provider I/O before validated welcome')

    monkeypatch.setattr(client, '_read_frame', premature_io)
    monkeypatch.setattr(client, '_send', premature_io)
    try:
        with pytest.raises(ConnectionFailed, match='not connected'):
            client.run()
        with pytest.raises(ConnectionFailed):
            client.change_port('acquire', 'COM7')
        assert not client._port_pending
    finally:
        client.close()
        peer.close()


def test_unapproved_frame_gets_error_reply_and_no_device_touch():
    peer = Peer()
    _, runner, _, engine = _harness()
    client = _connect_client(peer, engine)
    with pumping(engine):
        worker = client.start_thread()
        bad = _read_frame()
        bad["op"] = "write"
        peer.send(bad)
        reply = peer.read_frame()
        client.close()
        worker.join(timeout=5)
    assert reply["ok"] is False
    assert reply["error"]["code"] == protocol.ERR_UNKNOWN_OP
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
    assert runner.sent == []
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
    peer.send({"v": protocol.PROTOCOL_VERSION, "type": "welcome"})
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
    peer.send({"v": protocol.PROTOCOL_VERSION, "type": "error", "error": error})
    client = ProviderClient("127.0.0.1", 1, "synthetic-token", engine,
                            connect=lambda *a, **k: peer.plugin_side)
    with pytest.raises(ConnectionFailed, match="invalid handshake answer"):
        client.connect()
    assert not client.is_connected
    assert runner.sent == []
    peer.close()


def test_repeated_close_from_old_client_cannot_detach_replacement():
    old_peer, new_peer = Peer(), Peer()
    _, runner, _, engine = _harness()
    old = _connect_client(old_peer, engine)
    old.close()
    replacement = _connect_client(new_peer, engine)
    try:
        old.close()  # The old worker's finally may run after a fresh attach.
        assert _round_trip(engine, _read_frame())["ok"] is True
        assert runner.sent == []
    finally:
        replacement.close()
        old_peer.close()
        new_peer.close()

@pytest.mark.parametrize('field', ['v', 'type'])
def test_round2_provider_never_logs_peer_bearer_echo(field, caplog):
    peer = Peer()
    _, _, _, engine = _harness()
    bearer = secrets.token_urlsafe()
    client = _connect_client(peer, engine, token=bearer)
    with caplog.at_level('DEBUG', logger='thonnycontrib.muse_spark'):
        worker = client.start_thread()
        # Bypass the encoder only to deliberately send a malformed peer frame.
        import json
        msg = {'v': protocol.PROTOCOL_VERSION, 'type': 'unknown'}
        msg[field] = bearer
        peer.runtime_side.sendall((json.dumps(msg) + '\n').encode())
        if field == 'type':
            peer.runtime_side.shutdown(socket.SHUT_WR)
        worker.join(2)
    client.close()
    peer.close()
    assert not worker.is_alive()
    assert all(bearer not in record.getMessage() for record in caplog.records), 'peer value leaked'


def test_round2_port_reply_timeout_closes_connection_and_cancels_waiter():
    peer = Peer()
    _, _, _, engine = _harness()
    client = _connect_client(peer, engine)
    worker = client.start_thread()
    with pytest.raises(ConnectionFailed):
        client.change_port('acquire', 'COM7', timeout=0.02)
    worker.join(2)
    assert not worker.is_alive() and not client.is_connected and not client._port_pending
    peer.close()
