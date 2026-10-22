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


def test_round3_wire_freeze_describes_context_and_port_control_only():
    root = Path(__file__).resolve().parents[3]
    plan = (root / 'PLAN.md').read_text(encoding='utf-8')
    residual = plan.split('## 9. Security assumptions and accepted residual risk', 1)[1]
    residual = residual.split('**M103T-WIRE-FREEZE', 1)[1].split('\n- **', 1)[0]
    residual = ' '.join(residual.split())
    assert 'accepts no device payloads or write approvals' in residual
    assert 'exports no runner/proxy identity' in residual
    assert '`acquire` succeeds only after lane P\'s lease is held' in residual
    assert '`release` acknowledges only after serial close and lease release' in residual
    assert 'Provider closure must cancel outstanding acquisitions' in residual
    assert 'UTC approval expiry' not in residual and 'Writes require' not in residual
