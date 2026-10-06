"""M109 owned throwaway capture; never queries an existing Keychain item."""
import argparse
import json
import os
import struct
import subprocess
import unittest

parser = argparse.ArgumentParser()
parser.add_argument("helper")
parser.add_argument("--keychain", action="store_true")
args = parser.parse_args()


def call(request, key=b""):
    header = json.dumps(request, separators=(",", ":")).encode()
    result = subprocess.run([args.helper], input=struct.pack(">I", len(header)) + header + key,
                            capture_output=True, timeout=15, check=False)
    if result.stderr:
        raise AssertionError("helper leaked stderr")
    length = struct.unpack(">I", result.stdout[:4])[0]
    response = json.loads(result.stdout[4:4 + length])
    return result.returncode, response, result.stdout[4 + length:]


class NativeProtocol(unittest.TestCase):
    def test_probe(self):
        code, reply, key = call({"v": 1, "operation": "probe"})
        self.assertEqual(code, 0)
        self.assertEqual(reply["status"], "ok")
        self.assertIsInstance(reply["secureEnclave"], bool)
        self.assertFalse(reply["certified"])
        self.assertEqual(key, b"")
        print("probe:", json.dumps(reply, sort_keys=True))

    def test_request_guards(self):
        identity = {"slotId": os.urandom(16).hex(), "vaultId": os.urandom(16).hex(), "tier": "osStore"}
        self.addCleanup(lambda: call({"v": 1, "operation": "delete", "identity": identity}))
        import base64
        container = {"v": 1, "identity": identity, "sealed": base64.b64encode(os.urandom(60)).decode()}
        unwrap = {"v": 1, "operation": "unwrap", "identity": identity, "container": container, "use": "capture"}
        requests = [
            ("empty-use", {**unwrap, "use": ""}, b""),
            ("newline-use", {**unwrap, "use": "bad\nuse"}, b""),
            ("nul-use", {**unwrap, "use": "bad\0use"}, b""),
            ("carriage-return-use", {**unwrap, "use": "bad\ruse"}, b""),
            ("missing-container", {**unwrap, "container": None}, b""),
            ("foreign-container-field", {**unwrap, "container": {**container, "value": "canary"}}, b""),
            ("foreign-nested-field", {**unwrap, "container": {**container, "identity": {**identity, "value": "canary"}}}, b""),
            ("changed-container-identity", {**unwrap, "container": {**container, "identity": {**identity, "slotId": os.urandom(16).hex()}}}, b""),
            ("version", {"v": 2, "operation": "probe"}, b""),
            ("operation", {"v": 1, "operation": "foreign"}, b""),
            ("unknown-field", {"v": 1, "operation": "probe", "secret": "canary"}, b""),
            ("trailing-bytes", {"v": 1, "operation": "probe"}, b"extra"),
            ("short-key", {"v": 1, "operation": "wrap", "identity": identity}, b""),
            ("long-key", {"v": 1, "operation": "wrap", "identity": identity}, os.urandom(33)),
            ("nested-field", {"v": 1, "operation": "delete", "identity": {**identity, "extra": 1}}, b""),
            ("missing-identity", {"v": 1, "operation": "delete", "identity": None}, b""),
            ("invalid-id", {"v": 1, "operation": "delete", "identity": {**identity, "slotId": "../"}}, b""),
        ]
        for name, request, key in requests:
            with self.subTest(guard=name):
                code, reply, secret = call(request, key)
                self.assertEqual(code, 1, name)
                self.assertEqual(reply, {"v": 1, "status": "error", "code": "invalidRequest"}, name)
                self.assertEqual(secret, b"", name)

    def test_header_bounds(self):
        padded = json.dumps({"v": 1, "operation": "probe"}).encode() + b" " * 4096
        for packet in [struct.pack(">I", len(padded)) + padded, b"", b"\0\0", struct.pack(">I", 4097), struct.pack(">I", 0),
                       struct.pack(">I", 1) + b"{", struct.pack(">I", 2) + b"[]"]:
            result = subprocess.run([args.helper], input=packet, capture_output=True, timeout=15, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stderr, b"")

    def test_q_m109_refuses_both_modes(self):
        for tier in ["hardware", "presence"]:
            identity = {"slotId": os.urandom(16).hex(), "vaultId": os.urandom(16).hex(), "tier": tier}
            code, reply, key = call({"v": 1, "operation": "wrap", "identity": identity}, os.urandom(32))
            self.assertEqual((code, reply["code"], key), (1, "unavailable", b""))


def capture_keychain():
    identity = {"slotId": os.urandom(16).hex(), "vaultId": os.urandom(16).hex(), "tier": "osStore"}
    key = os.urandom(32)
    try:
        code, response, secret = call({"v": 1, "operation": "wrap", "identity": identity}, key)
        assert code == 0 and secret == b"", "Keychain create refused (user may need to unlock it)"
        container = response["container"]
        code, response, unwrapped = call({"v": 1, "operation": "unwrap", "identity": identity,
                                         "container": container, "use": "M109 throwaway slot capture"})
        assert code == 0 and unwrapped == key, "Keychain roundtrip"
        code, response, secret = call({"v": 1, "operation": "wrap", "identity": identity}, os.urandom(32))
        assert code == 1 and response["code"] == "invalidRequest" and secret == b"", "duplicate must not overwrite"
        # Same identity, corrupted authenticated ciphertext: no key may return.
        import base64
        sealed = bytearray(base64.b64decode(container["sealed"]))
        sealed[-1] ^= 1
        changed = {**container, "sealed": base64.b64encode(sealed).decode()}
        code, response, secret = call({"v": 1, "operation": "unwrap", "identity": identity,
                                      "container": changed, "use": "M109 tamper capture"})
        assert code == 1 and response["code"] == "authentication" and secret == b"", "tamper refusal"
        print("PASS throwaway login-Keychain create/reload/duplicate/tamper")
    finally:
        code, response, secret = call({"v": 1, "operation": "delete", "identity": identity})
        assert code == 0 and secret == b"", "throwaway item cleanup"
        print("PASS throwaway login-Keychain item deleted")
    code, response, secret = call({"v": 1, "operation": "unwrap", "identity": identity,
                                  "container": container, "use": "M109 deleted item capture"})
    assert code == 1 and response["code"] == "itemMissing" and secret == b"", "deleted item inaccessible"
    print("PASS deleted slot unavailable")


suite = unittest.defaultTestLoader.loadTestsFromTestCase(NativeProtocol)
assert unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful()
if args.keychain:
    capture_keychain()
