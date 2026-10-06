"""Fakes of Thonny's workbench and runner.

They replicate only the surface the plugin uses (verified against the
Thonny 5.0.0 wheel): ``add_command``, ``bind``/``unbind``/``event_generate``
for ``InlineResponse``, ``after``, ``get_runner().send_command`` and the
backend ``read_file`` contract (``path`` in, ``content_bytes`` out). The
fake runner never opens anything: it answers from scripted bytes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


class FakeWorkbench:
    """Records menu registration; dispatches workbench events synchronously."""

    def __init__(self) -> None:
        self.commands: List[dict] = []
        self.handlers: Dict[str, set] = {}
        self.after_calls: List[tuple] = []
        self.run_after_inline = True
        self.language = "en_US"

    def get_option(self, name):
        assert name == "general.language"
        return self.language

    def add_command(self, command_id, menu_name, command_label, handler=None, **kwargs):
        self.commands.append(
            {
                "command_id": command_id,
                "menu_name": menu_name,
                "command_label": command_label,
                "handler": handler,
                "kwargs": kwargs,
            }
        )

    def bind(self, sequence, func, add=None):
        self.handlers.setdefault(sequence, set()).add(func)

    def unbind(self, sequence, func=None):
        try:
            self.handlers[sequence].remove(func)
        except (KeyError, LookupError):
            pass

    def event_generate(self, sequence, event=None, **kwargs):
        for handler in sorted(list(self.handlers.get(sequence, ())), key=str):
            handler(event)

    def after(self, ms, func, *args):
        self.after_calls.append((ms, func))
        if self.run_after_inline:
            func(*args)


class FakeRunner:
    """Answers inline commands from ``files`` without touching any port."""

    def __init__(self, workbench: FakeWorkbench, files: Optional[Dict[str, bytes]] = None) -> None:
        self.workbench = workbench
        self.files = dict(files or {})
        self.sent: List[dict] = []
        self.respond = True
        self.available = True
        self.proxy = object()

    def get_backend_proxy(self):
        return self.proxy if self.available else None

    def get_node_label(self):
        return "MicroPython device"

    def send_command(self, cmd):
        if isinstance(cmd, dict):
            name, cmd_id = cmd["name"], cmd["id"]
            fields = {k: v for k, v in cmd.items() if k not in ("name", "id")}
        else:  # pragma: no cover - the real InlineCommand path
            name, cmd_id = cmd.name, cmd["id"]
            fields = dict(cmd.__dict__)
            fields.pop("name", None)
            fields.pop("id", None)
        self.sent.append({"name": name, "id": cmd_id, "fields": fields})
        if self.respond:
            self.workbench.event_generate(
                "InlineResponse", event=self._answer(name, cmd_id, fields)
            )

    def _answer(self, name, cmd_id, fields):
        if name == "read_file":
            path = fields.get("path")
            if path in self.files:
                return {
                    "command_id": cmd_id,
                    "path": path,
                    "content_bytes": self.files[path],
                }
            return {"command_id": cmd_id, "error": "file not found: %s" % path}
        if name == "write_file":
            self.files[fields.get("path")] = bytes(fields.get("content_bytes", b""))
            return {"command_id": cmd_id, "path": fields.get("path")}
        return {"command_id": cmd_id, "error": "unknown command: %s" % name}


class FakeBackend:
    """A DeviceBackend over the fake runner, wired like the real one."""

    def __init__(self, workbench: FakeWorkbench, runner: FakeRunner) -> None:
        self.workbench = workbench
        self.runner = runner

    def is_available(self):
        return self.runner.get_backend_proxy() is not None

    def node_label(self):
        return self.runner.get_node_label()

    def target_identity(self):
        return "fake-target-" + str(id(self.runner.proxy))

    def send_inline(self, name, fields, command_id, target=None, validate=None):
        from thonnycontrib.muse_spark.runner import BackendUnavailable

        if self.runner.get_backend_proxy() is None:
            raise BackendUnavailable("no backend connected")
        if target is not None and target != self.target_identity():
            raise BackendUnavailable("approved device changed")
        if validate is not None:
            validate()
        self.runner.send_command({"name": name, "id": command_id, **fields})

    def bind_response(self, handler):
        self.workbench.bind("InlineResponse", handler, True)

    def unbind_response(self, handler):
        self.workbench.unbind("InlineResponse", handler)


def dict_command(name: str, fields: Dict[str, Any], command_id: str) -> dict:
    """The test command factory: plain dicts instead of InlineCommand."""
    return {"name": name, "id": command_id, **fields}
