"""The serial-provider bridge: Thonny's runner behind the runtime's socket.

The engine owns the approval (D83.3, asked in the runtime's host UI). This
bridge only fulfils ``device_request`` frames that arrive over the runtime's
owner-only socket, and every frame must carry the engine's approval echo
(``approval.request_id`` + ``approval.digest``); anything else is refused
before Thonny's runner is touched.

How a request flows (Thonny 5.0.0 shapes, verified against the wheel):

* ``read`` becomes ``InlineCommand("read_file", path=...)`` and the reply
  carries the backend's ``content_bytes`` base64-encoded;
* ``write`` becomes ``InlineCommand("write_file", path=...,
  content_bytes=..., make_shebang_scripts_executable=False)``;
* ``info`` sends nothing to the device at all: it only reports whether a
  backend is connected.

The send is ``runner.send_command`` (async, no UI). The bridge matches the
backend's ``InlineResponse`` event by ``command_id``. It deliberately never
uses ``runner.send_command_and_wait``: that call pops a modal Tk dialog per
command, which would block the device flow and double-prompt the user.

Threading: the socket thread calls :meth:`BridgeEngine.submit` and waits on
the request's event. All Thonny API calls happen on Thonny's Tk thread via
:meth:`BridgeEngine.progress` (driven by ``workbench.after``) and the
``InlineResponse`` handler. The socket thread never touches Tk.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from . import protocol

log = logging.getLogger("thonnycontrib.muse_spark")

#: How long the bridge waits for the backend's InlineResponse before
#: answering the engine with a timeout error. Device reads over serial can
#: take seconds; this still bounds every request.
RESPONSE_TIMEOUT_S = 30.0


class BackendUnavailable(Exception):
    """No Thonny backend is connected right now."""


class DeviceBackend:
    """The seam between the bridge engine and Thonny's runner.

    The production implementation lives below (:class:`ThonnyDeviceBackend`);
    the tests use a fake. Every method except :meth:`submit`-side queueing
    runs on Thonny's Tk thread.
    """

    def is_available(self) -> bool:
        """True when a backend proxy is connected."""
        raise NotImplementedError

    def node_label(self) -> str:
        """Human label of the connected backend (for ``info`` replies)."""
        raise NotImplementedError

    def target_identity(self) -> str:
        """Opaque identity of this runner/backend connection, never its label."""
        raise NotImplementedError

    def send_inline(self, name: str, fields: Dict[str, Any], command_id: str,
                    target: Optional[str] = None,
                    validate: Optional[Callable[[], None]] = None) -> None:
        """Send one inline command to the backend. Tk thread only."""
        raise NotImplementedError

    def bind_response(self, handler: Callable[[Any], None]) -> None:
        """Subscribe ``handler`` to backend ``InlineResponse`` events."""
        raise NotImplementedError

    def unbind_response(self, handler: Callable[[Any], None]) -> None:
        """Remove a subscription made by :meth:`bind_response`."""
        raise NotImplementedError


@dataclass
class PendingRequest:
    """One validated device request travelling to the backend and back."""

    id: str
    op: str
    path: Optional[str]
    content: Optional[bytes]
    cmd_id: str
    deadline: float
    digest: Optional[str] = None
    target: Optional[str] = None
    expires_at: Optional[float] = None
    done: threading.Event = field(default_factory=threading.Event)
    sent: bool = False
    result: Optional[dict] = None
    error: Optional[tuple] = None


class BridgeEngine:
    """Validates frames, issues backend commands on the Tk thread, and
    matches responses. Thread-safe: ``submit`` is called from the socket
    thread, ``progress`` and the response handler on the Tk thread."""

    def __init__(
        self,
        backend: DeviceBackend,
        new_command_id: Callable[[], str] = lambda: uuid.uuid4().hex,
        monotonic: Callable[[], float] = time.monotonic,
        response_timeout: float = RESPONSE_TIMEOUT_S,
        wall_time: Callable[[], float] = time.time,
    ) -> None:
        self._backend = backend
        self._new_command_id = new_command_id
        self._monotonic = monotonic
        self._response_timeout = response_timeout
        self._wall_time = wall_time
        # The fake runner can answer synchronously inside send_inline.
        self._lock = threading.RLock()
        self._pending: Dict[str, PendingRequest] = {}
        self._outbound: queue.Queue = queue.Queue()
        self._attached = False

    @property
    def response_timeout(self) -> float:
        """Bound for one backend round-trip, in seconds."""
        return self._response_timeout

    def attach(self) -> None:
        """Subscribe to backend responses. Idempotent."""
        if not self._attached:
            self._backend.bind_response(self._on_response)
            self._attached = True

    def detach(self) -> None:
        """Unsubscribe. Fails pending requests with ``not_connected``."""
        with self._lock:
            if self._attached:
                try:
                    self._backend.unbind_response(self._on_response)
                finally:
                    self._attached = False
            self._fail_all(protocol.ERR_NOT_CONNECTED, "bridge is detached")

    def submit(self, message: dict) -> PendingRequest:
        """Validate a frame and queue it. Raises :class:`ProtocolError`
        for anything that must never reach the runner."""
        request = protocol.check_device_request(message)
        op = request["op"]
        content = None
        if op == protocol.OP_WRITE:
            content = protocol.b64decode_bytes(request["content_b64"])
        pending = PendingRequest(
            id=request["id"],
            op=op,
            path=request.get("path"),
            content=content,
            cmd_id=self._new_command_id(),
            deadline=self._monotonic() + self._response_timeout,
            digest=request["approval"]["digest"] if op == protocol.OP_WRITE else None,
            target=request["approval"].get("target") if op == protocol.OP_WRITE else None,
            expires_at=request["approval"].get("expires_at") if op == protocol.OP_WRITE else None,
        )
        if op == protocol.OP_INFO:
            # Presence probe only: never sends a command to the device.
            if self._backend.is_available():
                try:
                    node = self._backend.node_label()
                except Exception:
                    node = "device"
                pending.result = {"connected": True, "node": node,
                                  "target": self._backend.target_identity()}
            else:
                pending.error = (protocol.ERR_NO_BACKEND, "no backend connected")
            pending.done.set()
            return pending
        if not self._backend.is_available():
            pending.error = (protocol.ERR_NO_BACKEND, "no backend connected")
            pending.done.set()
            return pending
        with self._lock:
            if not self._attached:
                self._complete(pending, error=(protocol.ERR_NOT_CONNECTED, "bridge is detached"))
                return pending
            self._pending[pending.cmd_id] = pending
            self._outbound.put(pending)
        return pending

    def progress(self) -> None:
        """Tk thread: send queued commands and sweep expired requests."""
        while True:
            try:
                pending: PendingRequest = self._outbound.get_nowait()
            except queue.Empty:
                break
            # Admission and the synchronous send are atomic with detach/wait.
            with self._lock:
                if pending.done.is_set():
                    continue
                if pending.deadline <= self._monotonic():
                    self._complete(pending, error=(protocol.ERR_TIMEOUT, "backend did not answer in time"))
                    continue
                try:
                    self._send(pending)
                except protocol.ProtocolError as exc:
                    self._complete(pending, error=(exc.code, str(exc)))
                except BackendUnavailable as exc:
                    self._complete(pending, error=(protocol.ERR_NO_BACKEND, str(exc)))
                except Exception as exc:  # pragma: no cover - defensive
                    log.debug("backend send failed", exc_info=True)
                    self._complete(pending, error=(protocol.ERR_BACKEND_ERROR, str(exc)))
        now = self._monotonic()
        expired: List[PendingRequest] = []
        with self._lock:
            for pending in self._pending.values():
                if not pending.done.is_set() and pending.deadline <= now:
                    expired.append(pending)
        for pending in expired:
            self._complete(
                pending, error=(protocol.ERR_TIMEOUT, "backend did not answer in time")
            )

    def wait(self, pending: PendingRequest, timeout: float) -> dict:
        """Block the socket thread until the request completes. Returns the
        ``device_response`` frame (ok or error), never raises for backend
        outcomes."""
        if not pending.done.wait(timeout):
            self._complete(pending, error=(protocol.ERR_TIMEOUT, "backend did not answer in time"))
        if pending.result is not None:
            return protocol.ok_response(pending.id, pending.result)
        code, message = pending.error or (
            protocol.ERR_TIMEOUT,
            "backend did not answer in time",
        )
        return protocol.error_response(pending.id, code, message)

    def _send(self, pending: PendingRequest) -> None:
        if pending.op == protocol.OP_READ:
            assert pending.path is not None
            self._backend.send_inline(
                "read_file", {"path": pending.path}, pending.cmd_id
            )
        elif pending.op == protocol.OP_WRITE:
            assert pending.path is not None and pending.content is not None
            self._check_write(pending)
            self._backend.send_inline(
                "write_file",
                {
                    "path": pending.path,
                    "content_bytes": pending.content,
                    "make_shebang_scripts_executable": False,
                },
                pending.cmd_id,
                target=pending.target,
                validate=lambda: self._check_write(pending),
            )
        else:  # pragma: no cover - submit() only queues read/write
            raise BackendUnavailable("unknown op: %s" % pending.op)
        pending.sent = True

    def _check_write(self, pending: PendingRequest) -> None:
        """Called under the dispatch lock, including at the final runner call."""
        if pending.done.is_set() or not self._attached:
            raise protocol.ProtocolError(protocol.ERR_NOT_CONNECTED, "bridge is detached")
        if pending.deadline <= self._monotonic():
            raise protocol.ProtocolError(protocol.ERR_TIMEOUT, "backend did not answer in time")
        if pending.expires_at is None or pending.expires_at <= self._wall_time():
            raise protocol.ProtocolError(protocol.ERR_EXPIRED_APPROVAL, "write approval expired")
        if pending.content is None or protocol.bytes_digest(pending.content) != pending.digest:
            raise protocol.ProtocolError(protocol.ERR_MISSING_APPROVAL, "write bytes differ from approval")
        if self._backend.target_identity() != pending.target:
            raise protocol.ProtocolError(protocol.ERR_TARGET_CHANGED, "approved device changed")

    def _on_response(self, response: Any) -> None:
        """Tk thread: route one backend ``InlineResponse`` by command id."""
        get = getattr(response, "get", None)
        if not callable(get):
            return
        pending = None
        with self._lock:
            pending = self._pending.get(get("command_id"))
        if pending is None or pending.done.is_set():
            return
        error = get("error") or get("errors")
        if error:
            self._complete(
                pending, error=(protocol.ERR_BACKEND_ERROR, str(error))
            )
            return
        if pending.op == protocol.OP_READ:
            content = get("content_bytes")
            if not isinstance(content, (bytes, bytearray)):
                self._complete(
                    pending,
                    error=(protocol.ERR_BACKEND_ERROR, "read gave no bytes"),
                )
                return
            self._complete(
                pending,
                result={
                    "path": pending.path,
                    "content_b64": protocol.b64encode_bytes(bytes(content)),
                },
            )
        else:
            self._complete(pending, result={"path": pending.path})

    def _complete(
        self,
        pending: PendingRequest,
        result: Optional[dict] = None,
        error: Optional[tuple] = None,
    ) -> None:
        with self._lock:
            if pending.done.is_set():
                return
            self._pending.pop(pending.cmd_id, None)
            if result is not None:
                pending.result = result
            else:
                pending.error = error or (protocol.ERR_BACKEND_ERROR, "failed")
            pending.done.set()

    def _fail_all(self, code: str, message: str) -> None:
        with self._lock:
            pendings = list(self._pending.values())
            for pending in pendings:
                self._complete(pending, error=(code, message))


class ThonnyDeviceBackend(DeviceBackend):
    """The production seam onto Thonny's runner.

    ``thonny`` is imported lazily (only inside the default factories), so
    importing this package never requires Thonny: the tests inject fakes.
    All methods run on Thonny's Tk thread; the one exception,
    :meth:`is_available`, only reads and never calls into Tk widgets.
    """

    def __init__(
        self,
        get_workbench: Optional[Callable[[], Any]] = None,
        get_runner: Optional[Callable[[], Any]] = None,
        command_factory: Optional[Callable[[str, Dict[str, Any], str], Any]] = None,
    ) -> None:
        self._get_workbench = get_workbench or _thonny_workbench
        self._get_runner = get_runner or _thonny_runner
        self._command_factory = command_factory or _thonny_command
        self._identity_lock = threading.Lock()
        self._connection = None
        self._target = ""

    def is_available(self) -> bool:
        try:
            runner = self._get_runner()
            if runner is None:
                return False
            proxy = runner.get_backend_proxy()
            return proxy is not None
        except Exception:
            return False

    def node_label(self) -> str:
        try:
            runner = self._get_runner()
            if runner is None:
                return "no backend"
            label = runner.get_node_label()
            return str(label) if label else "device"
        except Exception:
            return "device"

    def target_identity(self) -> str:
        runner = self._get_runner()
        proxy = runner.get_backend_proxy() if runner is not None else None
        with self._identity_lock:
            if proxy is None:
                self._connection = None
                self._target = ""
                raise BackendUnavailable("no backend connected")
            if (self._connection is None or self._connection[0] is not runner
                    or self._connection[1] is not proxy):
                self._connection = (runner, proxy)
                self._target = uuid.uuid4().hex
            return self._target

    def send_inline(self, name: str, fields: Dict[str, Any], command_id: str,
                    target: Optional[str] = None,
                    validate: Optional[Callable[[], None]] = None) -> None:
        runner = self._get_runner()
        if runner is None:
            raise BackendUnavailable("no backend connected")
        cmd = self._command_factory(name, fields, command_id)
        if target is not None and (self.target_identity() != target
                                   or self._get_runner() is not runner):
            raise protocol.ProtocolError(protocol.ERR_TARGET_CHANGED, "approved device changed")
        if validate is not None:
            validate()
        # Async on purpose: the InlineResponse arrives on the workbench bus,
        # where BridgeEngine._on_response matches it. Never
        # send_command_and_wait here: it pops a modal Tk dialog per command.
        runner.send_command(cmd)

    def bind_response(self, handler: Callable[[Any], None]) -> None:
        workbench = self._get_workbench()
        if workbench is None:  # pragma: no cover - load_plugin always has one
            raise BackendUnavailable("no workbench")
        workbench.bind("InlineResponse", handler, True)

    def unbind_response(self, handler: Callable[[Any], None]) -> None:
        workbench = self._get_workbench()
        if workbench is None:  # pragma: no cover - defensive
            return
        try:
            workbench.unbind("InlineResponse", handler)
        except Exception:
            log.debug("response unbind failed", exc_info=True)


def _thonny_workbench() -> Any:
    import thonny

    return thonny.get_workbench()


def _thonny_runner() -> Any:
    import thonny

    return thonny.get_runner()


def _thonny_command(name: str, fields: Dict[str, Any], command_id: str) -> Any:
    from thonny.common import InlineCommand

    message = InlineCommand(name, id=command_id)
    for key, value in fields.items():
        message[key] = value
    return message
