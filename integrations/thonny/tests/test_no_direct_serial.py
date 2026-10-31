"""Structural guards: no device stack, command sender, or write operation."""

import ast
from pathlib import Path

FORBIDDEN_TOP_LEVELS = {
    "serial",  # pyserial
    "pyserial",
    "usb",  # pyusb
    "bluetooth",
    "pybluez",
    "win32file",  # pywin32 device handles
    "win32pipe",
    "ctypes",  # no hand-rolled port opening either
}

PACKAGE_ROOT = Path(__file__).resolve().parent.parent / "src" / "thonnycontrib"


def _imports_of(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module.split(".")[0])
    return found


def test_no_module_imports_a_device_stack():
    offenders = {}
    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        bad = _imports_of(path) & FORBIDDEN_TOP_LEVELS
        if bad:
            offenders[str(path.relative_to(PACKAGE_ROOT))] = sorted(bad)
    assert not offenders, "device-stack imports outside the runner: %r" % (offenders,)


def test_forbidden_list_covers_pyserial():
    assert {"serial", "pyserial", "ctypes"} <= FORBIDDEN_TOP_LEVELS


def test_round1_round2_no_thonny_device_command_or_write_path_exists():
    forbidden = {"send_command", "send_command_and_wait", "send_inline",
                 "_send_msg", "send_program_input", "submit_command", "execute_source",
                 "write_file", "read_file", "InlineCommand", "ImmediateCommand"}
    offenders = []
    for path in PACKAGE_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            value = None
            if isinstance(node, ast.Attribute):
                value = node.attr
            elif isinstance(node, ast.Name):
                value = node.id
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                value = node.value
            if value in forbidden:
                offenders.append((path.name, node.lineno, value))
    assert not offenders, "Thonny device command path exists: %r" % offenders
