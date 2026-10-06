"""The provider side of the runtime's owner-only socket.

After the plugin starts the runtime, the runtime announces a provider
endpoint (host, port, token). :class:`ProviderClient` connects there over
loopback, proves itself with the token in a ``hello`` frame, and then serves
``device_request`` frames by handing them to the :class:`BridgeEngine`,
which fulfils them through Thonny's already-open connection. The plugin
never opens a serial port itself: there is no ``serial`` import anywhere in
this package (a test fails the suite if one ever appears).

The transport (TCP loopback + token, standard library only) is injected:
lane R/P may swap it for the lease socket without touching the protocol or
the guards. Frames are newline-delimited JSON capped at
``FRAME_MAX_BYTES``; an oversize line closes the connection untouched.
"""

from __future__ import annotations

import logging
import socket
import threading
from typing import Callable, Optional

from . import protocol
from .protocol import ProtocolError
from .runner import BridgeEngine

log = logging.getLogger("thonnycontrib.muse_spark")

#: Bound for connecting and for the runtime's ``welcome`` answer.
CONNECT_TIMEOUT_S = 10.0
#: Extra margin over the engine's own response timeout for one request.
WAIT_MARGIN_S = 5.0


class ConnectionFailed(Exception):
    """The provider endpoint never answered, or refused the token."""


class ProviderClient:
    """One connection from the plugin to the runtime. Blocking I/O runs on
    the caller's thread (the plugin uses a daemon thread); all Thonny calls
    stay on the Tk thread inside the engine."""

    def __init__(
        self,
        host: str,
        port: int,
        token: str,
        engine: BridgeEngine,
        connect: Callable[..., socket.socket] = socket.create_connection,
        connect_timeout: float = CONNECT_TIMEOUT_S,
    ) -> None:
        self._host = host
        self._port = port
        self._token = token
        self._engine = engine
        self._connect = connect
        self._connect_timeout = connect_timeout
        self._sock: Optional[socket.socket] = None
        self._closed = threading.Event()
        self._leftover = b""
        self._lock = threading.RLock()

    @property
    def is_connected(self) -> bool:
        """True between a successful :meth:`connect` and :meth:`close`."""
        return self._sock is not None and not self._closed.is_set()

    def connect(self) -> None:
        """Open the socket and say hello. Raises :class:`ConnectionFailed`
        (wrong token, no welcome, unreachable host) without touching the
        runner."""
        if self._host != "127.0.0.1":
            raise ConnectionFailed("provider host must be 127.0.0.1")
        if self._closed.is_set():
            raise ConnectionFailed("provider connection is closed")
        try:
            sock = self._connect(
                (self._host, self._port), timeout=self._connect_timeout
            )
        except Exception as exc:
            raise ConnectionFailed("cannot reach provider endpoint: %s" % exc)
        with self._lock:
            if self._closed.is_set():
                sock.close()
                raise ConnectionFailed("provider connection is closed")
            sock.settimeout(self._connect_timeout)
            self._sock = sock
        try:
            self._send(protocol.hello_frame(self._token))
            answer = self._read_frame()
            if answer.get("type") != "welcome":
                error = answer.get("error")
                if (answer.get("type") != "error" or not isinstance(error, dict)
                        or not isinstance(error.get("code"), str)
                        or not isinstance(error.get("message"), str)):
                    raise ProtocolError(protocol.ERR_MALFORMED, "invalid handshake answer")
                if error["code"] == protocol.ERR_AUTH_FAILED:
                    raise ConnectionFailed("runtime refused the provider token")
                raise ConnectionFailed("runtime refused the provider connection")
            with self._lock:
                if self._closed.is_set():
                    raise ConnectionFailed("provider connection is closed")
                # The timeout bounds only connection/handshake, not idle use.
                sock.settimeout(None)
                self._engine.attach()
        except Exception as exc:
            self.close()
            raise ConnectionFailed("provider handshake failed: %s" % exc)

    def run(self) -> None:
        """Serve requests until the runtime hangs up or :meth:`close` is
        called. Returns on a clean hangup; raises :class:`ConnectionFailed`
        on anything else."""
        sock = self._sock
        if sock is None:
            raise ConnectionFailed("not connected")
        try:
            while not self._closed.is_set():
                try:
                    message = self._read_frame()
                except _CleanHangup:
                    return
                self._serve(message)
        except ProtocolError as exc:
            # A broken or foreign peer: drop the connection untouched.
            raise ConnectionFailed("protocol error: %s" % exc)
        except OSError as exc:
            raise ConnectionFailed("connection lost: %s" % exc)
        finally:
            self.close()

    def close(self) -> None:
        """Hang up. Idempotent; safe from any thread."""
        with self._lock:
            self._closed.set()
            sock, self._sock = self._sock, None
            if sock is not None:
                self._engine.detach()
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                sock.close()
            except Exception:
                pass

    def start_thread(self) -> threading.Thread:
        """Serve in a daemon thread. Errors are logged, never raised."""
        worker = threading.Thread(target=self._run_logged, daemon=True)
        worker.start()
        return worker

    def _run_logged(self) -> None:
        try:
            self.run()
        except ConnectionFailed as exc:
            log.info("provider connection ended: %s", exc)
        except Exception:  # pragma: no cover - defensive
            log.debug("provider connection failed", exc_info=True)

    def _serve(self, message: dict) -> None:
        if message.get("type") != "device_request":
            log.debug("ignoring non-request frame: %r", message.get("type"))
            return
        try:
            pending = self._engine.submit(message)
        except ProtocolError as exc:
            request_id = message.get("id")
            if isinstance(request_id, str) and request_id:
                self._send(protocol.error_response(request_id, exc.code, str(exc)))
            return
        reply = self._engine.wait(
            pending, self._engine.response_timeout + WAIT_MARGIN_S
        )
        self._send(reply)

    def _send(self, message: dict) -> None:
        assert self._sock is not None
        self._sock.sendall(protocol.encode_frame(message))

    def _read_frame(self) -> dict:
        """Read one ``\\n``-terminated frame. Raises ``_CleanHangup`` on a
        tidy EOF, :class:`ProtocolError` on anything that must be refused.

        TCP may coalesce several frames into one ``recv`` (or split one
        frame across several); bytes past the first newline are kept for
        the next call, so pipelined requests are each served in turn.
        """
        assert self._sock is not None
        data = self._leftover
        self._leftover = b""
        while True:
            cut = data.find(b"\n")
            if cut != -1:
                line = data[: cut + 1]
                self._leftover = data[cut + 1 :]
                return protocol.decode_frame(line)
            if len(data) > protocol.FRAME_MAX_BYTES + 1:
                raise ProtocolError(
                    protocol.ERR_FRAME_TOO_LARGE, "frame exceeds size limit"
                )
            try:
                piece = self._sock.recv(4096)
            except socket.timeout as exc:
                raise ProtocolError(protocol.ERR_TIMEOUT, "read timed out: %s" % exc)
            except OSError as exc:
                raise ConnectionFailed("connection lost: %s" % exc)
            if not piece:
                if not data:
                    raise _CleanHangup()
                raise ProtocolError(protocol.ERR_MALFORMED, "connection cut mid-frame")
            data += piece


class _CleanHangup(Exception):
    """The runtime closed a connection that had no partial frame."""
