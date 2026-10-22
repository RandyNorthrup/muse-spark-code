#!/usr/bin/env python3
"""Strict signed update-channel check for Muse Node OS bundles (OS2, M110).

This is a signed channel with a single key, NOT TUF: one detached RSA
signature over the metadata, with version/expiry/monotonicity policy. A
real TUF client (roles, thresholds, root rotation, timestamp/snapshot/
targets, persisted trusted metadata) is the follow-up PLAN row OS2-TUF,
not claimed here.

Policy, enforced before RAUC ever sees a bundle: the channel refuses
a lower version, expired metadata, and a metadata version that does not
increase. Metadata whose signature cannot be verified with the tools on
the rig (openssl) is refused: fail closed. The signing binding (the
offline root, the release-job certificate, key distribution to
/etc/muse/update-channel.pem and /etc/rauc/keyring.pem) is the owner's
(Q-M110, PLAN D90.24) and is a named handoff, not claimed here
(OS2-SIGNING in docs/certification/m110-os2-image-update.md).

Metadata file (JSON, exact bytes are what the signature covers):
  {"channel": "stable", "version": "1.2.3", "metadata_version": 7,
   "expires": "2026-12-31T00:00:00Z",
   "bundle": {"url": "https://...", "sha256": "<64 hex>"}}
The detached signature lives beside it at <metadata>.sig (raw RSA bytes
over the exact metadata bytes). Verification runs over the SAME in-memory
buffer the policy parsed (fed to openssl on stdin), never over a reopened
pathname, so a file swapped between policy and verify cannot pass.

Installed state is two files in the state dir (default
/var/lib/muse-update): `version` and `metadata_version`. A missing,
corrupt or unreadable state refuses with CHANNEL_STATE_INVALID: the only
exception is an explicit first-boot seed (`--first-boot`, used by image
compose/first boot to initialise state as 0.0.0/0). Incoming and
installed counters share one bound (MAX_COUNTER, 2^63-1): anything the
channel accepts persists verbatim and reads back.

Usage: channel.py check <metadata.json> [--state-dir D] [--key K]
       [--first-boot]
Prints one machine-readable code on stdout; exit 0 only for CHANNEL_OK:
  CHANNEL_OK, CHANNEL_DOWNGRADE, CHANNEL_EXPIRED, CHANNEL_METADATA_STALE,
  CHANNEL_BAD_SIGNATURE, CHANNEL_STATE_INVALID, CHANNEL_MALFORMED,
  CHANNEL_NO_VERIFY_TOOL.
Every field is type-validated before use: wrongly typed JSON, non-ASCII
digits, over-long numbers and out-of-range dates never raise, they refuse
with CHANNEL_MALFORMED; damaged installed state (including invalid UTF-8,
a negative or signed counter) refuses with CHANNEL_STATE_INVALID.
Equal versions are accepted (a re-published channel for the same image
still carries a higher metadata version); anything lower is a downgrade.
Missing openssl, a missing key/signature, or a failed
verify all refuse without distinguishing why on stdout (fail closed).
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

KEY_DEFAULT = "/etc/muse/update-channel.pem"
STATE_DEFAULT = "/var/lib/muse-update"
# Longest accepted decimal field: far beyond any real version or counter,
# far below Python's int-conversion limit, so parsing can never raise.
MAX_DIGITS = 18
# Largest storable metadata counter: signed 64-bit. ONE bound guards both
# the incoming signed metadata and the installed-state file, so anything
# the channel accepts can be persisted verbatim and read back.
MAX_COUNTER = 2**63 - 1


def plain_number(text):
    """Return the int of an ASCII-only, nonnegative decimal, else None."""
    if not text.isascii() or not text.isdigit() or len(text) > MAX_DIGITS:
        return None
    return int(text)


def valid_counter(value):
    """True for an int counter the state file can persist and re-read."""
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_COUNTER


def parse_counter(text):
    """Return the int of an ASCII-only counter within MAX_COUNTER, else None."""
    if not text.isascii() or not text.isdigit() or len(text) > len(str(MAX_COUNTER)):
        return None
    value = int(text)
    return value if valid_counter(value) else None


def code(name, status):
    print(name)
    return status


def parse_version(text):
    parts = text.split(".")
    if not 1 <= len(parts) <= 4:
        return None
    numbers = []
    for part in parts:
        number = plain_number(part)
        if number is None or (len(part) > 1 and part.startswith("0")):
            return None
        numbers.append(number)
    return tuple(numbers)


def parse_expiry(text):
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            return None
        # An offset can push year 1 or 9999 out of range: OverflowError.
        return moment.astimezone(timezone.utc).timestamp()
    except (ValueError, OverflowError):
        return None


def read_installed_state(state_dir, first_boot):
    """Return (version_tuple, metadata_version) or None when invalid.

    Any missing, corrupt (including invalid UTF-8) or unreadable state is
    invalid, and so is a counter that is not a plain nonnegative decimal:
    a negative counter would lower the replay barrier. Only an explicit
    first-boot seed initialises missing state as 0.0.0/0.
    """
    state = Path(state_dir)
    try:
        version_text = (state / "version").read_text(encoding="utf-8").strip()
        meta_text = (state / "metadata_version").read_text(encoding="utf-8").strip()
    except UnicodeDecodeError:
        return None
    except OSError:
        if first_boot and not (state / "version").exists() and not (state / "metadata_version").exists():
            return ((0,), 0)
        return None
    installed_version = parse_version(version_text)
    installed_meta = parse_counter(meta_text)
    if installed_version is None or installed_meta is None:
        return None
    return (installed_version, installed_meta)


def check(metadata_path, state_dir, key_path, first_boot=False):
    try:
        raw = Path(metadata_path).read_bytes()
    except OSError:
        return code("CHANNEL_MALFORMED", 6)
    try:
        metadata = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return code("CHANNEL_MALFORMED", 6)
    if not isinstance(metadata, dict):
        return code("CHANNEL_MALFORMED", 6)
    # Every field is type-checked before parsing: wrongly typed JSON refuses
    # with CHANNEL_MALFORMED, never a traceback.
    raw_version = metadata.get("version", "")
    raw_expiry = metadata.get("expires", "")
    if not isinstance(raw_version, str) or not isinstance(raw_expiry, str):
        return code("CHANNEL_MALFORMED", 6)
    version = parse_version(raw_version)
    meta_version = metadata.get("metadata_version")
    expiry = parse_expiry(raw_expiry)
    bundle = metadata.get("bundle")
    if (
        version is None
        or not valid_counter(meta_version)
        or expiry is None
        or not isinstance(bundle, dict)
        or not isinstance(bundle.get("url"), str)
        or not bundle.get("url")
        or not isinstance(bundle.get("sha256"), str)
        or len(bundle.get("sha256", "")) != 64
        or any(c not in "0123456789abcdef" for c in bundle["sha256"])
    ):
        return code("CHANNEL_MALFORMED", 6)
    if not isinstance(metadata.get("channel"), str) or not metadata.get("channel"):
        return code("CHANNEL_MALFORMED", 6)

    installed = read_installed_state(state_dir, first_boot)
    if installed is None:
        return code("CHANNEL_STATE_INVALID", 5)
    installed_version, installed_meta = installed

    if version < installed_version:
        return code("CHANNEL_DOWNGRADE", 1)
    if meta_version <= installed_meta:
        return code("CHANNEL_METADATA_STALE", 3)
    if time.time() >= expiry:
        return code("CHANNEL_EXPIRED", 2)

    if shutil.which("openssl") is None:
        return code("CHANNEL_NO_VERIFY_TOOL", 7)
    signature = Path(str(metadata_path) + ".sig")
    if not signature.is_file():
        return code("CHANNEL_BAD_SIGNATURE", 4)
    # Verify the SAME bytes the policy parsed: the in-memory buffer goes to
    # openssl on stdin, so a pathname swapped after parsing cannot pass.
    verified = subprocess.run(
        [
            "openssl",
            "dgst",
            "-sha256",
            "-verify",
            str(key_path),
            "-signature",
            str(signature),
        ],
        input=raw,
        capture_output=True,
    )
    if verified.returncode != 0:
        return code("CHANNEL_BAD_SIGNATURE", 4)
    return code("CHANNEL_OK", 0)


def main(argv):
    parser = argparse.ArgumentParser(description="Muse Node OS signed update-channel check")
    parser.add_argument("command", choices=["check"])
    parser.add_argument("metadata")
    parser.add_argument("--state-dir", default=STATE_DEFAULT)
    parser.add_argument("--key", default=KEY_DEFAULT)
    parser.add_argument(
        "--first-boot",
        action="store_true",
        help="seed a missing installed state as 0.0.0/0 instead of refusing",
    )
    args = parser.parse_args(argv)
    return check(args.metadata, args.state_dir, args.key, args.first_boot)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
