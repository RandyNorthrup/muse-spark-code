"""Version 1 of the wire protocol between the Thonny plugin and the runtime.

Two channels, both newline-delimited JSON (UTF-8, one object per line):

1. **Runtime announcements** (the runtime's stdout, read by the plugin after
   it starts ``muse-spark-code-acp panel``). Each line is
   ``MUSE_SPARK_<KEY> <value>``. Keys are ``COMPANION_URL``,
   ``COMPANION_LAUNCH`` and ``PROVIDER`` (``"<host> <port> <token>"``).
   Anything else on stdout is ignored, so the runtime's own logs pass
   through untouched.

2. **Serial-provider frames** (the plugin's connection to the endpoint the
   runtime announces). The plugin sends ``hello`` first; the runtime answers
   ``welcome``. Afterwards the runtime sends ``device_request`` frames and
   the plugin answers ``device_response`` frames with the same ``id``.

Every ``device_request`` carries the engine's approval echo
(``approval.request_id`` and ``approval.digest``, D83.16): the plugin sends
nothing to Thonny's runner without one, so a forged or replayed frame from
anyone but the engine is refused before it can reach the device.

This schema is the lane-T proposal for the runtime lanes (M103 R/P) to
freeze. ``PROTOCOL_VERSION`` is checked strictly: a peer speaking any other
version is refused without a single byte reaching the device.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
from typing import Optional, Tuple

PROTOCOL_VERSION = 1

#: Largest single frame the plugin will accept, in bytes. Device payloads
#: themselves are bounded by the engine (D83.3); this cap only stops a broken
#: or hostile peer from exhausting the plugin's memory.
FRAME_MAX_BYTES = 64 * 1024

#: Operations the engine may ask the provider for.
OP_READ = "read"
OP_WRITE = "write"
OP_INFO = "info"
KNOWN_OPS = (OP_READ, OP_WRITE, OP_INFO)

#: Stable error codes used in ``device_response`` frames and raised locally.
ERR_BAD_VERSION = "bad_version"
ERR_MALFORMED = "malformed"
ERR_FRAME_TOO_LARGE = "frame_too_large"
ERR_MISSING_APPROVAL = "missing_approval"
ERR_UNKNOWN_OP = "unknown_op"
ERR_BAD_FIELDS = "bad_fields"
ERR_NO_BACKEND = "no_backend"
ERR_BACKEND_ERROR = "backend_error"
ERR_TIMEOUT = "timeout"
ERR_NOT_CONNECTED = "not_connected"
ERR_AUTH_FAILED = "auth_failed"
ERR_TARGET_CHANGED = "target_changed"
ERR_EXPIRED_APPROVAL = "expired_approval"

ANNOUNCE_PREFIX = "MUSE_SPARK_"
KEY_COMPANION_URL = "MUSE_SPARK_COMPANION_URL"
KEY_COMPANION_LAUNCH = "MUSE_SPARK_COMPANION_LAUNCH"
KEY_PROVIDER = "MUSE_SPARK_PROVIDER"


class ProtocolError(Exception):
    """A frame or announcement that must be refused. Never sent onward."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def encode_frame(message: dict) -> bytes:
    """Encode one frame as a ``\\n``-terminated UTF-8 JSON line."""
    return (json.dumps(message, separators=(",", ":")) + "\n").encode("utf-8")


def decode_frame(line: bytes) -> dict:
    """Decode and validate one raw line. Raises :class:`ProtocolError`."""
    if len(line) > FRAME_MAX_BYTES + 1:
        raise ProtocolError(ERR_FRAME_TOO_LARGE, "frame exceeds size limit")
    try:
        message = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ProtocolError(ERR_MALFORMED, "frame is not JSON: %s" % exc)
    if not isinstance(message, dict):
        raise ProtocolError(ERR_MALFORMED, "frame is not an object")
    if type(message.get("v")) is not int or message.get("v") != PROTOCOL_VERSION:
        raise ProtocolError(
            ERR_BAD_VERSION,
            "unsupported protocol version: %r" % (message.get("v"),),
        )
    return message


def check_device_request(message: dict) -> dict:
    """Validate a ``device_request`` frame. Returns it unchanged.

    Raises :class:`ProtocolError` with ``missing_approval``, ``unknown_op``
    or ``bad_fields``; the caller must refuse the request without touching
    the runner.
    """
    if message.get("type") != "device_request":
        raise ProtocolError(ERR_MALFORMED, "not a device_request frame")
    request_id = message.get("id")
    if not isinstance(request_id, str) or not request_id:
        raise ProtocolError(ERR_BAD_FIELDS, "request needs a non-empty id")
    approval = message.get("approval")
    if not isinstance(approval, dict):
        raise ProtocolError(ERR_MISSING_APPROVAL, "request carries no approval")
    for field in ("request_id", "digest"):
        value = approval.get(field)
        if not isinstance(value, str) or not value:
            raise ProtocolError(
                ERR_MISSING_APPROVAL, "approval echo is incomplete"
            )
    op = message.get("op")
    if op not in KNOWN_OPS:
        raise ProtocolError(ERR_UNKNOWN_OP, "unknown op: %r" % (op,))
    if op in (OP_READ, OP_WRITE):
        path = message.get("path")
        if not isinstance(path, str) or not path:
            raise ProtocolError(ERR_BAD_FIELDS, "op needs a non-empty path")
    if op == OP_WRITE:
        payload = message.get("content_b64")
        if not isinstance(payload, str):
            raise ProtocolError(ERR_BAD_FIELDS, "write needs content_b64")
        try:
            base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError):
            raise ProtocolError(ERR_BAD_FIELDS, "content_b64 is not base64")
        if approval["digest"] != bytes_digest(b64decode_bytes(payload)):
            raise ProtocolError(ERR_MISSING_APPROVAL, "write bytes differ from approval")
        target = approval.get("target")
        expiry = approval.get("expires_at")
        if not isinstance(target, str) or not target:
            raise ProtocolError(ERR_MISSING_APPROVAL, "write approval needs target")
        if type(expiry) not in (int, float) or not math.isfinite(expiry):
            raise ProtocolError(ERR_MISSING_APPROVAL, "write approval needs expiry")
    return message


def hello_frame(token: str) -> dict:
    """The provider's first frame on a new connection."""
    return {"v": PROTOCOL_VERSION, "type": "hello", "provider": "thonny", "token": token}


def ok_response(request_id: str, result: dict) -> dict:
    """A successful ``device_response`` for ``request_id``."""
    return {
        "v": PROTOCOL_VERSION,
        "type": "device_response",
        "id": request_id,
        "ok": True,
        "result": result,
    }


def error_response(request_id: str, code: str, message: str) -> dict:
    """A failed ``device_response`` for ``request_id``."""
    return {
        "v": PROTOCOL_VERSION,
        "type": "device_response",
        "id": request_id,
        "ok": False,
        "error": {"code": code, "message": message},
    }


def parse_announcement(line: str) -> Optional[Tuple[str, str]]:
    """Split a ``MUSE_SPARK_<KEY> <value>`` stdout line.

    Returns ``(key, value)`` or ``None`` for anything that is not an
    announcement (ordinary runtime logs pass through untouched).
    """
    if not line.startswith(ANNOUNCE_PREFIX):
        return None
    key, _, value = line[len(ANNOUNCE_PREFIX):].partition(" ")
    key = ANNOUNCE_PREFIX + key.strip()
    value = value.strip()
    if key not in (KEY_COMPANION_URL, KEY_COMPANION_LAUNCH, KEY_PROVIDER):
        return None
    if not value:
        return None
    return (key, value)


def split_provider_value(value: str) -> Tuple[str, int, str]:
    """Split a ``MUSE_SPARK_PROVIDER`` value into ``(host, port, token)``."""
    parts = value.split(" ")
    if len(parts) != 3:
        raise ProtocolError(ERR_MALFORMED, "provider announcement needs host, port and token")
    host, port_text, token = parts
    try:
        port = int(port_text)
    except ValueError:
        raise ProtocolError(ERR_MALFORMED, "provider port is not a number")
    if not 1 <= port <= 65535:
        raise ProtocolError(ERR_MALFORMED, "provider port out of range")
    if not host or not token:
        raise ProtocolError(ERR_MALFORMED, "provider host and token must be non-empty")
    if host != "127.0.0.1":
        raise ProtocolError(ERR_MALFORMED, "provider host must be 127.0.0.1")
    return (host, port, token)


def bytes_digest(data: bytes) -> str:
    """The write approval's digest of the exact decoded bytes."""
    return "sha256:" + hashlib.sha256(data).hexdigest()


def b64encode_bytes(data: bytes) -> str:
    """Encode device bytes for a JSON ``device_response``."""
    return base64.b64encode(data).decode("ascii")


def b64decode_bytes(text: str) -> bytes:
    """Decode a ``content_b64`` field. Raises :class:`ProtocolError`."""
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ProtocolError(ERR_BAD_FIELDS, "content_b64 is not base64: %s" % exc)
