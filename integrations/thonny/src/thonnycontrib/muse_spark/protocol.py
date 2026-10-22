"""Lane-T v2 proposal: host context and explicit runtime port ownership.

No device payload or approval is accepted by this plugin. The runtime's
lane-P session alone handles device actions. R/P agreement is still required.
"""

import json
from typing import Optional, Tuple

PROTOCOL_VERSION = 2
FRAME_MAX_BYTES = 64 * 1024
REQUEST_ID_MAX_CHARS = 128
OP_CONTEXT = 'context'
OP_INFO = 'info'
KNOWN_OPS = (OP_CONTEXT, OP_INFO)
ERR_BAD_VERSION = 'bad_version'
ERR_MALFORMED = 'malformed'
ERR_FRAME_TOO_LARGE = 'frame_too_large'
ERR_UNKNOWN_OP = 'unknown_op'
ERR_BAD_FIELDS = 'bad_fields'
ERR_NO_BACKEND = 'no_backend'
ERR_TIMEOUT = 'timeout'
ERR_NOT_CONNECTED = 'not_connected'
ERR_AUTH_FAILED = 'auth_failed'
ANNOUNCE_PREFIX = 'MUSE_SPARK_'
KEY_COMPANION_URL = 'MUSE_SPARK_COMPANION_URL'
KEY_COMPANION_LAUNCH = 'MUSE_SPARK_COMPANION_LAUNCH'
KEY_PROVIDER = 'MUSE_SPARK_PROVIDER'


class ProtocolError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def encode_frame(message):
    raw = (json.dumps(message, separators=(',', ':')) + '\n').encode('utf-8')
    if len(raw) > FRAME_MAX_BYTES + 1:
        raise ProtocolError(ERR_FRAME_TOO_LARGE, 'frame exceeds size limit')
    return raw


def decode_frame(line):
    if len(line) > FRAME_MAX_BYTES + 1:
        raise ProtocolError(ERR_FRAME_TOO_LARGE, 'frame exceeds size limit')
    try:
        message = json.loads(line.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        raise ProtocolError(ERR_MALFORMED, 'frame is not JSON')
    if not isinstance(message, dict):
        raise ProtocolError(ERR_MALFORMED, 'frame is not an object')
    if type(message.get('v')) is not int or message.get('v') != PROTOCOL_VERSION:
        raise ProtocolError(ERR_BAD_VERSION, 'unsupported protocol version')
    return message


def check_request_id(value):
    if not isinstance(value, str) or not value or len(value) > REQUEST_ID_MAX_CHARS:
        raise ProtocolError(ERR_BAD_FIELDS, 'request needs a bounded non-empty id')
    return value


def check_device_request(message):
    if message.get('type') != 'device_request':
        raise ProtocolError(ERR_MALFORMED, 'not a context request')
    check_request_id(message.get('id'))
    if message.get('op') not in KNOWN_OPS:
        raise ProtocolError(ERR_UNKNOWN_OP, 'only displayed context and info are supported')
    if set(message) != {'v', 'type', 'id', 'op'}:
        raise ProtocolError(ERR_BAD_FIELDS, 'context request has unexpected fields')
    return message


def check_port_response(message, request):
    if (message.get('type') != 'port_response' or message.get('id') != request['id']
            or message.get('op') != request['op'] or message.get('port') != request['port']
            or type(message.get('ok')) is not bool):
        raise ProtocolError(ERR_BAD_FIELDS, 'invalid port response')
    if message['ok']:
        expected = 'runtime' if request['op'] == 'acquire' else 'released'
        if message.get('owner') != expected:
            raise ProtocolError(ERR_BAD_FIELDS, 'port ownership was not confirmed')
    return message


def hello_frame(token):
    return {'v': PROTOCOL_VERSION, 'type': 'hello', 'provider': 'thonny', 'token': token}


def ok_response(request_id, result):
    return {'v': PROTOCOL_VERSION, 'type': 'device_response', 'id': request_id,
            'ok': True, 'result': result}


def error_response(request_id, code, message):
    return {'v': PROTOCOL_VERSION, 'type': 'device_response', 'id': request_id,
            'ok': False, 'error': {'code': code, 'message': message}}


def parse_announcement(line: str) -> Optional[Tuple[str, str]]:
    if not line.startswith(ANNOUNCE_PREFIX):
        return None
    key, _, value = line.partition(' ')
    value = value.strip()
    if key not in (KEY_COMPANION_URL, KEY_COMPANION_LAUNCH, KEY_PROVIDER) or not value:
        return None
    return key, value


def split_provider_value(value):
    parts = value.split(' ')
    if len(parts) != 3:
        raise ProtocolError(ERR_MALFORMED, 'provider announcement needs host, port and token')
    host, port_text, token = parts
    try:
        port = int(port_text)
    except ValueError:
        raise ProtocolError(ERR_MALFORMED, 'provider port is not a number')
    if not 1 <= port <= 65535 or not token:
        raise ProtocolError(ERR_MALFORMED, 'invalid provider endpoint')
    if host != '127.0.0.1':
        raise ProtocolError(ERR_MALFORMED, 'provider host must be 127.0.0.1')
    return host, port, token
