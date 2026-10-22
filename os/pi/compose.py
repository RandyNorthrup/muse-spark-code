"""Pi firmware/kernel staging and native FAT boot-file assembly."""

import json
from pathlib import Path
import shutil
import subprocess


def prepare(target, workspace, assets, download):
    manifest = json.loads((workspace / "pi/manifest.json").read_text())
    board = manifest["targets"][target]
    overlay = workspace / "overlay"
    for package in manifest["packages"]:
        if package["package"] not in (
            "raspi-firmware",
            "linux-image-" + board["kernel"],
        ):
            continue
        archive = assets / (package["package"] + ".deb")
        download(package["url"], package["sha256"], archive)
        subprocess.run(
            ["dpkg-deb", "--extract", str(archive), str(overlay)], check=True
        )
    modules = overlay / "usr/lib/modules" / board["kernel"]
    shutil.copyfile(
        overlay / "boot" / ("vmlinuz-" + board["kernel"]), modules / "vmlinuz"
    )
    subprocess.run(
        [
            "depmod",
            "--basedir",
            str(overlay),
            "--moduledir=/usr/lib/modules",
            board["kernel"],
        ],
        check=True,
    )
    boot = overlay / "boot/firmware"
    shutil.copytree(overlay / "usr/lib/raspi-firmware", boot)
    shutil.copytree(modules / "dtb/broadcom", boot, dirs_exist_ok=True)
    shutil.copytree(modules / "dtb/overlays", boot / "overlays", dirs_exist_ok=True)
    (boot / "config.txt").write_text(
        "[all]\narm_64bit=1\nenable_uart=1\n"
        "kernel=" + board["kernelFile"] + "\n"
        "device_tree=" + board["deviceTree"] + "\n"
        "initramfs initrd.img followkernel\n"
    )
    # Initial image selects slot A. OS2 alone owns trial boot and EEPROM changes.
    (boot / "autoboot.txt").write_text(
        "[all]\ntryboot_a_b=1\nboot_partition=1\n[tryboot]\nboot_partition=2\n"
    )
    return manifest


def finish(target, output, manifest):
    prefix = output / ("muse-node-" + target)
    raw = prefix.with_suffix(".raw")
    partitions = json.loads(subprocess.check_output(["sfdisk", "--json", str(raw)]))
    boot = next(
        p
        for p in partitions["partitiontable"]["partitions"]
        if p["name"] == "muse-pi-boot-a"
    )
    device = str(raw) + "@@" + str(boot["start"] * 512)
    board = manifest["targets"][target]
    subprocess.run(
        [
            "mcopy",
            "-o",
            "-i",
            device,
            str(prefix.with_suffix(".vmlinuz")),
            "::/" + board["kernelFile"],
        ],
        check=True,
    )
    subprocess.run(
        [
            "mcopy",
            "-o",
            "-i",
            device,
            str(prefix.with_suffix(".initrd")),
            "::/initrd.img",
        ],
        check=True,
    )
    cmdline = output / "cmdline.txt"
    cmdline.write_text(
        "console=serial0,115200 console=tty1 ro root=PARTLABEL=muse-root usrhash="
        + prefix.with_suffix(".roothash").read_text().strip()
        + "\n"
    )
    subprocess.run(
        ["mcopy", "-o", "-i", device, str(cmdline), "::/cmdline.txt"], check=True
    )
    # Publish the exact populated FAT partition too, for OS2's RAUC boot slot.
    with raw.open("rb") as source, prefix.with_suffix(".boot-a.raw").open("wb") as dest:
        source.seek(boot["start"] * 512)
        remaining = boot["size"] * 512
        while remaining:
            chunk = source.read(min(remaining, 1024 * 1024))
            if not chunk:
                raise ValueError("OS1 truncated Pi boot partition")
            dest.write(chunk)
            remaining -= len(chunk)
