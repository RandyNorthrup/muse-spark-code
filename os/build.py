#!/usr/bin/env python3
"""OS1 image composer; inputs are pinned, no owner data is accepted."""

import argparse
import contextlib
import gzip
import hashlib
import json
import lzma
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
from check import check
from pi.compose import prepare as prepare_pi, finish as finish_pi

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "out"
DOWNLOAD_LIMIT = 64 * 1024 * 1024
ARCHIVE_MEMBER_LIMIT = 1024
ARCHIVE_STREAM_LIMIT = DOWNLOAD_LIMIT * 4 + ARCHIVE_MEMBER_LIMIT * 1024
# Upstream Node 24.18.0 linux-x64 carries 5,774 members (4,703 regular,
# 1,068 directories, 3 symlinks; SHA-256 verified against pins.json before
# counting, 2026-10-08). Enumerate-but-skip members get their own ceiling
# at that count plus headroom for upstream growth; wanted members keep the
# strict limits above.
NODE_SKIP_LIMIT = 8192
TARGETS = {"x86-64", "arm64", "pi4", "pi5"}


class BoundedArchive:
    """Bound metadata reads and forward seeks before tarfile allocates/decodes."""

    def __init__(self, source):
        self.source = source

    def tell(self):
        return self.source.tell()

    def read(self, size):
        if size < 0 or self.tell() + size > ARCHIVE_STREAM_LIMIT:
            raise ValueError("OS1 decoded archive exceeds limit")
        return self.source.read(size)

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.tell() + offset
        if whence not in (0, 1) or position < 0 or position > ARCHIVE_STREAM_LIMIT:
            raise ValueError("OS1 archive seek exceeds limit")
        return self.source.seek(offset, whence)


def digest(file):
    with file.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def check_mkosi_version(probe, pinned):
    """Require a successful probe reporting exactly the pinned version.

    The full version token must equal the pin: a substring test would
    accept 27.10 or 127.1 for a 27.1 pin, and a failed probe must never
    satisfy the check. Pure so the policy is unit-testable.
    """
    if probe.returncode != 0:
        raise ValueError("OS1 mkosi version mismatch")
    tokens = (probe.stdout or "").split()
    if len(tokens) < 2 or tokens[0] != "mkosi" or tokens[1] != pinned:
        raise ValueError("OS1 mkosi version mismatch")


def download(url, expected, dest):
    # expected=None fetches without a digest pin (the Pi InRelease trust
    # root, bound by its signature instead); the size bound still applies.
    if dest.exists() and (expected is None or digest(dest) == expected):
        return
    partial = dest.with_suffix(".partial")
    try:
        with urllib.request.urlopen(url, timeout=60) as source, partial.open(
            "wb"
        ) as output:
            total = 0
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > DOWNLOAD_LIMIT:
                    raise ValueError("OS1 input exceeds download limit")
                output.write(chunk)
        if expected is not None and digest(partial) != expected:
            raise ValueError("OS1 input SHA-256 mismatch")
        partial.replace(dest)
    finally:
        partial.unlink(missing_ok=True)


def archive_kind(archive):
    with archive.open("rb") as header:
        magic = header.read(6)
    if magic[:2] == b"\x1f\x8b":
        return "gz"
    if magic == b"\xfd7zXZ\x00":
        return "xz"
    return None


@contextlib.contextmanager
def open_members(archive):
    # npm packages are gzip tarballs, upstream Node is xz; plain tar is
    # useful for isolated fixtures. Every stream passes BoundedArchive.
    kind = archive_kind(archive)
    if kind == "gz":
        raw = gzip.open(archive, "rb")
    elif kind == "xz":
        raw = lzma.open(archive, "rb")
    else:
        raw = archive.open("rb")
    with raw, tarfile.open(fileobj=BoundedArchive(raw), mode="r:") as source:
        yield source


def check_parts(parts, prefix):
    if parts[0] != prefix or any(
        not p
        or ":" in p
        or p != p.rstrip(" .")
        or any(ord(c) < 32 or ord(c) == 127 for c in p)
        for p in parts
    ):
        raise ValueError("OS1 unsafe archive member")
    return "/".join(parts[1:]).rstrip("/")


def extract(archive, destination, prefix, allowed):
    # Validate the whole archive BEFORE any write. Links, special files and
    # Windows-style paths are never build inputs (H10/H11/H17).
    with open_members(archive) as source:
        members = []
        total = 0
        for member in source:
            if len(members) >= ARCHIVE_MEMBER_LIMIT:
                raise ValueError("OS1 archive member limit")
            members.append(member)
            if "\\" in member.name:
                raise ValueError("OS1 unsafe archive member")
            parts = member.name.replace("\\", "/").rstrip("/").split("/")
            relative = check_parts(parts, prefix)
            if not (member.isfile() or member.isdir()):
                raise ValueError("OS1 unsafe archive member")
            total += member.size
            if total > DOWNLOAD_LIMIT * 4:
                raise ValueError("OS1 archive exceeds expansion limit")
            if member.isfile() and not allowed(relative):
                raise ValueError("OS1 unexpected archive member: " + relative)
        for member in members:
            parts = member.name.replace("\\", "/").rstrip("/").split("/")
            relative = check_parts(parts, prefix)
            if not relative:
                continue
            file = destination / relative
            if member.isdir():
                file.mkdir(parents=True, exist_ok=True)
            else:
                file.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as data, file.open("wb") as output:
                    shutil.copyfileobj(data, output)
                file.chmod(0o755 if member.mode & 0o111 else 0o644)


def extract_selected(archive, destination, prefix, names):
    """Admit only the named regular files from a gzip/xz/plain tar.

    Upstream archives carry files outside the wanted set, including symlinks
    npm needs; those members are never validated or written. Every wanted
    member faces the full ACP admission before any write, through the same
    bounded reader as extract().
    """
    wanted = set(names)
    if len(wanted) > ARCHIVE_MEMBER_LIMIT:
        raise ValueError("OS1 archive member limit")
    with open_members(archive) as source:
        members = []
        for member in source:
            members.append(member)
            if len(members) > NODE_SKIP_LIMIT:
                raise ValueError("OS1 archive member limit")
        seen = {}
        for member in members:
            candidate = member.name.replace("\\", "/")
            if candidate == prefix or candidate.startswith(prefix + "/"):
                relative = (
                    candidate[len(prefix) + 1 :].rstrip("/")
                    if (candidate != prefix)
                    else ""
                )
                if relative in wanted:
                    seen[relative] = member
        total = 0
        for relative in wanted:
            member = seen.get(relative)
            if member is None:
                raise ValueError("OS1 missing archive member: " + relative)
            if not member.isreg():
                raise ValueError(
                    "OS1 archive member is not a regular file: " + relative
                )
            if "\\" in member.name:
                raise ValueError("OS1 unsafe archive member")
            parts = member.name.replace("\\", "/").rstrip("/").split("/")
            check_parts(parts, prefix)
            total += member.size
            if total > DOWNLOAD_LIMIT * 4:
                raise ValueError("OS1 archive exceeds expansion limit")
        for relative in sorted(wanted):
            member = seen[relative]
            file = destination / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as data, file.open("wb") as output:
                if data is None:
                    raise ValueError(
                        "OS1 archive member is not a regular file: " + relative
                    )
                shutil.copyfileobj(data, output)
            file.chmod(0o755 if member.mode & 0o111 else 0o644)


def install_hardening(overlay):
    """Ship OS4's firewall and kernel knobs from their one source, hardening/.

    The ruleset is what nftables.service loads at boot; the sysctl file goes
    to the vendor directory inside the verity-protected /usr.
    """
    hardening = ROOT / "hardening"
    for source, destination in (
        (hardening / "nftables.conf", overlay / "etc/nftables.conf"),
        (
            hardening / "sysctl.d/99-muse-node.conf",
            overlay / "usr/lib/sysctl.d/99-muse-node.conf",
        ),
    ):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        destination.chmod(0o644)


def stage(args):
    check(ROOT)
    if args.target not in TARGETS:
        raise ValueError("OS1 unknown target")
    artifact = args.runtime.resolve(strict=True)
    if digest(artifact) != args.runtime_sha256:
        raise ValueError("OS1 runtime SHA-256 mismatch")
    pins = json.loads((ROOT / "pins.json").read_text())
    probe = subprocess.run(
        [str(args.mkosi.resolve()), "--version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    check_mkosi_version(probe, pins["mkosi"]["version"])
    if args.target in ("pi4", "pi5"):
        if args.pi_keyring is None or args.pi_keyring_sha256 is None:
            raise ValueError("OS1 Pi keyring is required")
        if digest(args.pi_keyring) != args.pi_keyring_sha256:
            raise ValueError("OS1 keyring SHA-256 mismatch")
    workspace = OUT / args.target / ("installer-work" if args.installer else "work")
    workspace.mkdir(parents=True, exist_ok=False)
    try:
        for name in (
            "mkosi.conf",
            "mkosi.initrd.conf",
            "mkosi.initrd.postinst",
            "mkosi.postinst",
            "mkosi.profiles",
            "repart",
            "overlay",
            "initrd-overlay",
            "installer-overlay",
            "pi",
        ):
            source = ROOT / name
            if source.is_dir():
                shutil.copytree(source, workspace / name)
            else:
                shutil.copy2(source, workspace / name)
        if args.installer:
            # Optical media has no writable persistent /var; its fstab uses tmpfs.
            (workspace / "repart/40-var.conf").unlink()
        architecture = "x86-64" if args.target == "x86-64" else "arm64"
        node_arch = "x64" if architecture == "x86-64" else "arm64"
        version = pins["node"]["version"]
        node_name = f"node-v{version}-linux-{node_arch}"
        assets = OUT / "downloads"
        assets.mkdir(parents=True, exist_ok=True)
        node_archive = assets / (node_name + ".tar.xz")
        download(
            f"https://nodejs.org/dist/v{version}/{node_archive.name}",
            pins["node"][architecture],
            node_archive,
        )
        node_tree = workspace / "node"
        # The upstream Node archive includes npm symlinks; read only the two
        # exact regular files, never unpack npm or allow tar to follow links.
        extract_selected(node_archive, node_tree, node_name, ("bin/node", "LICENSE"))
        overlay = workspace / "overlay"
        shutil.copytree(node_tree, overlay / "usr/lib/nodejs")
        install_hardening(overlay)
        # The linux-targeted runtime's admitted shapes (enumerated from the
        # 0.19.0 linux-x64 tarball; webview chunks carry content hashes, so
        # churn-tolerant directories admit by suffix while the tarball's
        # SHA-256 pins the exact bytes). Universal-only members (darwin
        # bundles, Windows sources) are refused until consciously added.
        # RLF-MUSESETUP adds what int grew since: the judge model catalog
        # the runtime reads, the Vim client's inert scripts, and the
        # judge peer's C source (inert on the node; nothing compiles it).
        runtime_files = {
            "package.json",
            "README.md",
            "LICENSE",
            "THIRD_PARTY_NOTICES.txt",
            "package.nls.json",
            "dist/legal-data.json.br",
            "dist/runtime.bundles.json.br",
            "dist/whatsNew.json",
            "dist/judgeModels.json",
            "dist/legal-data/NOTICE.md",
            "dist/legal-data/provenance.json",
            "l10n/ui.tables.json.br",
            "l10n/usage.tables.json.br",
            "design/fonts/manifest.json",
            "editors/vim/README.md",
            "editors/vim/autoload/muse_spark.vim",
            "editors/vim/doc/muse_spark.txt",
            "editors/vim/plugin/muse_spark.vim",
            "native/linux/x64/muse-created",
            "native/linux/x64/muse-vault-peer",
            "native/linux/arm64/muse-created",
            "native/linux/arm64/muse-vault-peer",
            "native/linux/MuseSparkLocalJudgePeer.c",
            "native/runner/runner-helper.ps1",
            "native/runner/runner-helper.sh",
        }

        def single_level(name, prefix):
            return name.startswith(prefix) and "/" not in name[len(prefix) :]

        def allowed(name):
            if name in runtime_files:
                return True
            if single_level(name, "dist/"):
                return name.endswith(".js")
            if name.startswith("dist/webview/"):
                return name.endswith(".js") or name.endswith(".css")
            if single_level(name, "schemas/"):
                return name.endswith(".schema.json")
            if single_level(name, "ci/lib/"):
                return name.endswith(".mjs")
            if single_level(name, "ci/prompts/ci/"):
                return name.endswith(".md")
            if single_level(name, "package.nls."):
                return name.endswith(".json")
            return False

        extract(artifact, overlay / "usr/lib/muse-spark-code", "package", allowed)
        package = json.loads(
            (overlay / "usr/lib/muse-spark-code/package.json").read_text()
        )
        if (
            package.get("name") != "muse-spark-code-acp"
            or package.get("version") != "0.19.0"
        ):
            raise ValueError("OS1 wrong runtime package/version")
        runtime = overlay / "usr/lib/muse-node-os"
        shutil.copytree(ROOT / "runtime", runtime)
        if args.binding is not None:
            if digest(args.binding) != args.binding_sha256:
                raise ValueError("OS1 binding SHA-256 mismatch")
            shutil.copyfile(args.binding, runtime / "service-binding.mjs")
        receipt = {
            "target": args.target,
            "runtime": digest(artifact),
            "pins": pins,
            "binding": digest(args.binding) if args.binding else None,
        }
        if args.target in ("pi4", "pi5"):
            receipt["pi"] = prepare_pi(
                args.target, workspace, assets, download, args.pi_keyring
            )
        input_name = "inputs-installer.json" if args.installer else "inputs.json"
        (workspace.parent / input_name).write_text(json.dumps(receipt, indent=2) + "\n")
        return workspace
    except BaseException:
        shutil.rmtree(workspace)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=sorted(TARGETS))
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--runtime-sha256", required=True)
    parser.add_argument("--binding", type=Path)
    parser.add_argument("--binding-sha256")
    parser.add_argument("--mkosi", type=Path, default=Path("/usr/bin/mkosi"))
    parser.add_argument("--pi-keyring", type=Path)
    parser.add_argument("--pi-keyring-sha256")
    parser.add_argument("--extra-search-path", action="append", default=[])
    parser.add_argument("--installer", action="store_true")
    args = parser.parse_args()
    if (args.binding is None) != (args.binding_sha256 is None):
        parser.error("binding and its digest must be supplied together")
    if (args.pi_keyring is None) != (args.pi_keyring_sha256 is None):
        parser.error("keyring and its digest must be supplied together")
    if args.installer and args.target in ("pi4", "pi5"):
        parser.error("Pi targets use native firmware, not a UEFI ISO")
    if args.target in ("pi4", "pi5") and args.pi_keyring is None:
        parser.error("Pi builds need --pi-keyring with its digest")
    workspace = stage(args)
    try:
        profiles = args.target + (",installer" if args.installer else "")
        prefix = "muse-node-" + args.target + ("-installer" if args.installer else "")
        command = [
            str(args.mkosi.resolve()),
            "--force",
            "-C",
            str(workspace),
            "--profile=" + profiles,
            "--output-directory=" + str(workspace.parent),
            "--output=" + prefix,
            "--workspace-directory=" + str(workspace.parent / "scratch"),
            "--package-cache-dir=" + str(OUT / "package-cache"),
        ]
        for extra in args.extra_search_path:
            command.append("--extra-search-path=" + str(Path(extra).resolve()))
        subprocess.run(command + ["build"], check=True)
        if args.target in ("pi4", "pi5"):
            manifest = json.loads((ROOT / "pi/manifest.json").read_text())
            finish_pi(args.target, workspace.parent, manifest)
            # mkosi's checksums precede native boot assembly; replace them with
            # checksums of the final media, never publish stale digests.
            sums = workspace.parent / ("muse-node-" + args.target + ".SHA256SUMS")
            sums.write_text(
                "".join(
                    digest(file) + "  " + file.name + "\n"
                    for file in sorted(
                        workspace.parent.glob("muse-node-" + args.target + ".*")
                    )
                    if file.is_file() and not file.is_symlink() and file != sums
                )
            )
        images = [
            file
            for file in workspace.parent.iterdir()
            if file.is_file()
            and not file.is_symlink()
            and file.name != "artifacts.json"
        ]
        (workspace.parent / "artifacts.json").write_text(
            json.dumps(
                [
                    {
                        "file": file.name,
                        "bytes": file.stat().st_size,
                        "sha256": digest(file),
                    }
                    for file in sorted(images)
                ],
                indent=2,
            )
            + "\n"
        )
    finally:
        # Only this invocation's workspace is removed; downloaded pinned assets
        # can be reused across architectures and removed after qualification.
        shutil.rmtree(workspace)


if __name__ == "__main__":
    main()
