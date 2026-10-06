"""Read only Thonny's displayed shell; never issue a device command.

Host calls run in the Tk pump. Port transfer uses the public
Runner.destroy_backend / restart_backend APIs on explicit user clicks.
Device I/O belongs exclusively to the runtime's lane-P serial session.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from . import protocol

RESPONSE_TIMEOUT_S = 30.0
CONTEXT_MAX_CHARS = 4096
PORT_MAX_CHARS = 256


class BackendUnavailable(Exception):
    """The requested host context or explicit port is unavailable."""


@dataclass
class PendingRequest:
    id: str
    op: str
    deadline: float
    done: threading.Event = field(default_factory=threading.Event)
    result: Optional[dict] = None
    error: Optional[tuple] = None


class BridgeEngine:
    """Queue bounded context reads for the Tk thread, with cancellation."""

    def __init__(self, backend, monotonic=time.monotonic,
                 response_timeout=RESPONSE_TIMEOUT_S):
        self.backend = backend
        self._monotonic = monotonic
        self.response_timeout = response_timeout
        self._lock = threading.RLock()
        self._outbound = queue.Queue()
        self._pending = []
        self._attached = False

    def attach(self):
        with self._lock:
            self._attached = True

    def detach(self):
        with self._lock:
            self._attached = False
            for pending in list(self._pending):
                self._complete(pending, error=(protocol.ERR_NOT_CONNECTED, 'bridge is detached'))

    def submit(self, message):
        request = protocol.check_device_request(message)
        pending = PendingRequest(request['id'], request['op'],
                                 self._monotonic() + self.response_timeout)
        with self._lock:
            if not self._attached:
                self._complete(pending, error=(protocol.ERR_NOT_CONNECTED, 'bridge is detached'))
            else:
                self._pending.append(pending)
                self._outbound.put(pending)
        return pending

    def progress(self):
        while True:
            try:
                pending = self._outbound.get_nowait()
            except queue.Empty:
                return
            with self._lock:
                if pending.done.is_set():
                    continue
                if pending.deadline <= self._monotonic():
                    self._complete(pending, error=(protocol.ERR_TIMEOUT, 'context read timed out'))
                    continue
                try:
                    if pending.op == protocol.OP_INFO:
                        result = {'connected': self.backend.is_available(), 'read_only': True}
                    else:
                        if not self.backend.is_available():
                            raise BackendUnavailable()
                        content = self.backend.console_text()
                        if not isinstance(content, str):
                            raise BackendUnavailable()
                        result = {'text': content[-CONTEXT_MAX_CHARS:], 'source': 'thonny_shell'}
                    protocol.encode_frame(protocol.ok_response(pending.id, result))
                    self._complete(pending, result=result)
                except protocol.ProtocolError as exc:
                    self._complete(pending, error=(exc.code, 'context response exceeds size limit'))
                except Exception:
                    self._complete(pending, error=(protocol.ERR_NO_BACKEND, 'host context is unavailable'))

    def wait(self, pending, timeout):
        if not pending.done.wait(timeout):
            self._complete(pending, error=(protocol.ERR_TIMEOUT, 'context read timed out'))
        if pending.result is not None:
            return protocol.ok_response(pending.id, pending.result)
        return protocol.error_response(pending.id, *pending.error)

    def _complete(self, pending, result=None, error=None):
        with self._lock:
            if pending.done.is_set():
                return
            if pending in self._pending:
                self._pending.remove(pending)
            pending.result, pending.error = result, error
            pending.done.set()


class ThonnyDeviceBackend:
    """Host context and lifecycle only. There is no command factory or sender."""

    def __init__(self, get_workbench: Optional[Callable[[], Any]] = None,
                 get_runner: Optional[Callable[[], Any]] = None,
                 get_shell: Optional[Callable[[], Any]] = None):
        self._get_workbench = get_workbench or _thonny_workbench
        self._get_runner = get_runner or _thonny_runner
        self._get_shell = get_shell or _thonny_shell

    def is_available(self):
        runner = self._get_runner()
        return runner is not None and runner.get_backend_proxy() is not None

    def console_text(self):
        return self._get_shell().text.get('end-1c - %d chars' % CONTEXT_MAX_CHARS, 'end-1c')

    def disconnect_port(self):
        workbench, runner = self._get_workbench(), self._get_runner()
        if runner is None or runner.get_backend_proxy() is None:
            raise BackendUnavailable()
        name = workbench.get_option('run.backend_name')
        if not isinstance(name, str) or not name:
            raise BackendUnavailable()
        port = workbench.get_option(name + '.port')
        if (not isinstance(port, str) or not port or len(port) > PORT_MAX_CHARS
                or port in ('auto', 'webrepl') or any(ch.isspace() for ch in port)):
            raise BackendUnavailable()
        runner.destroy_backend()
        if runner.get_backend_proxy() is not None:
            raise BackendUnavailable()
        return runner, name, port

    def reconnect_port(self, saved):
        runner, name, port = saved
        workbench = self._get_workbench()
        if (self._get_runner() is not runner or runner.get_backend_proxy() is not None
                or workbench.get_option('run.backend_name') != name
                or workbench.get_option(name + '.port') != port):
            raise BackendUnavailable()
        runner.restart_backend(clean=True)
        if runner.get_backend_proxy() is None:
            raise BackendUnavailable()


def _thonny_workbench():
    import thonny
    return thonny.get_workbench()


def _thonny_runner():
    import thonny
    return thonny.get_runner()


def _thonny_shell():
    import thonny
    return thonny.get_shell()
