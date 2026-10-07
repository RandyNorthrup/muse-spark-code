#!/usr/bin/env python3
"""Run the actual post-install admission statements against isolated roots."""

from pathlib import Path
import subprocess
import tempfile

base = Path(__file__).resolve().parents[2]
source = (base / "os/mkosi.postinst").read_text()
# Execute the unchanged final shell statements, without running the unrelated
# systemd host adapters. Fixtures are private temporary directories, never /var.
admission = source.split("# No sign-in", 1)[1]
script = "set -eu\nroot=$BUILDROOT\n# No sign-in" + admission


def run(root):
    return subprocess.run(
        ["sh", "-c", script],
        env={"BUILDROOT": str(root)},
        capture_output=True,
        text=True,
    ).returncode


with tempfile.TemporaryDirectory(prefix="os1-postinst-") as temporary:
    root = Path(temporary)
    assert run(root) == 0, "postinst accepts an empty installation"
    for path, name in (
        ("var/lib/muse-spark-code-node/state.v1.json", "preconfigured node state"),
        ("usr/bin/muse", "unqualified Muse Code CLI"),
        ("usr/bin/google-chrome", "Chrome before terms consent"),
    ):
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.touch()
        try:
            assert run(root) != 0, "postinst admitted " + name
            print("PASS: postinst refuses " + name)
        finally:
            file.unlink()
