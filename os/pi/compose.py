"""Pi firmware/kernel staging and native FAT boot-file assembly."""

import gzip
import io
import json
import lzma
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile

from check import pi_manifest, verify_pi_index

# Bounds mirror build.py: a hostile .deb gets the same budget as any archive.
DEB_MEMBER_LIMIT = 65536
DEB_EXPANSION_LIMIT = 256 * 1024 * 1024
GPGV = "gpgv"
DPKG_DEB = "dpkg-deb"


def check_gpgv_status(returncode, output, fingerprint):
    """Refuse unless gpgv reports a valid signature from the pinned key.

    output is gpgv's --status-fd text. Pure so the policy is unit-testable;
    the live capture behind the format is recorded in the OS1 certificate.
    """
    valid = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 3 and fields[0] == "[GNUPG:]" and fields[1] == "VALIDSIG":
            valid.append(fields[2])
    if returncode != 0 or not any(
        signer.upper() == fingerprint.upper() for signer in valid
    ):
        raise ValueError("OS1 Pi index signature mismatch")


def verify_signature(index_file, fingerprint, keyring, runner=None):
    """Verify the clearsigned index with gpgv against the pinned fingerprint.

    The keyring is build-time transport: any keyring is accepted, but only a
    signature from the manifest-pinned fingerprint passes. The runner is
    injectable so tests can replay captured gpgv output without host tools.
    """
    run = runner or subprocess.run
    try:
        probe = run(
            [GPGV, "--status-fd", "1", "--keyring", str(keyring), str(index_file)],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
    except OSError:
        raise ValueError("OS1 Pi index signature backend")
    check_gpgv_status(probe.returncode, probe.stdout or "", fingerprint)


def clearsign_payload(index_file):
    """Return the signed text of a clearsigned file; refuse malformed armor."""
    try:
        text = Path(index_file).read_text(encoding="ascii")
    except (OSError, UnicodeDecodeError, ValueError):
        raise ValueError("OS1 Pi index encoding")
    lines = text.splitlines()
    if not lines or lines[0] != "-----BEGIN PGP SIGNED MESSAGE-----":
        raise ValueError("OS1 Pi index armor")
    try:
        blank = lines.index("", 1)
        signed_at = lines.index("-----BEGIN PGP SIGNATURE-----", blank + 1)
    except ValueError:
        raise ValueError("OS1 Pi index armor")
    payload = []
    for line in lines[blank + 1 : signed_at]:
        payload.append(line[2:] if line.startswith("- ") else line)
    return "\n".join(payload) + "\n"


def check_member_path(name):
    """The ACP tar admission for one member path; returns the relative path.

    No `..`, no absolute paths, no backslashes, no hostile components.
    """
    if "\\" in name:
        raise ValueError("OS1 unsafe archive member")
    path = name
    while path.startswith("./"):
        path = path[2:]
    if path in ("", ".", "/"):
        return ""
    parts = path.rstrip("/").split("/")
    if (
        not parts
        or path.startswith("/")
        or any(
            not p
            or ":" in p
            or p != p.rstrip(" .")
            or any(ord(c) < 32 or ord(c) == 127 for c in p)
            for p in parts
        )
    ):
        raise ValueError("OS1 unsafe archive member")
    return "/".join(parts).rstrip("/")


def contained(target, directory):
    """Lexically confine a symlink target to the staging root (H10/H11).

    Relative targets resolve against directory, absolute ones against the
    root itself, as they will once the staging tree becomes the image; both
    are admitted only while they stay inside that root. A `..` that pops
    above the root is an escape even though normpath would silently absorb
    it, so the components are resolved with an explicit stack instead.
    Nothing here follows a link: the copy uses lstat/readlink/O_NOFOLLOW,
    so an admitted link can never pull host bytes into the image.
    """
    target = target.replace("\\", "/")
    if target.startswith("/"):
        stack = []
        parts = target.split("/")
    else:
        stack = [part for part in directory.split("/") if part]
        parts = target.split("/")
    for part in parts:
        if part in ("", "."):
            continue
        if part == "..":
            if not stack:
                return False
            stack.pop()
        else:
            stack.append(part)
    return True


def ar_members(raw):
    """Split an ar archive; refuse exotic entries.

    Returns (data_name, data_bytes). The control member is never extracted,
    so maintainer scripts cannot run at staging time.
    """
    if not raw.startswith(b"!<arch>\n"):
        raise ValueError("OS1 Pi .deb archive header")
    offset = 8
    long_names = None
    binary = None
    data = None
    while offset < len(raw):
        if offset + 60 > len(raw):
            raise ValueError("OS1 Pi .deb member header")
        header = raw[offset : offset + 60]
        if header[58:60] != b"\x60\x0a":
            raise ValueError("OS1 Pi .deb member magic")
        try:
            name = header[0:16].decode("ascii").rstrip()
            size = int(header[48:58].decode("ascii").strip() or "0")
        except (UnicodeDecodeError, ValueError):
            raise ValueError("OS1 Pi .deb member header")
        start = offset + 60
        if size < 0 or start + size > len(raw):
            raise ValueError("OS1 Pi .deb member bounds")
        content = raw[start : start + size]
        offset = start + size + (size % 2)
        if name == "//":
            long_names = content
            continue
        if name.startswith("/"):
            if long_names is None or not name[1:].isdigit():
                raise ValueError("OS1 Pi .deb member name")
            end = long_names.find(b"/\n", int(name[1:]))
            if end < 0:
                raise ValueError("OS1 Pi .deb member name")
            try:
                name = long_names[int(name[1:]) : end].decode("ascii")
            except UnicodeDecodeError:
                raise ValueError("OS1 Pi .deb member name")
        name = name[:-1] if name.endswith("/") else name
        if name == "debian-binary":
            binary = content
        elif name.startswith("data.tar"):
            if data is not None:
                raise ValueError("OS1 Pi .deb data member")
            data = (name, content)
    if binary != b"2.0\n":
        raise ValueError("OS1 Pi .deb version")
    if data is None:
        raise ValueError("OS1 Pi .deb data member")
    return data


def decode_data(data_name, data):
    """Open a data.tar member the stdlib can read; refuse the rest here."""
    if data_name.endswith(".gz"):
        return gzip.open(io.BytesIO(data), "rb")
    if data_name.endswith(".xz"):
        return lzma.open(io.BytesIO(data), "rb")
    if data_name.endswith(".bz2"):
        import bz2

        return bz2.open(io.BytesIO(data), "rb")
    if data_name == "data.tar":
        return io.BytesIO(data)
    raise ValueError("OS1 Pi .deb compression")


def admit_data(data_name, data):
    """Admit every data.tar member lexically before anything is written.

    Returns {relative path: TarInfo} for regular files and directories.
    Symlinks are admitted only when contained; hardlinks, devices and other
    special files are refused like the ACP admission. Nothing is written.
    """
    admitted = {}
    links = {}
    with decode_data(data_name, data) as decoded, tarfile.open(
        fileobj=decoded, mode="r:"
    ) as source:
        members = list(source)
        if len(members) > DEB_MEMBER_LIMIT:
            raise ValueError("OS1 Pi .deb member limit")
        for member in members:
            relative = check_member_path(member.name)
            if not relative:
                continue
            if relative in admitted or relative in links:
                raise ValueError("OS1 Pi .deb duplicate member")
            if member.isdir():
                admitted[relative] = member
            elif member.isreg():
                admitted[relative] = member
            elif member.issym() or member.islnk():
                links[relative] = member
            else:
                raise ValueError("OS1 unsafe archive member")
        for relative, member in links.items():
            if member.islnk() or not contained(
                member.linkname, "/" + os.path.dirname(relative).replace("\\", "/")
            ):
                raise ValueError("OS1 unsafe archive member")
    admitted.update(links)
    return admitted


def admit_tree(root):
    """Admit an extracted tree without following any symlink.

    Refuses escaping symlinks, hardlinks and special files. setuid/setgid
    bits are left for the copy to strip.
    """
    top = os.path.normpath(str(root))
    count = 0
    total = 0
    for current, dirnames, filenames in os.walk(top, followlinks=False):
        for name in dirnames + filenames:
            if (
                not name
                or name in (".", "..")
                or "\\" in name
                or name != name.rstrip(" .")
            ):
                raise ValueError("OS1 unsafe archive member")
            full = os.path.join(current, name)
            try:
                status = os.lstat(full)
            except OSError:
                raise ValueError("OS1 unsafe archive member")
            mode = status.st_mode
            if stat.S_ISLNK(mode):
                try:
                    target = os.readlink(full)
                except OSError:
                    raise ValueError("OS1 unsafe archive member")
                relative = os.path.relpath(current, top).replace("\\", "/")
                directory = "/" if relative == "." else "/" + relative
                if not contained(target, directory):
                    raise ValueError("OS1 unsafe archive member")
            elif stat.S_ISREG(mode):
                if status.st_nlink > 1:
                    raise ValueError("OS1 unsafe archive member")
                count += 1
                total += status.st_size
                if count > DEB_MEMBER_LIMIT or total > DEB_EXPANSION_LIMIT:
                    raise ValueError("OS1 Pi .deb expansion limit")
            elif not stat.S_ISDIR(mode):
                raise ValueError("OS1 unsafe archive member")


def copy_admitted(source, destination):
    """Copy an admitted tree; symlinks are never followed, setuid is stripped."""
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    for current, dirnames, filenames in os.walk(source, followlinks=False):
        relative = os.path.relpath(current, source)
        target_dir = destination if relative == "." else destination / relative
        target_dir.mkdir(parents=True, exist_ok=True)
        for name in dirnames + filenames:
            origin = Path(current) / name
            target = target_dir / name
            try:
                status = os.lstat(origin)
            except OSError:
                raise ValueError("OS1 Pi staging read")
            mode = status.st_mode
            try:
                if stat.S_ISLNK(mode):
                    target.symlink_to(os.readlink(origin))
                elif stat.S_ISREG(mode):
                    reader = os.open(origin, os.O_RDONLY | nofollow)
                    try:
                        with os.fdopen(reader, "rb") as data, target.open(
                            "wb"
                        ) as output:
                            shutil.copyfileobj(data, output)
                    except OSError:
                        raise ValueError("OS1 Pi staging write")
                    target.chmod(0o755 if mode & 0o111 else 0o644)
                elif stat.S_ISDIR(mode):
                    target.mkdir(parents=True, exist_ok=True)
                    target.chmod(0o755)
                else:
                    raise ValueError("OS1 unsafe archive member")
            except OSError:
                raise ValueError("OS1 Pi staging write")


def copy_tree(source, destination, exists_ok=False):
    """Copy a tree without ever following symlinks (H10/H11)."""
    admit_tree(Path(source))
    if exists_ok:
        Path(destination).mkdir(parents=True, exist_ok=True)
    copy_admitted(str(source), Path(destination))


def copy_regular(source, destination):
    """Copy one regular file; refuses symlinks instead of following them."""
    try:
        if not stat.S_ISREG(os.lstat(source).st_mode):
            raise ValueError("OS1 unsafe archive member")
    except OSError:
        raise ValueError("OS1 Pi staging read")
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    try:
        reader = os.open(source, os.O_RDONLY | nofollow)
    except OSError:
        raise ValueError("OS1 unsafe archive member")
    try:
        with os.fdopen(reader, "rb") as data, Path(destination).open("wb") as output:
            shutil.copyfileobj(data, output)
    except OSError:
        raise ValueError("OS1 Pi staging write")


def extract_deb(archive, destination, runner=None):
    """Stage one .deb into the overlay through member admission (H10/H11/H17).

    The ar container is parsed here; data members the stdlib cannot decode
    (zstd) go through the host dpkg-deb into a disposable quarantine, the
    rest through the same lexical admission. Either way the quarantine tree
    is admitted without following symlinks before anything reaches the
    destination, and the control member is never extracted.
    """
    raw = Path(archive).read_bytes()
    if len(raw) > DEB_EXPANSION_LIMIT:
        raise ValueError("OS1 Pi .deb expansion limit")
    data_name, data = ar_members(raw)
    run = runner or subprocess.run
    quarantine = Path(
        tempfile.mkdtemp(prefix="pi-deb-", dir=str(Path(destination).parent))
    )
    try:
        try:
            admitted = admit_data(data_name, data)
            total = 0
            with decode_data(data_name, data) as decoded, tarfile.open(
                fileobj=decoded, mode="r:"
            ) as source:
                for relative, member in admitted.items():
                    if not member.isreg():
                        continue
                    total += member.size
                    if total > DEB_EXPANSION_LIMIT:
                        raise ValueError("OS1 Pi .deb expansion limit")
                    target = quarantine / Path(*relative.split("/"))
                    target.parent.mkdir(parents=True, exist_ok=True)
                    extracted = source.extractfile(member)
                    if extracted is None:
                        raise ValueError("OS1 Pi .deb data member")
                    with extracted, target.open("wb") as output:
                        shutil.copyfileobj(extracted, output)
                    # Quarantine keeps the member's permission bits (setuid
                    # stripped now); the copy still normalizes to 0644/0755.
                    target.chmod(member.mode & 0o0777)
                for relative, member in admitted.items():
                    if member.isdir():
                        (quarantine / Path(*relative.split("/"))).mkdir(
                            parents=True, exist_ok=True
                        )
                    elif member.issym():
                        target = quarantine / Path(*relative.split("/"))
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.symlink_to(member.linkname)
        except ValueError as error:
            if str(error) != "OS1 Pi .deb compression":
                raise
            try:
                run(
                    [DPKG_DEB, "--extract", str(archive), str(quarantine)],
                    check=True,
                )
            except OSError:
                raise ValueError("OS1 Pi .deb backend")
            except subprocess.CalledProcessError:
                raise ValueError("OS1 Pi .deb extraction")
        admit_tree(quarantine)
        copy_admitted(str(quarantine), Path(destination))
    finally:
        shutil.rmtree(quarantine, ignore_errors=True)


def prepare(target, workspace, assets, download, keyring, runner=None):
    manifest = json.loads((workspace / "pi/manifest.json").read_text())
    fingerprint, index_sha, index_url = pi_manifest(manifest, require_https=False)
    board = manifest["targets"][target]
    run = runner or subprocess.run
    index_file = assets / "InRelease"
    download(index_url, index_sha, index_file)
    verify_signature(index_file, fingerprint, keyring, runner=run)
    wanted = verify_pi_index(manifest, clearsign_payload(index_file))
    overlay = workspace / "overlay"
    for package in manifest["packages"]:
        if package["package"] not in (
            "raspi-firmware",
            "linux-image-" + board["kernel"],
        ):
            continue
        archive = assets / (package["package"] + ".deb")
        download(package["url"], wanted[package["package"]], archive)
        extract_deb(archive, overlay, runner=run)
    modules = overlay / "usr/lib/modules" / board["kernel"]
    copy_regular(overlay / "boot" / ("vmlinuz-" + board["kernel"]), modules / "vmlinuz")
    try:
        run(
            [
                "depmod",
                "--basedir",
                str(overlay),
                "--moduledir=/usr/lib/modules",
                board["kernel"],
            ],
            check=True,
        )
    except OSError:
        raise ValueError("OS1 Pi depmod backend")
    except subprocess.CalledProcessError:
        raise ValueError("OS1 Pi depmod refused")
    boot = overlay / "boot/firmware"
    copy_tree(overlay / "usr/lib/raspi-firmware", boot)
    copy_tree(modules / "dtb/broadcom", boot, exists_ok=True)
    copy_tree(modules / "dtb/overlays", boot / "overlays", exists_ok=True)
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
