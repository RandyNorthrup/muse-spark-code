#!/usr/bin/env python3
"""OS1 image composer; inputs are pinned, no owner data is accepted."""

import argparse
import gzip
import hashlib
import json
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


def download(url, expected, dest):
    if dest.exists() and digest(dest) == expected:
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
        if digest(partial) != expected:
            raise ValueError("OS1 input SHA-256 mismatch")
        partial.replace(dest)
    finally:
        partial.unlink(missing_ok=True)


def extract(archive, destination, prefix, allowed):
    # Validate the whole archive BEFORE any write. Links, special files and
    # Windows-style paths are never build inputs (H10/H11/H17).
    with archive.open("rb") as header:
        compressed = header.read(2) == b"\x1f\x8b"
    # npm packages are gzip tarballs; plain tar is useful for isolated fixtures.
    with (
        gzip.open(archive, "rb") if compressed else archive.open("rb")
    ) as decoded, tarfile.open(fileobj=BoundedArchive(decoded), mode="r:") as source:
        members = []
        total = 0
        for member in source:
            if len(members) >= ARCHIVE_MEMBER_LIMIT:
                raise ValueError("OS1 archive member limit")
            members.append(member)
            parts = member.name.replace("\\", "/").rstrip("/").split("/")
            if (
                "\\" in member.name
                or parts[0] != prefix
                or any(
                    not p
                    or ":" in p
                    or p != p.rstrip(" .")
                    or any(ord(c) < 32 or ord(c) == 127 for c in p)
                    for p in parts
                )
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError("OS1 unsafe archive member")
            total += member.size
            if total > DOWNLOAD_LIMIT * 4:
                raise ValueError("OS1 archive exceeds expansion limit")
            relative = "/".join(parts[1:]).rstrip("/")
            if member.isfile() and not allowed(relative):
                raise ValueError("OS1 unexpected archive member: " + relative)
        for member in members:
            relative = "/".join(member.name.split("/")[1:]).rstrip("/")
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


def stage(args):
    check(ROOT)
    if args.target not in TARGETS:
        raise ValueError("OS1 unknown target")
    artifact = args.runtime.resolve(strict=True)
    if digest(artifact) != args.runtime_sha256:
        raise ValueError("OS1 runtime SHA-256 mismatch")
    pins = json.loads((ROOT / "pins.json").read_text())
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
        with tarfile.open(node_archive) as source:
            for name in ("bin/node", "LICENSE"):
                member = source.getmember(node_name + "/" + name)
                if not member.isfile():
                    raise ValueError("OS1 Node input is not a regular file")
                dest = node_tree / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as data, dest.open("wb") as output:
                    shutil.copyfileobj(data, output)
                dest.chmod(0o755 if name == "bin/node" else 0o644)
        overlay = workspace / "overlay"
        shutil.copytree(node_tree, overlay / "usr/lib/nodejs")
        bundles = {
            "acp.js",
            "node.js",
            "modelApi.js",
            "reviewer.js",
            "foreignHooks.js",
            "hookRuntime.js",
            "recorder.js",
            "uiText.js",
            "uiTextRuntime.js",
            "uiTextHooks.js",
            "uiTextSurfaces.js",
            "extensionHooks.js",
            "validation.js",
            "wire.js",
            "searchWorker.js",
            "pageWorker.js",
        }

        def allowed(name):
            return (
                name
                in {"package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.txt"}
                or name in {"dist/" + bundle for bundle in bundles}
                or (name.startswith("l10n/ui.") and name.endswith(".json"))
                or name.startswith("schemas/exec-")
                and name.endswith(".schema.json")
                or name
                in {
                    "native/windows/MuseSparkJob.cs",
                    "native/windows/MuseSparkMcpJob.cs",
                }
            )

        extract(artifact, overlay / "usr/lib/muse-spark-code", "package", allowed)
        package = json.loads(
            (overlay / "usr/lib/muse-spark-code/package.json").read_text()
        )
        if (
            package.get("name") != "muse-spark-code-acp"
            or package.get("version") != "0.14.0"
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
            receipt["pi"] = prepare_pi(args.target, workspace, assets, download)
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
    parser.add_argument("--extra-search-path", action="append", default=[])
    parser.add_argument("--installer", action="store_true")
    args = parser.parse_args()
    if (args.binding is None) != (args.binding_sha256 is None):
        parser.error("binding and its digest must be supplied together")
    if args.installer and args.target in ("pi4", "pi5"):
        parser.error("Pi targets use native firmware, not a UEFI ISO")
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
