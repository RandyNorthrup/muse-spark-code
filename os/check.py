#!/usr/bin/env python3
"""Fail closed when image policy or slot geometry drifts (H01/H11/H15/H17)."""

import configparser
import json
from pathlib import Path
import sys


def config(file):
    # systemd lists allow repeated settings, e.g. ConditionPathExists.
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.read(file)
    return parser


def require(value, reason):
    if not value:
        raise ValueError("OS1 policy: " + reason)


def check(root):
    base = config(root / "mkosi.conf")
    require(base["Distribution"]["Distribution"] == "debian", "Debian base")
    require(base["Distribution"]["Release"] == "trixie", "Debian 13")
    require(base["Distribution"]["Snapshot"] == "20261005T000000Z", "snapshot pin")
    require(base["Content"]["SourceDateEpoch"] == "1791158400", "source epoch pin")
    require(
        base["Output"]["Seed"] == "8821992e-4707-4882-96ce-a8b16b671a09",
        "partition seed",
    )
    require(base["Validation"]["Checksum"] == "yes", "artifact digests")
    resolver = config(
        root / "overlay/usr/lib/systemd/system/systemd-resolved.service.d/muse-var.conf"
    )
    require(
        resolver["Unit"]["RequiresMountsFor"] == "/var/tmp", "resolver mount ordering"
    )
    overlay = config(
        root / "initrd-overlay/usr/lib/systemd/system/muse-overlay-usr.service"
    )
    require(
        overlay["Unit"]["ConditionKernelCommandLine"] == "systemd.volatile=overlay"
        and overlay["Unit"]["After"] == "sysusr-usr.mount systemd-volatile-root.service"
        and overlay["Service"]["ExecStart"]
        == "/usr/bin/mount --bind /sysusr/usr /sysroot/usr"
        and overlay["Service"]["ExecStartPost"]
        == "/usr/bin/mount -o remount,bind,ro /sysroot/usr",
        "verified installer usr",
    )
    require(
        "/usr/lib/systemd/system/initrd-root-fs.target.wants"
        in (root / "mkosi.initrd.postinst").read_text(),
        "initrd vendor dependency",
    )
    parts = {
        file.stem: config(file)["Partition"]
        for file in (root / "repart").glob("*.conf")
    }
    require(
        parts["10-root"]["ExcludeFiles"] == "/usr/ /var/ /boot/ /efi/",
        "root mount points",
    )
    esp = (root / "repart/00-esp.conf").read_text()
    require(
        "CopyFiles=/boot:/" in esp and "CopyFiles=/efi:/" in esp, "EFI and UKI payloads"
    )
    data = parts["20-usr-a"]
    hashes = parts["21-usr-a-verity"]
    require(data["Verity"] == "data" and hashes["Verity"] == "hash", "usr integrity")
    require(
        data["VerityMatchKey"] == hashes["VerityMatchKey"] == "usr-a", "verity pairing"
    )
    require(data["ReadOnly"] == "yes", "read-only usr")
    for active, inactive in (
        ("20-usr-a", "30-usr-b"),
        ("21-usr-a-verity", "31-usr-b-verity"),
    ):
        require(
            parts[active]["SizeMinBytes"] == parts[inactive]["SizeMinBytes"],
            "equal slots",
        )
        require(parts[inactive]["NoAuto"] == "yes", "inactive slot admission")
        require("CopyFiles" not in parts[inactive], "inactive slot empty")
    require(parts["40-var"]["Format"] == "ext4", "persistent var")
    require(parts["40-var"]["GrowFileSystem"] == "yes", "var growth")
    users = (root / "overlay/usr/lib/sysusers.d/muse-node.conf").read_text()
    require(
        "muse-node 61100:61100" in users and "muse-tools 61101:61101" in users,
        "separate users",
    )
    private = (root / "overlay/usr/lib/tmpfiles.d/muse-node.conf").read_text()
    require(
        "d /var/lib/muse-spark-code-node 0700 muse-node muse-node -" in private,
        "private state",
    )
    unit = config(root / "overlay/usr/lib/systemd/system/muse-node.service")
    require(unit["Service"]["User"] == "muse-node", "non-root service")
    require(unit["Service"]["NoNewPrivileges"] == "yes", "no privilege gain")
    require(unit["Service"]["ProtectSystem"] == "strict", "immutable runtime")
    require("--listen" not in unit["Service"]["ExecStart"], "no implicit listener")
    pins = json.loads((root / "pins.json").read_text())
    require(pins["node"]["version"] == "24.18.0", "Node version")
    for arch in ("x86-64", "arm64"):
        value = pins["node"][arch]
        require(
            len(value) == 64 and all(c in "0123456789abcdef" for c in value),
            "Node digest",
        )
    manifest = json.loads((root / "pi/manifest.json").read_text())
    for board in ("pi4", "pi5"):
        kernel = manifest["targets"][board]["kernel"]
        require(
            any(p["package"] == "linux-image-" + kernel for p in manifest["packages"]),
            "Pi kernel pin",
        )
    require(
        any(p["package"] == "raspi-firmware" for p in manifest["packages"]),
        "Pi firmware pin",
    )
    print("OS1 image policy: 0 problems")


if __name__ == "__main__":
    check(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent)
