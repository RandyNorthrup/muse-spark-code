"""Starting, stopping and out-of-band stopping of the Muse Spark runtime.

The plugin drives the *installed* ``muse-spark-code-acp`` runtime; it never
bundles or downloads one. Two commands, both named by the plan:

* ``muse-spark-code-acp panel`` (D84) starts the companion server the plugin
  opens in the system browser. The runtime announces its companion URL, the
  launch code and the serial-provider endpoint on its stdout (see
  :mod:`protocol`); anything else it prints is its own log and is ignored.
* ``muse-spark-code-acp stop-machine`` (D83.16) is the out-of-band stop.
  :meth:`RuntimeController.stop_machine` calls it directly and is never
  gated: no approval, no running runtime required, no bridge involved.

Every dependency (process spawning, the clock, logging) is injected, so the
tests run the whole lifecycle against fakes without starting anything real.
"""

from __future__ import annotations

import logging
import queue
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from . import protocol
from .process_tree import spawn_runtime

RUNTIME_BINARY = "muse-spark-code-acp"
PANEL_ARGV = ("panel",)
STOP_ARGV = ("stop-machine",)

#: How long to wait for the runtime's three announcement lines before giving
#: up and terminating the process it started.
ANNOUNCE_TIMEOUT_S = 20.0
#: Bound for a single out-of-band stop call.
STOP_TIMEOUT_S = 15.0
CHILD_WAIT_S = 5.0
OUTPUT_QUEUE_WAIT_S = 0.05

log = logging.getLogger("thonnycontrib.muse_spark")


class RuntimeError(Exception):
    """The runtime is missing, unreadable or refuses to announce itself."""


class RuntimeMissing(RuntimeError):
    """``muse-spark-code-acp`` is not installed (not on PATH)."""


class AnnounceTimeout(RuntimeError):
    """The runtime started but never announced its companion endpoint."""


@dataclass
class RuntimeInfo:
    """Everything the plugin learns from one started runtime."""

    binary: str
    companion_url: str
    launch_code: str
    provider_host: str
    provider_port: int
    provider_token: str


@dataclass
class RuntimeController:
    """Serialize starts and cancel an in-flight start when stop is called."""

    which: Callable[[str], Optional[str]] = shutil.which
    popen: Callable[..., object] = spawn_runtime
    monotonic: Callable[[], float] = time.monotonic
    announce_timeout: float = ANNOUNCE_TIMEOUT_S
    stop_timeout: float = STOP_TIMEOUT_S
    _process: object = field(default=None, repr=False, compare=False)
    _info: Optional[RuntimeInfo] = field(default=None, repr=False, compare=False)
    _lock: object = field(default_factory=threading.RLock, init=False, repr=False)
    _start_lock: object = field(default_factory=threading.Lock, init=False, repr=False)
    _generation: int = field(default=0, init=False, repr=False)
    _reader: object = field(default=None, init=False, repr=False)
    _draining: object = field(default=None, init=False, repr=False)
    _stop_processes: list = field(default_factory=list, init=False, repr=False)
    _closed: bool = field(default=False, init=False, repr=False)

    @property
    def is_running(self) -> bool:
        """True while the controller holds a live runtime child."""
        proc = self._process
        return proc is not None and proc.poll() is None  # type: ignore[union-attr]

    @property
    def info(self) -> Optional[RuntimeInfo]:
        """The current runtime's announcements, or None when not started."""
        return self._info

    def start(self) -> RuntimeInfo:
        """Start the runtime (or reuse the live one) and read its
        announcements. Raises :class:`RuntimeMissing` or
        :class:`AnnounceTimeout`; both leave no child behind."""
        with self._lock:
            generation = self._generation
        with self._start_lock:
            with self._lock:
                if self._closed or generation != self._generation:
                    raise RuntimeError("runtime start was cancelled")
                if self._info is not None and self.is_running:
                    return self._info
                self._stop_child_quietly()
            binary = self.which(RUNTIME_BINARY)
            if not binary:
                raise RuntimeMissing("%s is not installed" % RUNTIME_BINARY)
            proc = None
            try:
                proc = self.popen(
                    [binary, PANEL_ARGV[0]], stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=False,
                )
                with self._lock:
                    if generation != self._generation:
                        raise RuntimeError("runtime start was cancelled")
                    self._process = proc
                    box, draining = queue.Queue(maxsize=1), threading.Event()
                    reader = threading.Thread(target=_drain_output,
                                              args=(proc.stdout, box, draining, proc), daemon=True)
                    self._reader, self._draining = reader, draining
                    reader.start()
                found = self._read_announcements(box, generation)
                with self._lock:
                    if generation != self._generation or self._process is not proc:
                        raise RuntimeError("runtime start was cancelled")
                    self._info = RuntimeInfo(binary=binary, **found)
                    draining.set()
                    # Bearers and child diagnostics are never logged.
                    log.info("runtime announced its companion endpoint")
                    return self._info
            except Exception as exc:
                with self._lock:
                    if self._process is proc:
                        self._stop_child_quietly()
                    elif proc is not None:
                        _stop_process(proc)
                if isinstance(exc, RuntimeError):
                    raise
                raise RuntimeError("runtime could not start") from exc

    def _read_announcements(self, box: queue.Queue, generation: int) -> dict:
        found: dict = {}
        kinds = set()
        deadline = self.monotonic() + self.announce_timeout
        while kinds != {protocol.KEY_COMPANION_URL, protocol.KEY_COMPANION_LAUNCH,
                        protocol.KEY_PROVIDER}:
            with self._lock:
                if generation != self._generation:
                    raise RuntimeError("runtime start was cancelled")
            remaining = deadline - self.monotonic()
            if remaining <= 0:
                raise AnnounceTimeout(
                    "runtime did not announce its companion endpoint in time"
                )
            try:
                line = box.get(timeout=min(remaining, OUTPUT_QUEUE_WAIT_S))
            except queue.Empty:
                continue
            if isinstance(line, Exception):
                raise RuntimeError("runtime output could not be read") from line
            if line is None:
                raise AnnounceTimeout(
                    "runtime closed its output before announcing its endpoint"
                )
            parsed = protocol.parse_announcement(line.rstrip("\r\n"))
            if parsed is None:
                continue
            key, value = parsed
            kinds.add(key)
            if key == protocol.KEY_COMPANION_URL:
                found["companion_url"] = value
            elif key == protocol.KEY_COMPANION_LAUNCH:
                found["launch_code"] = value
            elif key == protocol.KEY_PROVIDER:
                host, port, token = protocol.split_provider_value(value)
                found["provider_host"] = host
                found["provider_port"] = port
                found["provider_token"] = token
        return found

    def stop(self) -> None:
        """Terminate the runtime this controller started. Idempotent; never
        raises for an already-dead or never-started child."""
        with self._lock:
            self._closed = True
            self._generation += 1
            self._stop_child_quietly()
            self._info = None
            for proc in list(self._stop_processes):
                _stop_process(proc)

    def _stop_child_quietly(self) -> None:
        proc, self._process = self._process, None
        self._info = None
        reader, self._reader = self._reader, None
        draining, self._draining = self._draining, None
        if draining is not None:
            draining.set()
        if proc is None:
            return
        _stop_process(proc, reader)

    def stop_machine(self) -> None:
        """Send the machine's own stop sequence out of band.

        Never gated: it needs no approval, no running companion runtime and
        no bridge connection. It raises :class:`RuntimeMissing` when the
        runtime is not installed and :class:`RuntimeError` when the stop
        call itself fails, so the menu handler can say so.
        """
        binary = self.which(RUNTIME_BINARY)
        if not binary:
            raise RuntimeMissing("%s is not installed" % RUNTIME_BINARY)
        proc = None
        with self._lock:
            if self._closed:
                raise RuntimeError("runtime is closed")
            generation = self._generation
        try:
            proc = self.popen([binary, STOP_ARGV[0]], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL)
            with self._lock:
                if generation != self._generation:
                    raise RuntimeError("stop-machine was cancelled")
                self._stop_processes.append(proc)
            if proc.wait(timeout=self.stop_timeout) != 0:
                raise RuntimeError("stop-machine failed")
        except Exception as exc:
            raise RuntimeError("stop-machine failed") from exc
        finally:
            if proc is not None:
                with self._lock:
                    if proc in self._stop_processes:
                        self._stop_processes.remove(proc)
                    _stop_process(proc)


def _drain_output(stream, box, draining, proc):
    """Drain bytes for the whole lifetime; report failures without peer text."""
    while True:
        try:
            line = stream.readline()
        except Exception as exc:
            log.error("runtime output could not be read")
            line = exc
        if isinstance(line, bytes):
            try:
                line = line.decode("utf-8")
            except UnicodeDecodeError:
                log.warning("runtime output contained invalid UTF-8")
                continue
        ended = isinstance(line, Exception) or not line
        if not draining.is_set() and (ended or protocol.parse_announcement(line.rstrip("\r\n"))):
            while not draining.is_set():
                try:
                    box.put(line if line else None, timeout=OUTPUT_QUEUE_WAIT_S)
                    break
                except queue.Full:
                    continue
        if ended:
            if isinstance(line, Exception):
                _stop_process(proc)
            return


def _stop_process(proc, reader=None):
    try:
        # An exited parent may still own live descendants.
        try:
            proc.terminate()
            proc.wait(timeout=CHILD_WAIT_S)
        finally:
            proc.kill()
            proc.wait(timeout=CHILD_WAIT_S)
    except Exception:
        log.debug("runtime child would not stop quietly", exc_info=True)
    finally:
        if reader is not None and reader is not threading.current_thread():
            reader.join(CHILD_WAIT_S)
        close = getattr(proc, "close", None)
        if callable(close):
            close()
