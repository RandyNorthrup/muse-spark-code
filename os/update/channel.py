#!/usr/bin/env python3
"""Strict update-channel check for Muse Node OS bundles (OS2, M110).

TUF's rules, enforced before RAUC ever sees a bundle: the channel refuses
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
over the exact metadata file, verified with
`openssl dgst -sha256 -verify <key> -signature <sig> <file>`).

Installed state is two files in the state dir (default
/var/lib/muse-update): `version` and `metadata_version`.

Usage: channel.py check <metadata.json> [--state-dir D] [--key K]
Prints one machine-readable code on stdout; exit 0 only for CHANNEL_OK:
  CHANNEL_OK, CHANNEL_DOWNGRADE, CHANNEL_EXPIRED, CHANNEL_METADATA_STALE,
  CHANNEL_BAD_SIGNATURE, CHANNEL_MALFORMED, CHANNEL_NO_VERIFY_TOOL.
Equal versions are accepted (a re-published channel for the same image
still carries a higher metadata version); anything lower is a downgrade.
A missing state dir means a fresh install: version 0.0.0,
metadata_version 0. Missing openssl, a missing key/signature, or a failed
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


def code(name, status):
    print(name)
    return status


def parse_version(text):
    parts = text.split(".")
    if not 1 <= len(parts) <= 4:
        return None
    numbers = []
    for part in parts:
        if not part.isdigit() or (len(part) > 1 and part.startswith("0")):
            return None
        numbers.append(int(part))
    return tuple(numbers)


def parse_expiry(text):
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    return moment.astimezone(timezone.utc).timestamp()


def check(metadata_path, state_dir, key_path):
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
    version = parse_version(metadata.get("version", ""))
    meta_version = metadata.get("metadata_version")
    expiry = parse_expiry(metadata.get("expires", ""))
    bundle = metadata.get("bundle")
    if (
        version is None
        or not isinstance(meta_version, int)
        or isinstance(meta_version, bool)
        or meta_version < 0
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

    state = Path(state_dir)
    try:
        installed_version = parse_version((state / "version").read_text().strip())
        installed_meta = int((state / "metadata_version").read_text().strip())
    except (OSError, ValueError):
        installed_version, installed_meta = (0,), 0
    if installed_version is None:
        installed_version = (0,)

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
    verified = subprocess.run(
        [
            "openssl",
            "dgst",
            "-sha256",
            "-verify",
            str(key_path),
            "-signature",
            str(signature),
            str(metadata_path),
        ],
        capture_output=True,
    )
    if verified.returncode != 0:
        return code("CHANNEL_BAD_SIGNATURE", 4)
    return code("CHANNEL_OK", 0)


def main(argv):
    parser = argparse.ArgumentParser(description="Muse Node OS update-channel check")
    parser.add_argument("command", choices=["check"])
    parser.add_argument("metadata")
    parser.add_argument("--state-dir", default=STATE_DEFAULT)
    parser.add_argument("--key", default=KEY_DEFAULT)
    args = parser.parse_args(argv)
    return check(args.metadata, args.state_dir, args.key)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
