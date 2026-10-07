#!/usr/bin/env python3
"""Offline OS1 qualification; only a disposable image copy receives fixtures."""

import argparse
import hashlib
from pathlib import Path
import subprocess, json, shutil

base = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("image", type=Path)
parser.add_argument("architecture", choices=("x86-64", "arm64"))
parser.add_argument("--optical", action="store_true")
parser.add_argument("--corrupt-usr", action="store_true")
args = parser.parse_args()
image = args.image.resolve(strict=True)
with image.open("rb") as source:
    image_digest = hashlib.file_digest(source, "sha256").hexdigest()
arch = args.architecture
name = (
    arch
    + ("-optical" if args.optical else "-raw")
    + ("-corrupt" if args.corrupt_usr else "")
)
qual = base / "out/qualification" / name
qual.mkdir(parents=True, exist_ok=True)
probe = qual / "probe.mjs"
entry = (
    "import { runOsBootProbe } from "
    + json.dumps(str(base / "test/unit/helpers/osBootProbe.mjs"))
    + "; import { NodeService, nodeHealth } from '/usr/lib/muse-spark-code/dist/node.js'; "
    + "await runOsBootProbe({NodeService,nodeHealth});"
)
subprocess.run(
    [
        "node",
        "-e",
        "require('esbuild').buildSync("
        + json.dumps(
            {
                "stdin": {
                    "contents": entry,
                    "resolveDir": str(base),
                    "sourcefile": "os1-probe-entry.mjs",
                },
                "outfile": str(probe),
                "bundle": True,
                "platform": "node",
                "format": "esm",
                "target": "node24",
                "external": ["/usr/lib/muse-spark-code/dist/node.js"],
            }
        )
        + ")",
    ],
    cwd=base,
    check=True,
)
copy = qual / ("fixture-" + image.name)
subprocess.run(["cp", "--sparse=always", str(image), str(copy)], check=True)
parts = json.loads(subprocess.check_output(["sfdisk", "--json", str(copy)]))[
    "partitiontable"
]["partitions"]
root = next(p for p in parts if p["name"] == "muse-root")
part = qual / "root.raw"
with copy.open("rb") as source, part.open("wb") as target:
    source.seek(root["start"] * 512)
    target.write(source.read(root["size"] * 512))
unit = qual / "os1-probe.service"
unit.write_text("""[Unit]
Description=OS1 test-only readiness probe
After=var.mount
Requires=var.mount
[Service]
Type=oneshot
User=muse-node
Group=muse-node
ExecStart=/usr/lib/nodejs/bin/node /opt/os1-probe.mjs
StandardOutput=journal+console
StandardError=journal+console
[Install]
WantedBy=multi-user.target
""")
finish = qual / "os1-finish.service"
finish.write_text("""[Unit]
Description=OS1 test-only finish
After=os1-probe.service
Requires=os1-probe.service
[Service]
Type=oneshot
ExecStartPre=/usr/bin/journalctl -b -u systemd-resolved.service --no-pager -n 15
ExecStart=/usr/bin/bash -c 'if /usr/bin/setpriv --reuid=61101 --regid=61101 --clear-groups /usr/bin/cat /var/lib/muse-spark-code-node/os1-private-canary; then exit 1; fi; echo OS1_TOOLS_DENIED_OK; /usr/bin/systemctl poweroff'
StandardOutput=journal+console
StandardError=journal+console
[Install]
WantedBy=multi-user.target
""")
commands = qual / "debugfs.txt"
commands.write_text(f"""mkdir /opt
rm /opt/os1-probe.mjs
write {probe} /opt/os1-probe.mjs
rm /etc/systemd/system/os1-probe.service
write {unit} /etc/systemd/system/os1-probe.service
rm /etc/systemd/system/os1-finish.service
write {finish} /etc/systemd/system/os1-finish.service
symlink /etc/systemd/system/multi-user.target.wants/os1-probe.service /etc/systemd/system/os1-probe.service
symlink /etc/systemd/system/multi-user.target.wants/os1-finish.service /etc/systemd/system/os1-finish.service
""")
subprocess.run(
    ["debugfs", "-w", "-f", str(commands), str(part)],
    check=True,
    stdout=subprocess.DEVNULL,
)
with copy.open("r+b") as target, part.open("rb") as source:
    target.seek(root["start"] * 512)
    shutil.copyfileobj(source, target)
if args.corrupt_usr:
    with copy.open("rb") as source:
        before_corruption = hashlib.file_digest(source, "sha256").hexdigest()
    usr = next(p for p in parts if p["name"] == "muse-usr-a")
    with copy.open("r+b") as target:
        target.seek(usr["start"] * 512 + 1024)
        original = target.read(1)
        target.seek(-1, 1)
        target.write(bytes([original[0] ^ 1]))
if arch == "x86-64":
    code = Path("/usr/share/OVMF/OVMF_CODE_4M.fd")
    vars = Path("/usr/share/OVMF/OVMF_VARS_4M.fd")
    command = ["qemu-system-x86_64", "-machine", "q35", "-accel", "tcg", "-cpu", "max"]
else:
    code = Path("/usr/share/AAVMF/AAVMF_CODE.fd")
    vars = Path("/usr/share/AAVMF/AAVMF_VARS.fd")
    command = [
        "qemu-system-aarch64",
        "-machine",
        "virt",
        "-accel",
        "tcg",
        "-cpu",
        "cortex-a72",
    ]
shutil.copyfile(vars, qual / "vars.fd")
command += [
    "-m",
    "2048",
    "-smp",
    "1" if arch == "x86-64" else "2",
    "-display",
    "none",
    "-serial",
    "stdio",
    "-monitor",
    "none",
    "-no-reboot",
    "-net",
    "none",
    "-drive",
    f"if=pflash,format=raw,readonly=on,file={code}",
    "-drive",
    f'if=pflash,format=raw,file={qual/"vars.fd"}',
    "-drive",
    (
        "if=none,id=optical,media=cdrom,readonly=on,format=raw,file="
        if args.optical
        else (
            "if=virtio,readonly=on,format=raw,file="
            if args.corrupt_usr
            else "if=virtio,format=raw,file="
        )
    )
    + str(copy),
]
if args.optical:
    command += ["-device", "virtio-scsi-pci", "-device", "scsi-cd,drive=optical"]
timed_out = False
# ARM UEFI runs entirely under TCG; D90.24 permits its longer bounded boot.
timeout = 600 if arch == "arm64" else 300
with (qual / "console.log").open("w") as output:
    try:
        result = subprocess.run(
            command, stdout=output, stderr=subprocess.STDOUT, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        timed_out = True
        result = None
text = (qual / "console.log").read_text()
restoration = None
if args.corrupt_usr:
    with copy.open("r+b") as target:
        target.seek(usr["start"] * 512 + 1024)
        target.write(original)
    with copy.open("rb") as source:
        restored = hashlib.file_digest(source, "sha256").hexdigest()
    restoration = {"beforeSha256": before_corruption, "restoredSha256": restored}
    if restored != before_corruption:
        raise ValueError("OS1 corruption drill did not restore exact bytes")
markers = {
    marker: marker in text
    for marker in ["OS1_READY_OK", "OS1_TOOLS_DENIED_OK", "data block 0 is corrupted"]
}
passed = (
    not markers["OS1_READY_OK"] and markers["data block 0 is corrupted"]
    if args.corrupt_usr
    else not timed_out and markers["OS1_READY_OK"] and markers["OS1_TOOLS_DENIED_OK"]
)
receipt = {
    "image": str(image.relative_to(base)),
    "imageSha256": image_digest,
    "testOnly": True,
    "acceleration": "TCG",
    "architecture": arch,
    "cpu": "cortex-a72" if arch == "arm64" else "max",
    "vcpus": 1 if arch == "x86-64" else 2,
    "optical": args.optical,
    "corruptUsr": args.corrupt_usr,
    "timeoutSeconds": timeout,
    "timedOut": timed_out,
    "exit": result.returncode if result else None,
    "markers": markers,
    "passed": passed,
    "restoration": restoration,
}
(qual / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
raise SystemExit(0 if passed else 1)
