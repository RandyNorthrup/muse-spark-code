#!/usr/bin/env python3
"""Fail closed when image policy or slot geometry drifts (H01/H11/H15/H17)."""

import configparser
import json
from pathlib import Path
import re
import sys


def config(file):
    # systemd lists allow repeated settings, e.g. ConditionPathExists.
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.read(file)
    return parser


def require(value, reason):
    if not value:
        raise ValueError("OS1 policy: " + reason)


def lookup(parser, section, key):
    """Missing sections/keys fail closed with the policy reason, not KeyError."""
    try:
        return parser[section][key]
    except KeyError:
        return None


def hex_lower(value, length):
    return (
        isinstance(value, str)
        and len(value) == length
        and all(c in "0123456789abcdef" for c in value)
    )


# D227: Meta's CLI ships only through the setup step, never in an image.
# The basenames are the installer's verified layout (launch.ts): the posix
# launcher, the Windows command and versioned binaries, the version file
# and the PowerShell launcher. The Windows install folder itself is a
# directory wearing one, so directories count too.
CLI_BASENAMES = frozenset({"muse", "muse.cmd", ".muse-version", ".muse-launcher.ps1"})
CLI_BASENAME_PREFIX = "muse-bin-"
CLI_PACKAGES = frozenset({"muse", "muse-code", "muse-code-cli"})


def pi_manifest(manifest, require_https=True):
    """Fail closed unless the manifest pins a verifiable signed Packages index.

    The URL scheme is policy (https) under check(); the composer relaxes it so
    fixture indexes can travel over file:// while their digest still binds.
    """
    fingerprint = manifest.get("archiveSigningFingerprint", "")
    require(
        isinstance(fingerprint, str)
        and len(fingerprint) == 40
        and all(c in "0123456789abcdefABCDEF" for c in fingerprint),
        "Pi archive fingerprint",
    )
    # packagesIndexSha256 pins the Packages index file (e.g.
    # main/binary-arm64/Packages.gz), never the signed InRelease itself:
    # the InRelease is the trust root and is bound by its signature.
    require(hex_lower(manifest.get("packagesIndexSha256", ""), 64), "Pi index digest")
    index_path = manifest.get("packagesIndex", "")
    require(
        isinstance(index_path, str)
        and index_path
        and "\\" not in index_path
        and not index_path.startswith("/")
        and all(part not in ("", ".", "..") for part in index_path.split("/")),
        "Pi index path",
    )
    index_url = manifest.get("packagesIndexUrl", "")
    require(
        isinstance(index_url, str)
        and index_url
        and (index_url.startswith("https://") or not require_https),
        "Pi index location",
    )
    packages = manifest.get("packages", [])
    require(isinstance(packages, list) and packages, "Pi package pins")
    for package in packages:
        require(hex_lower(package.get("sha256", ""), 64), "Pi package digest")
        url = package.get("url", "")
        require(
            isinstance(url, str)
            and url
            and (url.startswith("https://") or not require_https),
            "Pi package location",
        )
    return (
        fingerprint,
        manifest["packagesIndexSha256"],
        index_url,
        index_path,
    )


def parse_release_hashes(payload):
    """Parse the SHA256 section of a verified Release/InRelease payload.

    A real Release lists index files (main/binary-arm64/Packages.gz and
    siblings), never .debs. Returns {index path: (digest, size)}.
    """
    entries = {}
    section = None
    for line in payload.splitlines():
        if not line or line[0] not in (" ", "\t"):
            section = line[:-1] if line.endswith(":") else None
            continue
        if section != "SHA256":
            continue
        fields = line.split()
        if len(fields) != 3:
            raise ValueError("OS1 policy: Pi index entry")
        entry_digest, size_text, entry_path = fields
        require(hex_lower(entry_digest, 64), "Pi index digest")
        try:
            size = int(size_text)
        except ValueError:
            raise ValueError("OS1 policy: Pi index entry")
        require(size >= 0, "Pi index entry")
        entries[entry_path.replace("\\", "/")] = (entry_digest, size)
    require(entries, "Pi index hashes")
    return entries


def parse_packages(data):
    """Parse a Packages index into a list of stanza dicts.

    Stanzas carry Package, Version, Architecture, Filename
    (pool/.../*.deb), Size and SHA256; continuation lines (Description
    bodies) are skipped. Refuses an empty index.
    """
    stanzas = []
    for chunk in data.split("\n\n"):
        stanza = {}
        for line in chunk.splitlines():
            if not line or line[0] in (" ", "\t") or ":" not in line:
                continue
            key, value = line.split(":", 1)
            stanza[key.strip()] = value.strip()
        if stanza:
            stanzas.append(stanza)
    require(stanzas, "Pi packages index")
    return stanzas


def verify_pi_packages(manifest, release_entries, packages_text):
    """Refuse package pins that disagree with the verified Packages index.

    release_entries is parse_release_hashes() over the clearsigned
    InRelease after its signature was verified. The manifest-pinned
    Packages index path must be listed there with the manifest-pinned
    digest; every manifest .deb must then match exactly one stanza on
    Package name and Version, an arm64/all architecture, the stanza
    Filename and the stanza SHA256. Returns
    {package name: {"sha256", "size", "filename"}} for the download.
    """
    index_path = manifest["packagesIndex"].replace("\\", "/")
    require(index_path in release_entries, "Pi index package entry")
    require(
        release_entries[index_path][0].lower()
        == manifest["packagesIndexSha256"].lower(),
        "Pi index digest",
    )
    wanted = {}
    stanzas = parse_packages(packages_text)
    for package in manifest["packages"]:
        matches = [
            stanza
            for stanza in stanzas
            if stanza.get("Package") == package["package"]
            and stanza.get("Version") == package.get("version")
        ]
        require(len(matches) == 1, "Pi index package entry")
        stanza = matches[0]
        require(stanza.get("Architecture") in ("arm64", "all"), "Pi index package entry")
        stanza_file = stanza.get("Filename", "").replace("\\", "/")
        manifest_file = package["url"].replace("\\", "/").rsplit("/", 1)[-1]
        require(
            stanza_file
            and stanza_file.rsplit("/", 1)[-1] == manifest_file
            and stanza_file.endswith(".deb"),
            "Pi package file",
        )
        require(
            stanza.get("SHA256", "").lower() == package["sha256"].lower(),
            "Pi package digest",
        )
        try:
            size = int(stanza.get("Size", ""))
        except ValueError:
            raise ValueError("OS1 policy: Pi index package entry")
        require(size >= 0, "Pi index package entry")
        wanted[package["package"]] = {
            "sha256": stanza["SHA256"].lower(),
            "size": size,
            "filename": stanza_file,
        }
    return wanted


def check(root):
    base = config(root / "mkosi.conf")
    require(base["Distribution"]["Distribution"] == "debian", "Debian base")
    require(base["Distribution"]["Release"] == "trixie", "Debian 13")
    require(base["Distribution"]["Snapshot"] == "20261005T000000Z", "snapshot pin")
    require(
        base["Distribution"]["Repositories"] == "main non-free-firmware",
        "Debian repositories",
    )
    require(base["Content"]["SourceDateEpoch"] == "1791158400", "source epoch pin")
    require(
        base["Output"]["Seed"] == "8821992e-4707-4882-96ce-a8b16b671a09",
        "partition seed",
    )
    require(base["Validation"]["Checksum"] == "yes", "artifact digests")
    # Reproducible filesystems: repart's mkfs.ext4 otherwise draws a random
    # directory hash seed, the one byte that made two builds differ.
    build_environment = lookup(base, "Build", "Environment") or ""
    require(
        "SYSTEMD_REPART_MKFS_OPTIONS_EXT4=" in build_environment
        and "hash_seed=" + base["Output"]["Seed"] in build_environment,
        "ext4 hash seed pin",
    )
    require(
        "/var/cache/ldconfig/aux-cache" in base["Content"]["RemoveFiles"].split(),
        "ldconfig cache removal",
    )
    # OS4 and OS5 ride the recipe: the firewall, and the firmware set that
    # firmware.json names.
    packages = set(base["Content"]["Packages"].split())
    firmware = json.loads((root / "firmware/firmware.json").read_text())["packages"]
    require(
        {name for group in firmware.values() for name in group} <= packages,
        "base firmware packages",
    )
    require("nftables" in packages, "firewall package")
    # Firmware belongs to /usr, not the UKI: without the exclusions mkosi puts
    # the graphics and wireless firmware into the initrd (+70 MB of a 260 MB ESP).
    initrd_modules = lookup(base, "Content", "KernelInitrdModules") or ""
    require(
        "-/drivers/gpu/" in initrd_modules.split()
        and "-/drivers/net/wireless/" in initrd_modules.split(),
        "initrd firmware exclusions",
    )
    firewall = (root / "hardening/nftables.conf").read_text()
    require(
        re.search(r"chain input \{[^}]*policy drop", firewall, re.S) is not None
        and re.search(r"chain forward \{[^}]*policy drop", firewall, re.S) is not None,
        "default-drop firewall",
    )
    require(
        (root / "hardening/sysctl.d/99-muse-node.conf").is_file(), "kernel hardening knobs"
    )
    require(
        "nftables.service" in (root / "mkosi.postinst").read_text(),
        "firewall enablement",
    )
    # D227: no staged file or directory may wear the CLI's names, and no
    # Debian package from that set may be listed.
    staged = sorted(
        str(entry.relative_to(root))
        for entry in root.rglob("*")
        if entry.name in CLI_BASENAMES or entry.name.startswith(CLI_BASENAME_PREFIX)
    )
    require(not staged, "no staged Muse Code CLI")
    require(not (CLI_PACKAGES & packages), "no Muse Code package")
    # Meta's installer requires curl (read 2026-10-30); the setup step
    # cannot download without it.
    require("curl" in packages, "setup download tool")
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
    installer = config(root / "mkosi.profiles/installer.conf")
    require(
        lookup(installer, "Content", "KernelCommandLine") == "systemd.volatile=overlay",
        "installer volatile overlay",
    )
    hook = (root / "mkosi.initrd.postinst").read_text()
    require(
        "/usr/lib/systemd/system/initrd-root-fs.target.wants" in hook,
        "initrd vendor dependency",
    )
    # The enablement is the exact ln command, not a substring: without it
    # the bind-ro unit is never installed and the installer overlay ships
    # without the protective bind.
    require(
        'ln -s ../muse-overlay-usr.service "$wants/muse-overlay-usr.service"' in hook,
        "initrd bind-ro enablement",
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
    require(
        parts["00-esp"]["SizeMinBytes"] == "260M"
        and parts["00-esp"]["SizeMaxBytes"] == "260M",
        "ESP size",
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
    pi_manifest(manifest)
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
