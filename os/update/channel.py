#!/usr/bin/env python3
"""TUF update-channel check for Muse Node OS bundles (OS2, M110).

A real TUF client for the channel's fixed topology, following the
detailed client workflow of the TUF specification v1.0
(https://theupdateframework.github.io/specification/latest/ §5):
root rotation with dual thresholds, timestamp/snapshot/targets with
threshold signatures, expiry against a fixed update start time,
rollback continuity against persisted trusted metadata, and bundle
verification by length and SHA-256. It replaces the single-key signed
channel (PLAN §9 OS2-TUF, resolved): one compromised channel key can no
longer sign a policy-conforming channel, because every role needs its
own threshold of keys and rotation needs both the old and the new root
thresholds.

Fixed topology (documented subsets, all fail closed):
- Roles are root, timestamp, snapshot and top-level targets only. A
  targets file carrying delegations is refused: the channel never
  issues them.
- Consistent snapshots are not used: metadata travels at fixed names
  (timestamp.json, snapshot.json, targets.json) and roots at
  <version>.root.json, exactly as §5 reads them when the repository
  disables them. A root enabling them is refused.
- One signature scheme: RSA with rsassa-pss-sha256, verified with the
  openssl on PATH (dgst -sigopt, saltlen auto). Keys of any other type
  or scheme are unusable and never count towards a threshold. RSA keys
  under 2048 bits are unusable. A machine whose openssl cannot verify
  PSS (notably LibreSSL, which silently ignores -sigopt) refuses every
  channel: fail closed, never silent success.
- One hash algorithm for targets and metadata bindings: SHA-256. A meta
  or target entry without a SHA-256 hash is refused.
- One bundle layout: targets entries live at bundles/<version>.raucb
  with a strict dotted version. Multi-architecture channels are
  separate metadata directories, chosen by the caller.

Trust anchor and ceremony (the owner's, Q-M110, OS2-SIGNING): the
initial root ships with the verified image/installer (cosign-verified
per D90.15) at /etc/muse/update-root.json and becomes trusted on first
use; rotation carries trust forward from there. The offline root, the
release-job certificates and key distribution are named handoffs, not
claimed here.

State in the state dir (default /var/lib/muse-update): the trusted
root.json, timestamp.json, snapshot.json and targets.json (each written
atomically as it becomes trusted, per §5, so an aborted run resumes),
plus `version`, the installed bundle's dotted version, which the
installer/RAUC hook rewrites after a successful install (a named
handoff). A missing, corrupt or unreadable state refuses with
TUF_STATE_INVALID; only an explicit --first-boot seeds it.

Spec parameters set by this application (tuf-spec §5 leaves W/X/Y/Z to
the application): metadata files are capped at 1 MiB each, and root
rotation walks at most 64 links per run (a longer rotation completes
over several runs; the cap is a stop condition, never an error).

Usage: channel.py check --metadata-dir D --bundle F [--state-dir S]
       [--trust-root R] [--first-boot]
Prints one machine-readable code on stdout; exit 0 only for TUF_OK:
  TUF_OK, TUF_DOWNGRADE, TUF_EXPIRED, TUF_ROLLBACK, TUF_BAD_SIGNATURE,
  TUF_STATE_INVALID, TUF_MALFORMED, TUF_NO_VERIFY_TOOL, TUF_BAD_TARGET,
  TUF_UNKNOWN_TARGET.
Refusals never distinguish causes beyond the code: a missing tool, a
missing key or signature, an unsupported scheme and a failed verify all
refuse without saying which on stdout (fail closed).
"""

import argparse
import base64
import binascii
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

TRUST_ROOT_DEFAULT = "/etc/muse/update-root.json"
STATE_DEFAULT = "/var/lib/muse-update"
# Longest accepted decimal field: far beyond any real version or counter,
# far below Python's int-conversion limit, so parsing can never raise.
MAX_DIGITS = 18
# Largest storable counter or version: signed 64-bit.
MAX_COUNTER = 2**63 - 1
# Spec W/X/Y/Z: no channel metadata file is ever near this size.
MAX_METADATA_BYTES = 1024 * 1024
# Spec Y: root links walked per run; longer rotations resume next run.
ROOT_CHAIN_MAX = 64
# RSA keys under this size never count towards a threshold.
MIN_RSA_BITS = 2048
# The one signature scheme this client verifies.
RSA_SCHEME = "rsassa-pss-sha256"
RSA_KEYTYPE = "rsa"
# TUF metadata major version this client reads.
SPEC_MAJOR = "1"


def code(name, status):
    print(name)
    return status


def plain_number(text):
    """Return the int of an ASCII-only, nonnegative decimal, else None."""
    if not text.isascii() or not text.isdigit() or len(text) > MAX_DIGITS:
        return None
    return int(text)


def valid_version(value):
    """True for a TUF metadata version: a positive int within bounds."""
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= MAX_COUNTER


def parse_version(text):
    """Return the tuple of a strict dotted version (1-4 parts, no leading
    zeros), else None. Bundle versions and the installed state share it."""
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


class CanonicalError(Exception):
    """Canonical JSON refuses floats and non-JSON values."""


def canonical_encode(value):
    """OLPC Canonical JSON bytes: sorted keys, no whitespace, only quote
    and backslash escaped. Floats are refused: TUF metadata carries none."""
    if value is None:
        return b"null"
    if value is True:
        return b"true"
    if value is False:
        return b"false"
    if isinstance(value, int):
        return str(value).encode("ascii")
    if isinstance(value, float):
        raise CanonicalError("floats have no canonical form")
    if isinstance(value, str):
        return b'"' + value.replace("\\", "\\\\").replace('"', '\\"').encode("utf-8") + b'"'
    if isinstance(value, (list, tuple)):
        return b"[" + b",".join(canonical_encode(item) for item in value) + b"]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value.keys()):
            if not isinstance(key, str):
                raise CanonicalError("non-string key")
            parts.append(canonical_encode(key) + b":" + canonical_encode(value[key]))
        return b"{" + b",".join(parts) + b"}"
    raise CanonicalError("unsupported value %r" % type(value).__name__)


def keyid_of(key):
    """The TUF keyid: SHA-256 hex over the canonical key object."""
    return hashlib.sha256(canonical_encode(key)).hexdigest()


def has_float(value):
    """True when canonical JSON cannot represent this value: floats and
    non-string keys never appear in conforming TUF metadata."""
    if isinstance(value, float):
        return True
    if isinstance(value, (list, tuple)):
        return any(has_float(item) for item in value)
    if isinstance(value, dict):
        return any(not isinstance(key, str) or has_float(item) for key, item in value.items())
    return False


def read_capped(path):
    """Read a metadata file up to the size cap, else None. One bounded
    read: nothing the size check passed can grow past it."""
    try:
        with open(path, "rb") as handle:
            data = handle.read(MAX_METADATA_BYTES + 1)
    except OSError:
        return None
    if len(data) > MAX_METADATA_BYTES:
        return None
    return data


def parse_envelope(data):
    """Split a metadata file into its signed dict, or None. The envelope
    shape {"signatures": [...], "signed": {...}} is required."""
    try:
        envelope = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(envelope, dict):
        return None
    signatures = envelope.get("signatures")
    signed = envelope.get("signed")
    if not isinstance(signatures, list) or not isinstance(signed, dict):
        return None
    return (signatures, signed)


def spec_version_ok(signed):
    version = signed.get("spec_version")
    return isinstance(version, str) and version.split(".")[0] == SPEC_MAJOR


def role_shape_ok(signed, role):
    """The fields every role carries: type, spec version, version, expiry."""
    if has_float(signed):
        return False
    if signed.get("_type") != role:
        return False
    if not spec_version_ok(signed):
        return False
    if not valid_version(signed.get("version")):
        return False
    if not isinstance(signed.get("expires"), str):
        return False
    return parse_expiry(signed["expires"]) is not None


def _tlv(data, pos, end, expected):
    """One DER value: (value_start, value_end, next_pos), else None. All
    offsets stay inside [pos, end): overruns fail, never clamp."""
    if pos + 2 > end or data[pos] != expected:
        return None
    at = pos + 1
    first = data[at]
    at += 1
    if first < 0x80:
        length = first
    else:
        count = first & 0x7F
        if count == 0 or count > 4 or at + count > end:
            return None
        length = int.from_bytes(data[at : at + count], "big")
        at += count
    if at + length > end:
        return None
    return (at, at + length, at + length)


RSA_ENCRYPTION_OID = bytes([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01])


def spki_rsa_bits(pem_text):
    """Bit length of an RSA SubjectPublicKeyInfo PEM's modulus, else None.
    Pure DER length arithmetic: stable across openssl output formats.
    Every level is fully consumed: trailing garbage fails closed."""
    try:
        lines = [line.strip() for line in pem_text.splitlines()]
        body = "".join(line for line in lines if line and not line.startswith("-----"))
        der = base64.b64decode(body, validate=True)
    except (binascii.Error, ValueError):
        return None
    try:
        outer = _tlv(der, 0, len(der), 0x30)
        if outer is None or outer[2] != len(der):
            return None
        inner = _tlv(der, outer[0], outer[1], 0x30)
        if inner is None:
            return None
        oid = _tlv(der, inner[0], inner[1], 0x06)
        if oid is None or der[oid[0] : oid[1]] != RSA_ENCRYPTION_OID:
            return None
        null = _tlv(der, oid[2], inner[1], 0x05)
        if null is None or null[0] != null[1] or null[2] != inner[1]:
            return None
        bits = _tlv(der, inner[2], outer[1], 0x03)
        if bits is None or bits[2] != outer[1]:
            return None
        content = der[bits[0] : bits[1]]
        if not content or content[0] != 0:
            return None
        seq = _tlv(content, 1, len(content), 0x30)
        if seq is None or seq[2] != len(content):
            return None
        modulus = _tlv(content, seq[0], seq[1], 0x02)
        if modulus is None:
            return None
        raw = content[modulus[0] : modulus[1]].lstrip(b"\x00")
        if not raw:
            return None
        return len(raw) * 8
    except (IndexError, ValueError):
        return None


def usable_key(key):
    """True for a key this client can verify: RSA with the PSS scheme, a
    PEM public block, and at least MIN_RSA_BITS. Anything else never
    counts towards a threshold, but never fails parsing either."""
    if not isinstance(key, dict):
        return False
    if key.get("keytype") != RSA_KEYTYPE or key.get("scheme") != RSA_SCHEME:
        return False
    keyval = key.get("keyval")
    if not isinstance(keyval, dict) or not isinstance(keyval.get("public"), str):
        return False
    bits = spki_rsa_bits(keyval["public"])
    return bits is not None and bits >= MIN_RSA_BITS


def openssl_verify(public_pem, signature, data):
    """Verify canonical bytes against one RSA-PSS signature with openssl.
    Key and signature travel in temp files (both public); the verified
    bytes arrive on stdin, never a reopened path. Any failure, including
    an openssl that cannot do PSS, is False: fail closed."""
    key_file = None
    sig_file = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as handle:
            handle.write(public_pem)
            key_file = handle.name
        with tempfile.NamedTemporaryFile("wb", suffix=".sig", delete=False) as handle:
            handle.write(signature)
            sig_file = handle.name
        completed = subprocess.run(
            [
                "openssl",
                "dgst",
                "-sha256",
                "-sigopt",
                "rsa_padding_mode:pss",
                "-sigopt",
                "rsa_pss_saltlen:auto",
                "-verify",
                key_file,
                "-signature",
                sig_file,
            ],
            input=data,
            capture_output=True,
        )
        return completed.returncode == 0
    except OSError:
        return False
    finally:
        for path in (key_file, sig_file):
            if path is not None:
                try:
                    Path(path).unlink()
                except OSError:
                    pass


def threshold_met(signatures, signed, role_keys, threshold):
    """True when unique verified signatures from the role's keys meet the
    threshold. Each keyid counts once; unknown, unusable or duplicate
    keyids never count. (§5: every role's arbitrary-software check.)"""
    if has_float(signed):
        return False
    seen = set()
    verified = 0
    try:
        canonical = canonical_encode(signed)
    except CanonicalError:
        return False
    for entry in signatures:
        if not isinstance(entry, dict):
            continue
        keyid = entry.get("keyid")
        sig_hex = entry.get("sig")
        if not isinstance(keyid, str) or not isinstance(sig_hex, str):
            continue
        if keyid in seen:
            continue
        seen.add(keyid)
        key = role_keys.get(keyid)
        if key is None or not usable_key(key):
            continue
        try:
            signature = bytes.fromhex(sig_hex)
        except ValueError:
            continue
        if openssl_verify(key["keyval"]["public"], signature, canonical):
            verified += 1
            if verified >= threshold:
                return True
    return False


def root_roles(root):
    """The role table of a validated root: {role: (keyids, threshold)}."""
    roles = root.get("roles")
    if not isinstance(roles, dict):
        return None
    table = {}
    for name in ("root", "timestamp", "snapshot", "targets"):
        role = roles.get(name)
        if not isinstance(role, dict):
            return None
        keyids = role.get("keyids")
        threshold = role.get("threshold")
        if (
            not isinstance(keyids, list)
            or not keyids
            or not all(isinstance(item, str) for item in keyids)
            or not isinstance(threshold, int)
            or isinstance(threshold, bool)
            or threshold < 1
            or threshold > len(keyids)
        ):
            return None
        table[name] = (keyids, threshold)
    return table


def root_keys(root):
    """The validated key table of a root: recomputed keyids must match."""
    keys = root.get("keys")
    if not isinstance(keys, dict) or not keys:
        return None
    table = {}
    for keyid, key in keys.items():
        if not isinstance(keyid, str) or not isinstance(key, dict):
            return None
        try:
            if keyid_of(key) != keyid:
                return None
        except CanonicalError:
            return None
        table[keyid] = key
    return table


def role_keys_for(root_table, keys_table, role):
    keyids, _ = root_table[role]
    return {keyid: keys_table[keyid] for keyid in keyids if keyid in keys_table}


def valid_root(signed):
    """A validated root's (keys, roles), or None. Shape only: signatures
    are checked by the caller against the trusting root."""
    if not role_shape_ok(signed, "root"):
        return None
    keys = root_keys(signed)
    roles = root_roles(signed)
    if keys is None or roles is None:
        return None
    consistent = signed.get("consistent_snapshot", False)
    if consistent is not False:
        return None
    return (keys, roles)


def meta_entry(meta, name):
    """One file entry of a timestamp/snapshot meta table, or None."""
    if not isinstance(meta, dict):
        return None
    entry = meta.get(name)
    if not isinstance(entry, dict):
        return None
    if not valid_version(entry.get("version")):
        return None
    length = entry.get("length")
    if length is not None and (
        not isinstance(length, int) or isinstance(length, bool) or length < 0
    ):
        return None
    hashes = entry.get("hashes")
    if hashes is not None:
        if not isinstance(hashes, dict):
            return None
        digest = hashes.get("sha256")
        if digest is not None and (
            not isinstance(digest, str) or len(digest) != 64 or not digest.isascii()
        ):
            return None
    return entry


def meta_binding_ok(data, entry):
    """The file bytes match the parent role's length/hash binding (::5.5.2,
    §5.6.2). Length caps the size; a listed SHA-256 must match."""
    length = entry.get("length")
    if length is not None and len(data) > length:
        return False
    hashes = entry.get("hashes")
    if hashes is not None and hashes.get("sha256") is not None:
        digest = hashlib.sha256(data).hexdigest()
        if digest != hashes["sha256"]:
            return False
    return True


def valid_timestamp(signed):
    if not role_shape_ok(signed, "timestamp"):
        return None
    entry = meta_entry(signed.get("meta"), "snapshot.json")
    return entry if entry is not None else None


def valid_snapshot(signed):
    if not role_shape_ok(signed, "snapshot"):
        return None
    entry = meta_entry(signed.get("meta"), "targets.json")
    if entry is None:
        return None
    versions = {}
    meta = signed.get("meta")
    for name, item in meta.items():
        if not valid_version(item.get("version")):
            return None
        versions[name] = item["version"]
    return (entry, versions)


def valid_targets(signed):
    if not role_shape_ok(signed, "targets"):
        return None
    if "delegations" in signed:
        return None
    targets = signed.get("targets")
    if not isinstance(targets, dict):
        return None
    return targets


def atomic_write(path, data):
    """Persist trusted metadata so an aborted run resumes: write temp,
    then rename over the old file."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".tuf-")
    try:
        with open(fd, "wb") as handle:
            handle.write(data)
        Path(tmp).replace(target)
    except OSError:
        try:
            Path(tmp).unlink()
        except OSError:
            pass
        raise


def load_trusted(state_dir, name):
    """Trusted metadata bytes, or None when absent. Present-but-unreadable
    is None too: the caller refuses either way without first-boot."""
    return read_capped(Path(state_dir) / name)


def check(metadata_dir, bundle_path, state_dir, trust_root, first_boot=False):
    start = time.time()
    if shutil.which("openssl") is None:
        return code("TUF_NO_VERIFY_TOOL", 7)
    meta_dir = Path(metadata_dir)
    state = Path(state_dir)

    # §5.2 trusted root: persisted state, else the shipped anchor on
    # first use. Either way it must parse and meet its own threshold:
    # a corrupt anchor fails fast instead of poisoning the walk.
    trusted_root_data = load_trusted(state, "root.json")
    if trusted_root_data is None and not first_boot:
        return code("TUF_STATE_INVALID", 5)
    seeded = trusted_root_data is None
    if seeded:
        trusted_root_data = read_capped(trust_root)
        if trusted_root_data is None:
            return code("TUF_STATE_INVALID", 5)
    parsed = parse_envelope(trusted_root_data)
    if parsed is None:
        return code("TUF_STATE_INVALID", 5)
    trusted_signatures, trusted_signed = parsed
    validated = valid_root(trusted_signed)
    if validated is None:
        return code("TUF_STATE_INVALID", 5)
    trusted_keys, trusted_roles = validated
    root_keyids, root_threshold = trusted_roles["root"]
    if not threshold_met(
        trusted_signatures,
        trusted_signed,
        role_keys_for(trusted_roles, trusted_keys, "root"),
        root_threshold,
    ):
        return code("TUF_STATE_INVALID", 5)
    if seeded:
        try:
            atomic_write(state / "root.json", trusted_root_data)
        except OSError:
            return code("TUF_STATE_INVALID", 5)
    start_roles = {
        name: set(trusted_roles[name][0]) for name in ("timestamp", "snapshot")
    }

    # §5.3 root rotation: walk N+1... while versioned files exist, each
    # meeting the old and the new thresholds, each persisted as trusted.
    version = trusted_signed["version"]
    walked = 0
    while walked < ROOT_CHAIN_MAX:
        candidate = read_capped(meta_dir / ("%d.root.json" % (version + 1)))
        if candidate is None:
            break
        parsed = parse_envelope(candidate)
        if parsed is None:
            return code("TUF_MALFORMED", 6)
        signatures, signed = parsed
        new_validated = valid_root(signed)
        if new_validated is None:
            return code("TUF_MALFORMED", 6)
        new_keys, new_roles = new_validated
        old_keyids, old_threshold = trusted_roles["root"]
        new_keyids, new_threshold = new_roles["root"]
        old_met = threshold_met(
            signatures, signed, role_keys_for(trusted_roles, trusted_keys, "root"), old_threshold
        )
        new_met = threshold_met(
            signatures, signed, role_keys_for(new_roles, new_keys, "root"), new_threshold
        )
        if not old_met or not new_met:
            return code("TUF_BAD_SIGNATURE", 4)
        if signed["version"] != version + 1:
            return code("TUF_ROLLBACK", 3)
        try:
            atomic_write(state / "root.json", candidate)
        except OSError:
            return code("TUF_STATE_INVALID", 5)
        trusted_root_data = candidate
        trusted_signatures, trusted_signed = signatures, signed
        trusted_keys, trusted_roles = new_keys, new_roles
        version = signed["version"]
        walked += 1
    if parse_expiry(trusted_signed["expires"]) <= start:
        return code("TUF_EXPIRED", 2)
    for name in ("timestamp", "snapshot"):
        if set(trusted_roles[name][0]) != start_roles[name]:
            for stale in ("timestamp.json", "snapshot.json"):
                try:
                    (state / stale).unlink()
                except OSError:
                    pass
            break

    def role_threshold(role):
        keyids, threshold = trusted_roles[role]
        return (role_keys_for(trusted_roles, trusted_keys, role), threshold)

    # §5.4 timestamp: threshold, rollback continuity, freeze, persist.
    # An unchanged timestamp ends the metadata update normally (§5.4.3.1):
    # the bundle is then answered from trusted metadata below.
    timestamp_data = read_capped(meta_dir / "timestamp.json")
    if timestamp_data is None:
        return code("TUF_MALFORMED", 6)
    parsed = parse_envelope(timestamp_data)
    if parsed is None:
        return code("TUF_MALFORMED", 6)
    timestamp_signatures, timestamp_signed = parsed
    timestamp_entry = valid_timestamp(timestamp_signed)
    if timestamp_entry is None:
        return code("TUF_MALFORMED", 6)
    timestamp_keys, timestamp_threshold = role_threshold("timestamp")
    if not threshold_met(timestamp_signatures, timestamp_signed, timestamp_keys, timestamp_threshold):
        return code("TUF_BAD_SIGNATURE", 4)
    trusted_timestamp_data = load_trusted(state, "timestamp.json")
    trusted_timestamp_entry = None
    if trusted_timestamp_data is not None:
        trusted_parsed = parse_envelope(trusted_timestamp_data)
        if trusted_parsed is None:
            return code("TUF_STATE_INVALID", 5)
        trusted_timestamp_entry = valid_timestamp(trusted_parsed[1])
        if trusted_timestamp_entry is None:
            return code("TUF_STATE_INVALID", 5)
        if timestamp_signed["version"] < trusted_parsed[1]["version"]:
            return code("TUF_ROLLBACK", 3)
        if timestamp_signed["version"] == trusted_parsed[1]["version"]:
            targets = trusted_targets(state)
            if targets is None:
                return code("TUF_STATE_INVALID", 5)
            return check_bundle(state, bundle_path, targets, False)
        if trusted_timestamp_entry["version"] > timestamp_entry["version"]:
            return code("TUF_ROLLBACK", 3)
    if parse_expiry(timestamp_signed["expires"]) <= start:
        return code("TUF_EXPIRED", 2)
    try:
        atomic_write(state / "timestamp.json", timestamp_data)
    except OSError:
        return code("TUF_STATE_INVALID", 5)

    # §5.5 snapshot: parent binding, threshold, version, rollback, freeze.
    snapshot_data = read_capped(meta_dir / "snapshot.json")
    if snapshot_data is None or not meta_binding_ok(snapshot_data, timestamp_entry):
        return code("TUF_MALFORMED", 6)
    parsed = parse_envelope(snapshot_data)
    if parsed is None:
        return code("TUF_MALFORMED", 6)
    snapshot_signatures, snapshot_signed = parsed
    snapshot_validated = valid_snapshot(snapshot_signed)
    if snapshot_validated is None:
        return code("TUF_MALFORMED", 6)
    snapshot_entry, snapshot_versions = snapshot_validated
    snapshot_keys, snapshot_threshold = role_threshold("snapshot")
    if not threshold_met(snapshot_signatures, snapshot_signed, snapshot_keys, snapshot_threshold):
        return code("TUF_BAD_SIGNATURE", 4)
    if snapshot_signed["version"] != timestamp_entry["version"]:
        return code("TUF_MALFORMED", 6)
    trusted_snapshot_data = load_trusted(state, "snapshot.json")
    if trusted_snapshot_data is not None:
        trusted_parsed = parse_envelope(trusted_snapshot_data)
        if trusted_parsed is None:
            return code("TUF_STATE_INVALID", 5)
        trusted_validated = valid_snapshot(trusted_parsed[1])
        if trusted_validated is None:
            return code("TUF_STATE_INVALID", 5)
        for name, version in trusted_validated[1].items():
            if name not in snapshot_versions or snapshot_versions[name] < version:
                return code("TUF_ROLLBACK", 3)
    if parse_expiry(snapshot_signed["expires"]) <= start:
        return code("TUF_EXPIRED", 2)
    try:
        atomic_write(state / "snapshot.json", snapshot_data)
    except OSError:
        return code("TUF_STATE_INVALID", 5)

    # §5.6 targets: parent binding, threshold, version, freeze. No
    # delegation traversal: delegations are refused (fixed topology).
    targets_data = read_capped(meta_dir / "targets.json")
    if targets_data is None or not meta_binding_ok(targets_data, snapshot_entry):
        return code("TUF_MALFORMED", 6)
    parsed = parse_envelope(targets_data)
    if parsed is None:
        return code("TUF_MALFORMED", 6)
    targets_signatures, targets_signed = parsed
    targets = valid_targets(targets_signed)
    if targets is None:
        return code("TUF_MALFORMED", 6)
    targets_keys, targets_threshold = role_threshold("targets")
    if not threshold_met(targets_signatures, targets_signed, targets_keys, targets_threshold):
        return code("TUF_BAD_SIGNATURE", 4)
    if targets_signed["version"] != snapshot_entry["version"]:
        return code("TUF_MALFORMED", 6)
    if parse_expiry(targets_signed["expires"]) <= start:
        return code("TUF_EXPIRED", 2)
    try:
        atomic_write(state / "targets.json", targets_data)
    except OSError:
        return code("TUF_STATE_INVALID", 5)

    # §5.7 the bundle against the newly trusted targets.
    return check_bundle(state, bundle_path, targets, first_boot)


def trusted_targets(state):
    data = load_trusted(state, "targets.json")
    if data is None:
        return None
    parsed = parse_envelope(data)
    if parsed is None:
        return None
    return valid_targets(parsed[1])


def check_bundle(state, bundle_path, targets, first_boot):
    """§5.7: the bundle file against its targets entry, plus the
    installed-version no-downgrade rule."""
    name = Path(bundle_path).name
    entry = targets.get("bundles/" + name)
    if entry is None:
        return code("TUF_UNKNOWN_TARGET", 9)
    if not isinstance(entry, dict):
        return code("TUF_MALFORMED", 6)
    length = entry.get("length")
    hashes = entry.get("hashes")
    digest = hashes.get("sha256") if isinstance(hashes, dict) else None
    if (
        not isinstance(length, int)
        or isinstance(length, bool)
        or length < 0
        or not isinstance(digest, str)
        or len(digest) != 64
        or any(c not in "0123456789abcdef" for c in digest)
    ):
        return code("TUF_MALFORMED", 6)
    if not name.endswith(".raucb"):
        return code("TUF_MALFORMED", 6)
    version = parse_version(name[: -len(".raucb")])
    if version is None:
        return code("TUF_MALFORMED", 6)
    try:
        installed_text = (Path(state) / "version").read_text(encoding="utf-8").strip()
    except UnicodeDecodeError:
        return code("TUF_STATE_INVALID", 5)
    except OSError:
        if not first_boot:
            return code("TUF_STATE_INVALID", 5)
        installed_text = "0.0.0"
    installed = parse_version(installed_text)
    if installed is None:
        return code("TUF_STATE_INVALID", 5)
    if version < installed:
        return code("TUF_DOWNGRADE", 1)
    try:
        size = Path(bundle_path).stat().st_size
    except OSError:
        return code("TUF_BAD_TARGET", 8)
    if size != length:
        return code("TUF_BAD_TARGET", 8)
    digest_calc = hashlib.sha256()
    try:
        with open(bundle_path, "rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest_calc.update(chunk)
    except OSError:
        return code("TUF_BAD_TARGET", 8)
    if digest_calc.hexdigest() != digest:
        return code("TUF_BAD_TARGET", 8)
    return code("TUF_OK", 0)


def main(argv):
    parser = argparse.ArgumentParser(description="Muse Node OS TUF update-channel check")
    parser.add_argument("command", choices=["check"])
    parser.add_argument("--metadata-dir", required=True)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--state-dir", default=STATE_DEFAULT)
    parser.add_argument("--trust-root", default=TRUST_ROOT_DEFAULT)
    parser.add_argument(
        "--first-boot",
        action="store_true",
        help="seed missing state (installed 0.0.0, trust anchor) instead of refusing",
    )
    args = parser.parse_args(argv)
    return check(args.metadata_dir, args.bundle, args.state_dir, args.trust_root, args.first_boot)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
