"""Tests for the v1 wire protocol: every refusal in, nothing out to the device."""

import json

import pytest

from thonnycontrib.muse_spark import protocol
from thonnycontrib.muse_spark.protocol import ProtocolError


def _request(**overrides):
    message = {
        "v": 1,
        "type": "device_request",
        "id": "req-1",
        "approval": {"request_id": "appr-1", "digest": "sha256:abc"},
        "op": "read",
        "path": "main.py",
    }
    message.update(overrides)
    return message


def test_round_trip_read_request():
    raw = protocol.encode_frame(_request())
    assert raw.endswith(b"\n")
    assert protocol.check_device_request(protocol.decode_frame(raw))["op"] == "read"


def test_wrong_version_is_refused():
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(b'{"v": 999, "type": "device_request"}\n')
    assert caught.value.code == protocol.ERR_BAD_VERSION


def test_non_json_is_refused():
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(b"not json\n")
    assert caught.value.code == protocol.ERR_MALFORMED


def test_non_object_is_refused():
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(b"[1, 2]\n")
    assert caught.value.code == protocol.ERR_MALFORMED


def test_oversize_frame_is_refused():
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(b"x" * (protocol.FRAME_MAX_BYTES + 8))
    assert caught.value.code == protocol.ERR_FRAME_TOO_LARGE


def test_request_without_approval_is_refused():
    message = _request()
    del message["approval"]
    with pytest.raises(ProtocolError) as caught:
        protocol.check_device_request(message)
    assert caught.value.code == protocol.ERR_MISSING_APPROVAL


def test_request_with_empty_digest_is_refused():
    message = _request(approval={"request_id": "appr-1", "digest": ""})
    with pytest.raises(ProtocolError) as caught:
        protocol.check_device_request(message)
    assert caught.value.code == protocol.ERR_MISSING_APPROVAL


def test_request_with_empty_request_id_is_refused():
    message = _request(approval={"request_id": "", "digest": "sha256:abc"})
    with pytest.raises(ProtocolError) as caught:
        protocol.check_device_request(message)
    assert caught.value.code == protocol.ERR_MISSING_APPROVAL


def test_unknown_op_is_refused():
    with pytest.raises(ProtocolError) as caught:
        protocol.check_device_request(_request(op="flash"))
    assert caught.value.code == protocol.ERR_UNKNOWN_OP


def test_read_without_path_is_refused():
    message = _request()
    del message["path"]
    with pytest.raises(ProtocolError) as caught:
        protocol.check_device_request(message)
    assert caught.value.code == protocol.ERR_BAD_FIELDS


def test_write_needs_base64_content():
    message = _request(op="write", content_b64="!!!not-base64!!!")
    with pytest.raises(ProtocolError) as caught:
        protocol.check_device_request(message)
    assert caught.value.code == protocol.ERR_BAD_FIELDS
    good = _request(op="write", content_b64=protocol.b64encode_bytes(b"print(1)\n"),
                    approval={"request_id": "appr-1", "digest": protocol.bytes_digest(b"print(1)\n"),
                              "target": "fake-target", "expires_at": 2000000000})
    assert protocol.check_device_request(good)["op"] == "write"


def test_info_needs_no_path():
    message = _request(op="info")
    del message["path"]
    assert protocol.check_device_request(message)["op"] == "info"


def test_ok_and_error_responses_echo_the_id():
    ok = protocol.ok_response("req-1", {"connected": True})
    assert (ok["id"], ok["ok"], ok["v"]) == ("req-1", True, 1)
    err = protocol.error_response("req-1", protocol.ERR_TIMEOUT, "timed out")
    assert (err["id"], err["ok"], err["error"]["code"]) == ("req-1", False, "timeout")
    assert json.loads(protocol.encode_frame(err).decode("utf-8")) == err


def test_announcements_parse_and_ordinary_logs_pass_through():
    assert protocol.parse_announcement("MUSE_SPARK_COMPANION_URL http://127.0.0.1:4311/") == (
        protocol.KEY_COMPANION_URL,
        "http://127.0.0.1:4311/",
    )
    assert protocol.parse_announcement("MUSE_SPARK_COMPANION_LAUNCH abc123") == (
        protocol.KEY_COMPANION_LAUNCH,
        "abc123",
    )
    assert protocol.parse_announcement(
        "MUSE_SPARK_PROVIDER 127.0.0.1 4321 tok-9"
    ) == (protocol.KEY_PROVIDER, "127.0.0.1 4321 tok-9")
    assert protocol.parse_announcement("[panel] listening on 127.0.0.1:4311") is None
    assert protocol.parse_announcement("MUSE_SPARK_UNKNOWN something") is None
    assert protocol.parse_announcement("MUSE_SPARK_COMPANION_URL ") is None


def test_provider_value_splits():
    assert protocol.split_provider_value("127.0.0.1 4321 tok-9") == (
        "127.0.0.1",
        4321,
        "tok-9",
    )
    with pytest.raises(ProtocolError):
        protocol.split_provider_value("127.0.0.1 notaport tok")
    with pytest.raises(ProtocolError):
        protocol.split_provider_value("127.0.0.1 4321")


def test_base64_helpers_round_trip_bytes():
    blob = bytes(range(256))
    assert protocol.b64decode_bytes(protocol.b64encode_bytes(blob)) == blob
    with pytest.raises(ProtocolError) as caught:
        protocol.b64decode_bytes("!!!")
    assert caught.value.code == protocol.ERR_BAD_FIELDS


@pytest.mark.parametrize("version", [True, 1.0, "1", None])
def test_version_requires_integer_type(version):
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(protocol.encode_frame({"v": version, "type": "welcome"}))
    assert caught.value.code == protocol.ERR_BAD_VERSION


@pytest.mark.parametrize("host", ["203.0.113.10", "192.168.1.3", "localhost", "::1"])
def test_announcement_refuses_non_ipv4_loopback(host):
    with pytest.raises(ProtocolError):
        protocol.split_provider_value(host + " 4321 synthetic-token")


@pytest.mark.parametrize("field,value", [("target", None), ("expires_at", None),
                                         ("expires_at", True), ("expires_at", float("nan")),
                                         pytest.param("expires_at", 10**400, id="expires_at-overflow"),
                                         ("digest", "sha256:wrong")])
def test_write_requires_bytes_target_and_expiry(field, value):
    approval = {"request_id": "appr-1", "digest": protocol.bytes_digest(b""),
                "target": "fake-target", "expires_at": 2000000000}
    approval[field] = value
    with pytest.raises(ProtocolError):
        protocol.check_device_request(_request(op="write", content_b64="", approval=approval))
