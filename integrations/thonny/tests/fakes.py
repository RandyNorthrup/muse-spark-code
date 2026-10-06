"""Fake Thonny lifecycle and displayed context; no real port is opened."""
from types import SimpleNamespace


class FakeWorkbench:
    def __init__(self):
        self.commands = []
        self.handlers = {}
        self.after_calls = []
        self.run_after_inline = True
        self.language = 'en_US'
        self.options = {'run.backend_name': 'MicroPython', 'MicroPython.port': 'COM7'}
        self.console = "print('hi')\nready\n"

    def get_option(self, name):
        return self.language if name == 'general.language' else self.options.get(name)

    def add_command(self, command_id, menu_name, command_label, handler=None, **kwargs):
        self.commands.append(dict(command_id=command_id, menu_name=menu_name,
                                  command_label=command_label, handler=handler, kwargs=kwargs))

    def after(self, ms, func, *args):
        self.after_calls.append((ms, func))
        if self.run_after_inline and ms == 0:
            func(*args)


class FakeRunner:
    def __init__(self, workbench, files=None):
        self.workbench = workbench
        self.files = dict(files or {})
        self.sent = []
        self.proxy = object()
        self.available = True
        self.disconnected = 0
        self.reconnected = 0
        self.postponed = []

    def get_backend_proxy(self):
        return self.proxy if self.available else None

    def send_command(self, command):
        self.sent.append(command)
        raise AssertionError('plugin attempted device I/O')

    def destroy_backend(self):
        self.disconnected += 1
        self.available = False
        self.proxy = None
        self.postponed.clear()

    def restart_backend(self, clean):
        assert clean
        self.reconnected += 1
        self.available = True
        self.proxy = object()


class FakeBackend:
    def __init__(self, workbench, runner):
        from thonnycontrib.muse_spark.runner import ThonnyDeviceBackend
        self.workbench, self.runner = workbench, runner
        self.reads = 0
        self._host = ThonnyDeviceBackend(get_workbench=lambda: workbench,
                                        get_runner=lambda: runner)

    def is_available(self):
        return self.runner.get_backend_proxy() is not None

    def console_text(self):
        self.reads += 1
        return self.workbench.console

    def disconnect_port(self):
        return self._host.disconnect_port()

    def reconnect_port(self, saved):
        return self._host.reconnect_port(saved)
