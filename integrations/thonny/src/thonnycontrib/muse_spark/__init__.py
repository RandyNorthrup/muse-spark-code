"""The ``thonnycontrib.muse_spark`` plugin entry point.

Thonny discovers this module by scanning ``thonnycontrib`` and calls
:func:`load_plugin`, which registers two ``Tools`` menu items:

* **Open Muse Spark** starts the installed ``muse-spark-code-acp`` runtime
  (or reuses the live one), connects the serial-provider bridge to it, and
  opens the companion page in the system browser.
* **Stop machine** (also a toolbar button) sends the machine's own stop
  sequence through the runtime's out-of-band ``stop-machine`` call. It is
  never gated: it needs no approval, no running runtime and no bridge.

``thonny`` is imported lazily inside :func:`load_plugin`, so the rest of
the package (and the test suite) runs without Thonny installed. Everything
Thonny-specific behind this module is faked in the tests.
"""

from __future__ import annotations

import atexit
import logging
import threading
from typing import Any, Callable, Optional

from .bridge import ConnectionFailed, ProviderClient
from .companion import CompanionError, open_companion
from .l10n import text
from .notices import Notices
from .runner import BridgeEngine, ThonnyDeviceBackend
from .runtime import RuntimeController, RuntimeError

log = logging.getLogger("thonnycontrib.muse_spark")

MENU = "tools"
COMMAND_OPEN_ID = "muse_spark_open"
COMMAND_STOP_ID = "muse_spark_stop"
LABEL_OPEN = "Open Muse Spark"
LABEL_STOP = "Stop machine"
CAPTION_STOP = "Stop"
TITLE = "Muse Spark"

#: How often the Tk thread pumps the bridge engine, in milliseconds.
PUMP_INTERVAL_MS = 100
WORKER_JOIN_S = 5.0


class Plugin:
    """Owns the runtime child, the provider connection and the menu
    handlers. All constructor dependencies are injected for the tests."""

    def __init__(
        self,
        workbench: Any,
        controller: Optional[RuntimeController] = None,
        notices: Optional[Notices] = None,
        opener: Callable[[str, str], str] = open_companion,
        client_factory: Optional[Callable[..., ProviderClient]] = None,
        engine: Optional[BridgeEngine] = None,
        register_exit: Callable[[Callable[[], None]], Any] = atexit.register,
    ) -> None:
        self._workbench = workbench
        self._controller = controller or RuntimeController()
        self._notices = notices or Notices()
        self._opener = opener
        self._client_factory = client_factory or ProviderClient
        self._engine = engine or BridgeEngine(
            ThonnyDeviceBackend(get_workbench=lambda: workbench)
        )
        self._client: Optional[ProviderClient] = None
        self._state = "stopped"
        self._lock = threading.RLock()
        self._open_lock = threading.Lock()
        self._closed = False
        self._open_thread = None
        self._provider_thread = None
        register_exit(self.shutdown)

    def register(self) -> None:
        """Add the menu items (and the Stop toolbar button) to Thonny."""
        self._workbench.add_command(
            COMMAND_OPEN_ID, MENU, text(self._workbench, LABEL_OPEN), handler=self.on_open
        )
        self._workbench.add_command(
            COMMAND_STOP_ID,
            MENU,
            text(self._workbench, LABEL_STOP),
            handler=self.on_stop,
            caption=text(self._workbench, CAPTION_STOP),
            include_in_toolbar=True,
        )
        self._schedule_pump()

    def on_open(self, event: Any = None) -> None:
        """Menu handler: runs the start sequence off the Tk thread."""
        with self._lock:
            if self._closed or (self._open_thread is not None and self._open_thread.is_alive()):
                return
            self._open_thread = threading.Thread(target=self._open_worker, daemon=True)
            self._open_thread.start()

    def on_stop(self, event: Any = None) -> None:
        """Menu/toolbar handler: the out-of-band stop, never gated."""
        worker = threading.Thread(target=self._stop_worker, daemon=True)
        worker.start()

    def shutdown(self) -> None:
        """Stop the provider connection and the runtime we started."""
        with self._lock:
            self._closed = True
            client, self._client = self._client, None
            self._state = "stopped"
        if client is not None:
            client.close()
        try:
            self._controller.stop()
        except Exception:
            log.debug("runtime stop at exit failed", exc_info=True)
        self._engine.detach()
        for worker in (self._open_thread, self._provider_thread):
            if worker is not None and worker.ident is not None and worker is not threading.current_thread():
                worker.join(WORKER_JOIN_S)

    def _schedule_pump(self) -> None:
        if self._closed:
            return
        try:
            self._workbench.after(PUMP_INTERVAL_MS, self._pump)
        except Exception:
            log.debug("pump scheduling failed", exc_info=True)

    def _pump(self) -> None:
        try:
            if self._client is not None and self._client.is_connected:
                self._engine.progress()
        except Exception:
            log.debug("bridge pump failed", exc_info=True)
        finally:
            self._schedule_pump()

    def _open_worker(self) -> None:
        with self._open_lock:
            if self._closed:
                return
            self._open_once()

    def _open_once(self) -> None:
        try:
            info = self._controller.start()
        except RuntimeError:
            self._fail("Cannot start Muse Spark", "The runtime could not start. Check its installation and try again.")
            return
        if self._closed:
            self._controller.stop()
            return
        try:
            self._connect_provider(info)
        except (ConnectionFailed, RuntimeError):
            self._fail("Cannot reach Muse Spark", "The local provider connection failed. Close Muse Spark and try again.")
            return
        try:
            if self._closed:
                return
            self._opener(info.companion_url, info.launch_code)
        except CompanionError:
            self._fail("Cannot open Muse Spark", "The system browser could not open the companion page.")
            return
        with self._lock:
            if not self._closed:
                self._state = "running"

    def _connect_provider(self, info: Any) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("runtime start was cancelled")
            if self._client is not None and self._client.is_connected:
                return
            if self._client is not None:
                self._client.close()
                self._client = None
            client = self._client_factory(
                info.provider_host, info.provider_port, info.provider_token, self._engine
            )
            # Publish before the blocking handshake so shutdown can cancel it.
            self._client = client
        client.connect()
        with self._lock:
            if self._closed:
                client.close()
                raise RuntimeError("runtime start was cancelled")
            self._provider_thread = client.start_thread()

    def _stop_worker(self) -> None:
        try:
            self._controller.stop_machine()
        except RuntimeError:
            self._fail("Stop machine failed", "The stop command failed. Use the machine's physical emergency stop if needed.")

    def _fail(self, title: str, message: str) -> None:
        with self._lock:
            self._state = "stopped"
            if self._closed:
                return

        def _show() -> None:
            if not self._closed:
                self._notices.show_error("%s: %s" % (TITLE, text(self._workbench, title)),
                                         text(self._workbench, message))

        try:
            self._workbench.after(0, _show)
        except Exception:
            log.debug("notice scheduling failed", exc_info=True)


def load_plugin() -> None:
    """Thonny's plugin hook: register the Muse Spark menu items."""
    import thonny

    workbench = thonny.get_workbench()
    Plugin(workbench).register()
