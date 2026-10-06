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
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from . import protocol

RUNTIME_BINARY = "muse-spark-code-acp"
PANEL_ARGV = ("panel",)
STOP_ARGV = ("stop-machine",)

#: How long to wait for the runtime's three announcement lines before giving
#: up and terminating the process it started.
ANNOUNCE_TIMEOUT_S = 20.0
#: Bound for a single out-of-band stop call.
STOP_TIMEOUT_S = 15.0

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
    """Owns at most one runtime child process. Thread-safe by the GIL for
    the plugin's single start/stop discipline (``_process`` is only ever
    replaced under one worker thread at a time)."""

    which: Callable[[str], Optional[str]] = shutil.which
    popen: Callable[..., object] = subprocess.Popen
    run: Callable[..., object] = subprocess.run
    monotonic: Callable[[], float] = time.monotonic
    announce_timeout: float = ANNOUNCE_TIMEOUT_S
    stop_timeout: float = STOP_TIMEOUT_S
    _process: object = field(default=None, repr=False, compare=False)
    _info: Optional[RuntimeInfo] = field(default=None, repr=False, compare=False)

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
        if self._info is not None and self.is_running:
            return self._info
        self._stop_child_quietly()
        binary = self.which(RUNTIME_BINARY)
        if not binary:
            raise RuntimeMissing(
                "%s is not installed" % RUNTIME_BINARY
            )
        proc = self.popen(
            [binary, PANEL_ARGV[0]],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        self._process = proc
        try:
            found = self._read_announcements(proc)
        except Exception:
            self._stop_child_quietly()
            raise
        self._info = RuntimeInfo(binary=binary, **found)
        # Never log the launch code or the provider token: they are bearer
        # credentials for the loopback server, not diagnostics.
        log.info("runtime announced its companion endpoint")
        return self._info

    def _read_announcements(self, proc: object) -> dict:
        found: dict = {}
        deadline = self.monotonic() + self.announce_timeout
        stream = proc.stdout  # type: ignore[union-attr]
        while len(found) < 3:
            remaining = deadline - self.monotonic()
            if remaining <= 0:
                raise AnnounceTimeout(
                    "runtime did not announce its companion endpoint in time"
                )
            line = _readline_with_timeout(stream, remaining)
            if line is None:
                raise AnnounceTimeout(
                    "runtime closed its output before announcing its endpoint"
                )
            parsed = protocol.parse_announcement(line.rstrip("\r\n"))
            if parsed is None:
                continue
            key, value = parsed
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
        self._stop_child_quietly()
        self._info = None

    def _stop_child_quietly(self) -> None:
        proc = self._process
        self._process = None
        if proc is None:
            return
        try:
            if proc.poll() is None:  # type: ignore[union-attr]
                proc.terminate()  # type: ignore[union-attr]
                try:
                    proc.wait(timeout=5)  # type: ignore[union-attr]
                except Exception:
                    proc.kill()  # type: ignore[union-attr]
        except Exception:
            log.debug("runtime child would not stop quietly", exc_info=True)

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
        try:
            completed = self.run(
                [binary, STOP_ARGV[0]],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=self.stop_timeout,
            )
        except Exception as exc:
            raise RuntimeError("stop-machine call failed: %s" % exc)
        if completed.returncode != 0:  # type: ignore[union-attr]
            raise RuntimeError(
                "stop-machine exited %s: %s"
                % (
                    completed.returncode,  # type: ignore[union-attr]
                    (completed.stderr or "").strip(),  # type: ignore[union-attr]
                )
            )


def _readline_with_timeout(stream: object, timeout: float) -> Optional[str]:
    """Read one stdout line without blocking past ``timeout`` seconds.

    ``select`` cannot wait on pipes on Windows, so the read runs in a daemon
    thread and the leftover thread (if any) is abandoned: the process is
    terminated right after, which releases its pipes.
    """
    import queue
    import threading

    box: queue.Queue = queue.Queue(maxsize=1)

    def _reader() -> None:
        try:
            box.put(stream.readline())  # type: ignore[union-attr]
        except Exception as exc:  # pragma: no cover - defensive
            box.put(exc)

    worker = threading.Thread(target=_reader, daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        return None
    item = box.get_nowait()
    if isinstance(item, Exception):
        raise item
    if item == "" or item is None:
        return None
    return item
