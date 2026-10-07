"""Strict v2 host-control protocol. Old device writes are always refused."""
import json
import pytest
from thonnycontrib.muse_spark import protocol
from thonnycontrib.muse_spark.protocol import ProtocolError


def _request(**overrides):
    msg = {'v': protocol.PROTOCOL_VERSION, 'type': 'device_request', 'id': 'req-1', 'op': 'context'}
    msg.update(overrides)
    return msg


def test_context_roundtrip_and_no_approval_or_payload_fields():
    msg = _request()
    assert protocol.check_device_request(protocol.decode_frame(protocol.encode_frame(msg))) == msg
    for field in ('approval', 'path', 'content_b64'):
        with pytest.raises(ProtocolError):
            protocol.check_device_request(_request(**{field: 'unexpected'}))


def test_wrong_version_is_refused():
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(b'{"v":999,"type":"welcome"}\n')
    assert caught.value.code == protocol.ERR_BAD_VERSION


@pytest.mark.parametrize('version', [True, 2.0, '2', None, 1])
def test_version_requires_integer_type_and_refuses_old_writer(version):
    with pytest.raises(ProtocolError):
        protocol.decode_frame(protocol.encode_frame({'v': version, 'type': 'welcome'}))


@pytest.mark.parametrize('line', [b'not json\n', b'[1,2]\n', b'\xff\n'])
def test_non_json_or_object_is_refused(line):
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(line)
    assert caught.value.code == protocol.ERR_MALFORMED


def test_oversize_frame_is_refused_in_both_directions():
    with pytest.raises(ProtocolError):
        protocol.decode_frame(b'x' * (protocol.FRAME_MAX_BYTES + 8))
    with pytest.raises(ProtocolError):
        protocol.encode_frame({'v': protocol.PROTOCOL_VERSION, 'text': 'x' * protocol.FRAME_MAX_BYTES})


@pytest.mark.parametrize('op', ['write', 'read', 'flash', 'connect', 'acquire', 'release', 'stop', None, {}])
def test_device_operations_cannot_enter_plugin(op):
    with pytest.raises(ProtocolError) as caught:
        protocol.check_device_request(_request(op=op))
    assert caught.value.code == protocol.ERR_UNKNOWN_OP


@pytest.mark.parametrize('value', [None, '', 1, [], 'x' * 129])
def test_request_id_is_bounded_and_typed(value):
    with pytest.raises(ProtocolError):
        protocol.check_device_request(_request(id=value))


def test_ok_and_error_responses_echo_the_id():
    for msg in (protocol.ok_response('req-1', {'connected': True}),
                protocol.error_response('req-1', protocol.ERR_TIMEOUT, 'timed out')):
        assert msg['id'] == 'req-1'
        assert protocol.decode_frame(protocol.encode_frame(msg)) == msg


def test_announcements_parse_and_ordinary_logs_pass_through():
    for key in (protocol.KEY_COMPANION_URL, protocol.KEY_COMPANION_LAUNCH, protocol.KEY_PROVIDER):
        assert protocol.parse_announcement(key + ' value') == (key, 'value')
    for line in ('ordinary log', 'MUSE_SPARK_UNKNOWN text', 'MUSE_SPARK_COMPANION_URL '):
        assert protocol.parse_announcement(line) is None


def test_provider_value_splits():
    assert protocol.split_provider_value('127.0.0.1 4321 synthetic') == ('127.0.0.1', 4321, 'synthetic')
    for value in ('127.0.0.1 notaport synthetic', '127.0.0.1 4321', '127.0.0.1 0 synthetic'):
        with pytest.raises(ProtocolError):
            protocol.split_provider_value(value)


@pytest.mark.parametrize('host', ['203.0.113.10', '192.168.1.3', 'localhost', '::1'])
def test_announcement_refuses_non_ipv4_loopback(host):
    with pytest.raises(ProtocolError):
        protocol.split_provider_value(host + ' 4321 synthetic')


@pytest.mark.parametrize('field,value', [('id', 'wrong'), ('port', 'COM8'), ('op', 'release'),
                                         ('ok', 1), ('owner', 'thonny')])
def test_round2_port_response_must_confirm_exact_action_and_owner(field, value):
    req = {'id': 'port-id', 'op': 'acquire', 'port': 'COM7'}
    reply = dict(v=protocol.PROTOCOL_VERSION, type='port_response', **req, ok=True, owner='runtime')
    reply[field] = value
    with pytest.raises(ProtocolError):
        protocol.check_port_response(reply, req)

def test_round2_protocol_error_text_never_echoes_peer_values():
    import secrets
    peer_value = secrets.token_urlsafe()
    with pytest.raises(ProtocolError) as caught:
        protocol.decode_frame(json.dumps({'v': peer_value, 'type': 'welcome'}).encode())
    assert peer_value not in str(caught.value), 'peer value leaked in protocol error'
