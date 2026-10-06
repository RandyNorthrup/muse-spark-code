"""Structural guard: the plugin never opens a serial port itself.

Thonny owns the port while connected (D83.17); every device byte travels
through Thonny's runner via the bridge engine. So no module of this
package may import a serial/USB/Bluetooth stack (or ``ctypes`` for
reaching one): device access that bypasses the runner would also bypass
the engine's per-action approval. This test fails the suite the moment
such an import appears.
"""

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
