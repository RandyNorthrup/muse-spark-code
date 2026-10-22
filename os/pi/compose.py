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

from check import parse_release_hashes, pi_manifest, verify_pi_packages

# Bounds mirror build.py: a hostile .deb gets the same budget as any archive.
DEB_MEMBER_LIMIT = 65536
DEB_EXPANSION_LIMIT = 256 * 1024 * 1024
# The arm64 Packages index is ~1.7 MB plain; refuse anything far larger
# before parsing a stanza.
PACKAGES_LIMIT = 16 * 1024 * 1024
GPGV = "gpgv"


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
    """Lexically confine a relative symlink target to the staging root (H10/H11).

    Relative targets resolve against directory and are admitted only while
    they stay inside that root. A `..` that pops above the root is an
    escape even though normpath would silently absorb it, so the components
    are resolved with an explicit stack instead. Absolute targets are
    refused by every caller before reaching this check. Nothing here
    follows a link: admission uses lstat/readlink and the copy walks
    directory handles opened O_NOFOLLOW, so an admitted link can never
    pull host bytes into the image.
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
    """Open a data.tar member through a bounded stdlib decoder.

    zstd members decode with Python 3.14's compression.zstd; on a build
    host whose stdlib lacks it the member is refused with a named code
    (fail closed, residual FIXM110OS1B-zstd-host) instead of reaching an
    unbounded host extractor. Unknown compressions are refused likewise.
    """
    if data_name.endswith(".gz"):
        return gzip.open(io.BytesIO(data), "rb")
    if data_name.endswith(".xz"):
        return lzma.open(io.BytesIO(data), "rb")
    if data_name.endswith(".bz2"):
        import bz2

        return bz2.open(io.BytesIO(data), "rb")
    if data_name.endswith((".zst", ".tzst")):
        try:
            from compression import zstd
        except ImportError:
            raise ValueError("OS1 Pi .deb compression unavailable")
        try:
            return zstd.open(io.BytesIO(data), "rb")
        except Exception:
            raise ValueError("OS1 Pi .deb data member")
    if data_name == "data.tar":
        return io.BytesIO(data)
    raise ValueError("OS1 Pi .deb compression")


def admit_data(data_name, data):
    """Admit every data.tar member incrementally before anything is written.

    The archive is streamed one member at a time through the shared
    BoundedArchive reader (every decoded byte, header, PAX record and
    seek counts against its stream limit while streaming, never after a
    full listing): directories, links and files all count toward the
    member budget, per-file and total expansion are checked as each
    header arrives. Returns {relative path: TarInfo}. Absolute symlink
    targets are refused outright; relative ones only when contained;
    hardlinks, devices and other special files are refused like the ACP
    admission. Nothing is written.
    """
    from build import BoundedArchive

    admitted = {}
    links = {}
    count = 0
    total = 0
    with decode_data(data_name, data) as decoded, tarfile.open(
        fileobj=BoundedArchive(decoded), mode="r:"
    ) as source:
        for member in source:
            count += 1
            if count > DEB_MEMBER_LIMIT:
                raise ValueError("OS1 Pi .deb member limit")
            relative = check_member_path(member.name)
            if not relative:
                continue
            if relative in admitted or relative in links:
                raise ValueError("OS1 Pi .deb duplicate member")
            if member.isdir():
                admitted[relative] = member
            elif member.isreg():
                if member.size > DEB_EXPANSION_LIMIT:
                    raise ValueError("OS1 Pi .deb expansion limit")
                total += member.size
                if total > DEB_EXPANSION_LIMIT:
                    raise ValueError("OS1 Pi .deb expansion limit")
                admitted[relative] = member
            elif member.issym() or member.islnk():
                links[relative] = member
            else:
                raise ValueError("OS1 unsafe archive member")
        for relative, member in links.items():
            if (
                member.islnk()
                or member.linkname.startswith("/")
                or not contained(
                    member.linkname, "/" + os.path.dirname(relative).replace("\\", "/")
                )
            ):
                raise ValueError("OS1 unsafe archive member")
    admitted.update(links)
    return admitted


# Descriptor-anchored trees (H10/H11): every stat/open/mkdir/chmod inside a
# staged tree goes through a directory file descriptor opened O_DIRECTORY |
# O_NOFOLLOW from an lstat-validated base, descending one component at a
# time, so a link planted by an earlier package cannot redirect a source
# ancestor or a destination component. Where the platform cannot anchor
# (os.open not in os.supports_dir_fd), the same checks run over joined
# paths: static planted links are still refused, and any unexpected error
# fails closed. Missing expected sources are errors, never silent success.
_HAVE_AT = os.open in os.supports_dir_fd
_DIR_FLAGS = (
    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
)
_WRITE_FLAGS = (
    os.O_WRONLY
    | os.O_CREAT
    | os.O_TRUNC
    | getattr(os, "O_NOFOLLOW", 0)
    if _HAVE_AT
    else os.O_WRONLY | os.O_CREAT | os.O_TRUNC
)


def _check_name(name):
    if (
        not name
        or name in (".", "..")
        or "\\" in name
        or "/" in name
        or name != name.rstrip(" .")
    ):
        raise ValueError("OS1 unsafe archive member")


def _anchor_dir(path):
    """lstat-validate a trusted tree base; return (fd_or_None, abspath).

    A symlink base is refused outright. Where the platform anchors, the
    base is opened O_DIRECTORY | O_NOFOLLOW so descent starts from a
    handle, not a path.
    """
    raw = os.fspath(path)
    try:
        status = os.lstat(raw)
    except OSError:
        raise ValueError("OS1 Pi missing source")
    if stat.S_ISLNK(status.st_mode):
        raise ValueError("OS1 unsafe archive member")
    if _HAVE_AT:
        try:
            return os.open(raw, _DIR_FLAGS), os.path.abspath(raw)
        except OSError:
            raise ValueError("OS1 Pi staging read")
    if not stat.S_ISDIR(status.st_mode):
        raise ValueError("OS1 Pi staging read")
    return None, os.path.abspath(raw)


def _parts_under(base_path, path):
    """Split path into components below base_path; refuse escapes."""
    rel = os.path.relpath(os.path.abspath(os.fspath(path)), base_path)
    if rel == ".":
        return []
    parts = rel.replace("\\", "/").split("/")
    if parts[0] == ".." or any(part in ("", ".", "..") for part in parts):
        raise ValueError("OS1 Pi staging read")
    return parts


def _lstat_at(fd, path, name, reason):
    try:
        if fd is not None:
            return os.lstat(name, dir_fd=fd)
        return os.lstat(os.path.join(path, name))
    except OSError:
        raise ValueError(reason)


def _readlink_at(fd, path, name, reason):
    try:
        if fd is not None:
            return os.readlink(name, dir_fd=fd)
        return os.readlink(os.path.join(path, name))
    except OSError:
        raise ValueError(reason)


def _resolve_source(base_fd, base_path, parts):
    """Return an owned (fd_or_None, abspath) for parts below an anchored base.

    Every level is lstat-checked (links refused) and, where the platform
    anchors, opened O_DIRECTORY | O_NOFOLLOW from its parent handle, so no
    source ancestor can be redirected after validation. Missing levels
    fail with missing source; links and wrong types fail closed. The
    caller closes a non-None fd.
    """
    current_fd, current_path = base_fd, base_path
    try:
        for part in parts:
            _check_name(part)
            child_path = os.path.join(current_path, part)
            try:
                if current_fd is not None:
                    status = os.lstat(part, dir_fd=current_fd)
                else:
                    status = os.lstat(child_path)
            except OSError:
                raise ValueError("OS1 Pi missing source")
            if stat.S_ISLNK(status.st_mode):
                raise ValueError("OS1 unsafe archive member")
            if current_fd is not None:
                try:
                    child_fd = os.open(part, _DIR_FLAGS, dir_fd=current_fd)
                except OSError:
                    raise ValueError("OS1 Pi staging read")
                if current_fd is not base_fd:
                    os.close(current_fd)
                current_fd = child_fd
            elif not stat.S_ISDIR(status.st_mode):
                raise ValueError("OS1 Pi staging read")
            current_path = child_path
    except BaseException:
        if current_fd is not None and current_fd is not base_fd:
            os.close(current_fd)
        raise
    if not parts and current_fd is not None:
        try:
            current_fd = os.dup(current_fd)
        except OSError:
            raise ValueError("OS1 Pi staging read")
    return current_fd, current_path


def _resolve_dest_dir(base_fd, base_path, parts):
    """Return an owned (fd_or_None, abspath) for a destination directory.

    Every level is created-or-verified without following links: a missing
    component is created from its parent handle, an existing symlink or
    non-directory fails the write instead of redirecting it. The caller
    closes a non-None fd.
    """
    current_fd, current_path = base_fd, base_path
    if not parts and current_fd is not None:
        try:
            return os.dup(current_fd), current_path
        except OSError:
            raise ValueError("OS1 Pi staging write")
    try:
        for part in parts:
            _check_name(part)
            child_path = os.path.join(current_path, part)
            try:
                if current_fd is not None:
                    os.mkdir(part, 0o755, dir_fd=current_fd)
                else:
                    os.mkdir(child_path, 0o755)
            except FileExistsError:
                pass
            except OSError:
                raise ValueError("OS1 Pi staging write")
            try:
                if current_fd is not None:
                    status = os.lstat(part, dir_fd=current_fd)
                else:
                    status = os.lstat(child_path)
            except OSError:
                raise ValueError("OS1 Pi staging write")
            if stat.S_ISLNK(status.st_mode) or not stat.S_ISDIR(status.st_mode):
                raise ValueError("OS1 Pi staging write")
            if current_fd is not None:
                try:
                    child_fd = os.open(part, _DIR_FLAGS, dir_fd=current_fd)
                except OSError:
                    raise ValueError("OS1 Pi staging write")
                if current_fd is not base_fd:
                    os.close(current_fd)
                current_fd = child_fd
            current_path = child_path
    except BaseException:
        if current_fd is not None and current_fd is not base_fd:
            os.close(current_fd)
        raise
    return current_fd, current_path


def _check_link(target, directory):
    if target.startswith("/") or not contained(target, directory):
        raise ValueError("OS1 unsafe archive member")


def _admit_open(fd, path, directory, budget):
    """Admit one open directory level; symlinks never followed (H10/H11)."""
    try:
        names = os.listdir(fd) if fd is not None else os.listdir(path)
    except OSError:
        raise ValueError("OS1 unsafe archive member")
    for name in names:
        _check_name(name)
        budget[0] += 1
        if budget[0] > DEB_MEMBER_LIMIT:
            raise ValueError("OS1 Pi .deb member limit")
        status = _lstat_at(fd, path, name, "OS1 unsafe archive member")
        mode = status.st_mode
        child_path = os.path.join(path, name)
        if stat.S_ISLNK(mode):
            _check_link(_readlink_at(fd, path, name, "OS1 unsafe archive member"), directory)
        elif stat.S_ISREG(mode):
            if status.st_nlink > 1:
                raise ValueError("OS1 unsafe archive member")
            budget[1] += status.st_size
            if budget[1] > DEB_EXPANSION_LIMIT:
                raise ValueError("OS1 Pi .deb expansion limit")
        elif stat.S_ISDIR(mode):
            child_fd = None
            if fd is not None:
                try:
                    child_fd = os.open(name, _DIR_FLAGS, dir_fd=fd)
                except OSError:
                    raise ValueError("OS1 unsafe archive member")
            try:
                _admit_open(
                    child_fd,
                    child_path,
                    directory + "/" + name if directory != "/" else "/" + name,
                    budget,
                )
            finally:
                if child_fd is not None:
                    os.close(child_fd)
        else:
            raise ValueError("OS1 unsafe archive member")


def admit_tree(root, base=None):
    """Admit a tree without following any symlink (H10/H11).

    The root itself is lstat-validated (a symlink root or a symlink
    ancestor below the trusted base refuses), and every level below is
    admitted through its parent's handle. Refuses escaping or absolute
    symlinks, hardlinks and special files. setuid/setgid bits are left
    for the copy to strip. A missing root is an error, never success.
    """
    base_path = (
        os.path.abspath(os.fspath(base))
        if base is not None
        else os.path.dirname(os.path.abspath(os.fspath(root)))
    )
    base_fd, resolved_base = _anchor_dir(base_path)
    try:
        fd, resolved = _resolve_source(
            base_fd, resolved_base, _parts_under(resolved_base, root)
        )
        try:
            _admit_open(fd, resolved, "/", [0, 0])
        finally:
            if fd is not None:
                os.close(fd)
    finally:
        if base_fd is not None:
            os.close(base_fd)


def _copy_open(src_fd, src_path, dst_fd, dst_path, directory):
    """Copy one admitted level; destination writes are handle-anchored."""
    try:
        names = os.listdir(src_fd) if src_fd is not None else os.listdir(src_path)
    except OSError:
        raise ValueError("OS1 Pi staging read")
    for name in names:
        _check_name(name)
        status = _lstat_at(src_fd, src_path, name, "OS1 Pi staging read")
        mode = status.st_mode
        child_src = os.path.join(src_path, name)
        child_dst = os.path.join(dst_path, name)
        if stat.S_ISLNK(mode):
            target = _readlink_at(src_fd, src_path, name, "OS1 Pi staging read")
            _check_link(target, directory)
            try:
                if dst_fd is not None:
                    os.symlink(target, name, dir_fd=dst_fd)
                else:
                    os.symlink(target, child_dst)
            except OSError:
                raise ValueError("OS1 Pi staging write")
        elif stat.S_ISREG(mode):
            if status.st_nlink > 1:
                raise ValueError("OS1 unsafe archive member")
            try:
                if src_fd is not None:
                    reader = os.open(
                        name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=src_fd
                    )
                else:
                    reader = os.open(child_src, os.O_RDONLY)
            except OSError:
                raise ValueError("OS1 Pi staging write")
            try:
                with os.fdopen(reader, "rb") as data:
                    try:
                        if dst_fd is not None:
                            writer = os.open(name, _WRITE_FLAGS, 0o666, dir_fd=dst_fd)
                        else:
                            writer = os.open(child_dst, _WRITE_FLAGS, 0o666)
                    except OSError:
                        raise ValueError("OS1 Pi staging write")
                    try:
                        with os.fdopen(writer, "wb") as output:
                            shutil.copyfileobj(data, output)
                    except OSError:
                        raise ValueError("OS1 Pi staging write")
            except OSError:
                raise ValueError("OS1 Pi staging write")
            try:
                if dst_fd is not None:
                    os.chmod(name, 0o755 if mode & 0o111 else 0o644, dir_fd=dst_fd)
                else:
                    os.chmod(child_dst, 0o755 if mode & 0o111 else 0o644)
            except OSError:
                raise ValueError("OS1 Pi staging write")
        elif stat.S_ISDIR(mode):
            child_dst_fd, _resolved = _resolve_dest_dir(dst_fd, dst_path, [name])
            try:
                if dst_fd is not None:
                    os.chmod(name, 0o755, dir_fd=dst_fd)
                else:
                    os.chmod(child_dst, 0o755)
            except OSError:
                raise ValueError("OS1 Pi staging write")
            child_src_fd = None
            if src_fd is not None:
                try:
                    child_src_fd = os.open(name, _DIR_FLAGS, dir_fd=src_fd)
                except OSError:
                    raise ValueError("OS1 Pi staging read")
            try:
                _copy_open(
                    child_src_fd,
                    child_src,
                    child_dst_fd,
                    child_dst,
                    directory + "/" + name if directory != "/" else "/" + name,
                )
            finally:
                if child_src_fd is not None:
                    os.close(child_src_fd)
                if child_dst_fd is not None and child_dst_fd is not dst_fd:
                    os.close(child_dst_fd)
        else:
            raise ValueError("OS1 unsafe archive member")


def _copy_resolve(base, path, *, dest=False):
    """Anchor base and resolve path below it; dest=True creates directories."""
    base_path = (
        os.path.abspath(os.fspath(base))
        if base is not None
        else os.path.dirname(os.path.abspath(os.fspath(path)))
    )
    base_fd, resolved_base = _anchor_dir(base_path)
    try:
        parts = _parts_under(resolved_base, path)
        if dest:
            fd, resolved = _resolve_dest_dir(base_fd, resolved_base, parts)
        else:
            fd, resolved = _resolve_source(base_fd, resolved_base, parts)
        return base_fd, resolved_base, fd, resolved
    except BaseException:
        if base_fd is not None:
            os.close(base_fd)
        raise


def copy_admitted(source, destination, base=None):
    """Copy an admitted tree; symlinks are never followed, setuid is stripped."""
    base_fd, _base_path, src_fd, src_path = _copy_resolve(base, source)
    try:
        dst_base_fd, _dst_base, dst_fd, dst_path = _copy_resolve(base, destination, dest=True)
        try:
            _copy_open(src_fd, src_path, dst_fd, dst_path, "/")
        finally:
            if dst_fd is not None and dst_fd is not dst_base_fd:
                os.close(dst_fd)
            if dst_base_fd is not None and dst_base_fd is not base_fd:
                os.close(dst_base_fd)
    finally:
        if src_fd is not None and src_fd is not base_fd:
            os.close(src_fd)
        if base_fd is not None:
            os.close(base_fd)


def copy_tree(source, destination, exists_ok=False, base=None):
    """Copy a tree without ever following symlinks (H10/H11).

    base is the trusted staging root the source is resolved under: a
    symlink root, or a symlink ancestor between the base and the source,
    refuses. A missing source is an error, never a silent success.
    """
    admit_tree(source, base=base)
    copy_admitted(source, destination, base=base)


def copy_regular(source, destination, base=None):
    """Copy one regular file; refuses symlinks instead of following them.

    Both the source parent and the destination parent are resolved under
    the trusted base (or their own parents), so a symlink ancestor on
    either side refuses instead of redirecting the read or the write. A
    missing source is an error, never a silent success.
    """
    src_name = os.path.basename(os.path.abspath(os.fspath(source)))
    dst_name = os.path.basename(os.path.abspath(os.fspath(destination)))
    _check_name(src_name)
    _check_name(dst_name)
    src_base_fd, _src_base, src_fd, src_path = _copy_resolve(
        base, os.path.dirname(os.path.abspath(os.fspath(source)))
    )
    try:
        status = _lstat_at(src_fd, src_path, src_name, "OS1 Pi missing source")
        if not stat.S_ISREG(status.st_mode) or status.st_nlink > 1:
            raise ValueError("OS1 unsafe archive member")
        try:
            if src_fd is not None:
                reader = os.open(
                    src_name,
                    os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=src_fd,
                )
            else:
                reader = os.open(os.path.join(src_path, src_name), os.O_RDONLY)
        except OSError:
            raise ValueError("OS1 unsafe archive member")
        try:
            dst_base_fd, _dst_base, dst_fd, dst_path = _copy_resolve(
                base,
                os.path.dirname(os.path.abspath(os.fspath(destination))),
                dest=True,
            )
            try:
                # A missing destination is created below; an existing
                # symlink refuses instead of redirecting the write.
                try:
                    if dst_fd is not None:
                        dst_status = os.lstat(dst_name, dir_fd=dst_fd)
                    else:
                        dst_status = os.lstat(os.path.join(dst_path, dst_name))
                except OSError:
                    dst_status = None
                if dst_status is not None and stat.S_ISLNK(dst_status.st_mode):
                    raise ValueError("OS1 Pi staging write")
                try:
                    if dst_fd is not None:
                        writer = os.open(dst_name, _WRITE_FLAGS, 0o666, dir_fd=dst_fd)
                    else:
                        writer = os.open(
                            os.path.join(dst_path, dst_name), _WRITE_FLAGS, 0o666
                        )
                except OSError:
                    raise ValueError("OS1 Pi staging write")
                try:
                    with os.fdopen(reader, "rb") as data, os.fdopen(
                        writer, "wb"
                    ) as output:
                        shutil.copyfileobj(data, output)
                except OSError:
                    raise ValueError("OS1 Pi staging write")
            finally:
                if dst_fd is not None and dst_fd is not dst_base_fd:
                    os.close(dst_fd)
                if dst_base_fd is not None and dst_base_fd is not src_base_fd:
                    os.close(dst_base_fd)
        except BaseException:
            try:
                os.close(reader)
            except OSError:
                pass
            raise
    finally:
        if src_fd is not None and src_fd is not src_base_fd:
            os.close(src_fd)
        if src_base_fd is not None:
            os.close(src_base_fd)


def extract_deb(archive, destination):
    """Stage one .deb into the overlay through member admission (H10/H11/H17).

    The ar container is parsed here and the data member is admitted
    incrementally (bounds checked while streaming, never after a full
    listing); wanted regular files are then streamed out as they arrive,
    with per-file bytes counted against the declared size and the
    expansion budget, into a disposable quarantine. The quarantine tree
    is admitted without following symlinks before anything reaches the
    destination, and the control member is never extracted, so maintainer
    scripts cannot run and no host extractor is invoked.
    """
    from build import BoundedArchive

    raw = Path(archive).read_bytes()
    if len(raw) > DEB_EXPANSION_LIMIT:
        raise ValueError("OS1 Pi .deb expansion limit")
    data_name, data = ar_members(raw)
    quarantine = Path(
        tempfile.mkdtemp(prefix="pi-deb-", dir=str(Path(destination).parent))
    )
    try:
        admitted = admit_data(data_name, data)
        with decode_data(data_name, data) as decoded, tarfile.open(
            fileobj=BoundedArchive(decoded), mode="r:"
        ) as source:
            for member in source:
                relative = check_member_path(member.name)
                if not relative:
                    continue
                wanted = admitted.get(relative)
                if wanted is None or not wanted.isreg() or not member.isreg():
                    continue
                if wanted.size > DEB_EXPANSION_LIMIT:
                    raise ValueError("OS1 Pi .deb expansion limit")
                target = quarantine / Path(*relative.split("/"))
                target.parent.mkdir(parents=True, exist_ok=True)
                extracted = source.extractfile(member)
                if extracted is None:
                    raise ValueError("OS1 Pi .deb data member")
                remaining = wanted.size
                with extracted, target.open("wb") as output:
                    while chunk := extracted.read(1024 * 1024):
                        remaining -= len(chunk)
                        if remaining < 0:
                            raise ValueError("OS1 Pi .deb expansion limit")
                        output.write(chunk)
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
        admit_tree(quarantine)
        copy_admitted(str(quarantine), Path(destination))
    finally:
        shutil.rmtree(quarantine, ignore_errors=True)


def read_packages(index_file, index_path):
    """Decompress a downloaded Packages index; refuse oversized payloads."""
    raw = Path(index_file).read_bytes()
    if len(raw) > PACKAGES_LIMIT:
        raise ValueError("OS1 Pi packages index limit")
    if index_path.endswith(".gz"):
        with gzip.open(io.BytesIO(raw), "rb") as decoded:
            text = decoded.read(PACKAGES_LIMIT + 1)
    elif index_path.endswith(".xz"):
        with lzma.open(io.BytesIO(raw), "rb") as decoded:
            text = decoded.read(PACKAGES_LIMIT + 1)
    elif "." not in index_path.rsplit("/", 1)[-1]:
        text = raw
    else:
        raise ValueError("OS1 Pi packages index compression")
    if len(text) > PACKAGES_LIMIT:
        raise ValueError("OS1 Pi packages index limit")
    try:
        return text.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("OS1 Pi packages index encoding")


def prepare(target, workspace, assets, download, keyring, runner=None):
    manifest = json.loads((workspace / "pi/manifest.json").read_text())
    fingerprint, index_sha, index_url, index_path = pi_manifest(
        manifest, require_https=False
    )
    board = manifest["targets"][target]
    run = runner or subprocess.run
    # The InRelease is the trust root: no digest pins it, its clearsign
    # signature against the manifest-pinned fingerprint does. download()
    # still bounds the fetch; an expected digest of None skips hash reuse.
    index_file = assets / "InRelease"
    download(index_url, None, index_file)
    verify_signature(index_file, fingerprint, keyring, runner=run)
    release_entries = parse_release_hashes(clearsign_payload(index_file))
    packages_file = assets / index_path.replace("/", "_")
    download(index_url.rsplit("/", 1)[0] + "/" + index_path, index_sha, packages_file)
    wanted = verify_pi_packages(
        manifest, release_entries, read_packages(packages_file, index_path)
    )
    overlay = workspace / "overlay"
    for package in manifest["packages"]:
        if package["package"] not in (
            "raspi-firmware",
            "linux-image-" + board["kernel"],
        ):
            continue
        archive = assets / (package["package"] + ".deb")
        download(package["url"], wanted[package["package"]]["sha256"], archive)
        if archive.stat().st_size != wanted[package["package"]]["size"]:
            raise ValueError("OS1 Pi package size")
        extract_deb(archive, overlay)
    modules = overlay / "usr/lib/modules" / board["kernel"]
    copy_regular(
        overlay / "boot" / ("vmlinuz-" + board["kernel"]),
        modules / "vmlinuz",
        base=workspace,
    )
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
    # Every source below resolves under the workspace handle: a symlink
    # root, or a symlink ancestor an earlier package planted between the
    # workspace and the source, refuses instead of redirecting the read.
    copy_tree(overlay / "usr/lib/raspi-firmware", boot, base=workspace)
    copy_tree(modules / "dtb/broadcom", boot, exists_ok=True, base=workspace)
    copy_tree(modules / "dtb/overlays", boot / "overlays", exists_ok=True, base=workspace)
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
