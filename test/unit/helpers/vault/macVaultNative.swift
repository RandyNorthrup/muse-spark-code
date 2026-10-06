// Pure native assertions: no Keychain item, entitlement or authentication prompt.
import Foundation
import CryptoKit
import Security

func rejects(_ name: String, _ action: () throws -> Void) throws {
    do {
        try action()
    } catch {
        print("PASS \(name)")
        return
    }
    print("FAIL \(name)")
    exit(1)
}

@main
struct MacVaultNativeTests {
    static func main() throws {
        let identity = SlotIdentity(slotId: String(repeating: "a", count: 32),
                                    vaultId: String(repeating: "b", count: 32), tier: "osStore")
        try identity.validate()
        for (name, bad) in [
            ("slot-id", SlotIdentity(slotId: "../other", vaultId: identity.vaultId, tier: identity.tier)),
            ("vault-id", SlotIdentity(slotId: identity.slotId, vaultId: "x", tier: identity.tier)),
            ("tier", SlotIdentity(slotId: identity.slotId, vaultId: identity.vaultId, tier: "unknown"))
        ] {
            try rejects(name) { try bad.validate() }
        }
        let wrapping = SymmetricKey(size: .bits256)
        let key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        let box = try AES.GCM.seal(key, using: wrapping, authenticating: identity.binding)
        guard let sealed = box.combined else { fatalError("FAIL combined") }
        let container = MacContainer(v: 1, identity: identity, sealed: sealed,
                                     keyBlob: nil, ephemeral: nil, salt: nil)
        try container.validate(for: identity)
        let roundtrip = try AES.GCM.open(box, using: wrapping, authenticating: identity.binding)
        precondition(roundtrip == key, "FAIL AES-GCM")
        print("PASS AES-GCM")
        try rejects("version") {
            try MacContainer(v: 2, identity: identity, sealed: sealed, keyBlob: nil, ephemeral: nil, salt: nil).validate(for: identity)
        }
        try rejects("identity-binding") {
            try container.validate(for: SlotIdentity(slotId: String(repeating: "c", count: 32), vaultId: identity.vaultId, tier: identity.tier))
        }
        try rejects("ciphertext-length") {
            try MacContainer(v: 1, identity: identity, sealed: Data(), keyBlob: nil, ephemeral: nil, salt: nil).validate(for: identity)
        }
        try rejects("keychain-no-hardware-fields") {
            try MacContainer(v: 1, identity: identity, sealed: sealed, keyBlob: key, ephemeral: nil, salt: nil).validate(for: identity)
        }
        let hardware = SlotIdentity(slotId: identity.slotId, vaultId: identity.vaultId, tier: "hardware")
        for (name, blob, ephemeral, salt) in [
            ("keyblob-empty", Data(), Data(count: 65), Data(count: 32)),
            ("keyblob-bound", Data(count: 4097), Data(count: 65), Data(count: 32)),
            ("ephemeral-length", Data(count: 1), Data(count: 64), Data(count: 32)),
            ("salt-length", Data(count: 1), Data(count: 65), Data(count: 31))
        ] {
            try rejects(name) {
                try MacContainer(v: 1, identity: hardware, sealed: sealed, keyBlob: blob, ephemeral: ephemeral, salt: salt).validate(for: hardware)
            }
        }
        try rejects("aad-authentication") {
            _ = try AES.GCM.open(box, using: wrapping, authenticating: hardware.binding)
        }
        // Exercise exactly the software ECDH/HKDF/AES pipeline used around the
        // enclave, without claiming a software key is a hardware key.
        let recipient = P256.KeyAgreement.PrivateKey()
        let ephemeral = P256.KeyAgreement.PrivateKey()
        let salt = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        let sender = try ephemeral.sharedSecretFromKeyAgreement(with: recipient.publicKey)
            .hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: hardware.binding, outputByteCount: 32)
        let receiver = try recipient.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: ephemeral.publicKey.x963Representation))
            .hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: hardware.binding, outputByteCount: 32)
        let encrypted = try AES.GCM.seal(key, using: sender, authenticating: hardware.binding)
        let decrypted = try AES.GCM.open(encrypted, using: receiver, authenticating: hardware.binding)
        precondition(decrypted == key, "FAIL ECDH-HKDF-AES")
        print("PASS ECDH-HKDF-AES")
        try requireEnclave(available: true, certified: true)
        try rejects("hardware-unavailable") { try requireEnclave(available: false, certified: true) }
        try rejects("Q-M109-certification") { try requireEnclave(available: true, certified: false) }
        try requireKeychainSuccess(errSecSuccess)
        for (status, expected) in [
            (errSecUserCanceled, VaultFailure.cancelled),
            (errSecInteractionNotAllowed, VaultFailure.keychainLocked),
            (errSecItemNotFound, VaultFailure.itemMissing),
            (errSecAuthFailed, VaultFailure.authentication),
            (errSecParam, VaultFailure.invalidRequest),
            (errSecDuplicateItem, VaultFailure.invalidRequest),
            (errSecNotAvailable, VaultFailure.unavailable)
        ] {
            do {
                try requireKeychainSuccess(status)
                preconditionFailure("FAIL native-status-\(expected.rawValue)")
            } catch let failure as VaultFailure {
                guard failure == expected else {
                    print("FAIL native-status-\(expected.rawValue)")
                    exit(1)
                }
            }
            print("PASS native-status-\(expected.rawValue)")
        }
        for (count, status, expected) in [
            (31, errSecSuccess, VaultFailure.authentication),
            (33, errSecSuccess, VaultFailure.authentication),
            (32, errSecItemNotFound, VaultFailure.itemMissing),
            (32, errSecInteractionNotAllowed, VaultFailure.keychainLocked),
            (32, errSecUserCanceled, VaultFailure.cancelled)
        ] {
            var bytes = Data(repeating: 0x7b, count: count)
            defer { erasePrivateBytes(&bytes) }
            do {
                try validateWrappingKey(&bytes, status: status)
                print("FAIL wrapping-result-rejection")
                exit(1)
            } catch let failure as VaultFailure {
                guard failure == expected, bytes.allSatisfy({ $0 == 0 }) else {
                    print("FAIL wrapping-result-erasure")
                    exit(1)
                }
            }
        }
        var accepted = Data(repeating: 0x7b, count: VaultNative.keyBytes)
        defer { erasePrivateBytes(&accepted) }
        try validateWrappingKey(&accepted, status: errSecSuccess)
        guard accepted == Data(repeating: 0x7b, count: VaultNative.keyBytes) else {
            print("FAIL wrapping-result-handoff")
            exit(1)
        }
        print("PASS wrapping-result-erasure-and-handoff")
        // The helper's actual private reader, with generated input only. No
        // Keychain call or authentication prompt is reachable from these cases.
        for (count, failsRead, name) in [
            (0, false, "empty-private-input"),
            (31, false, "truncated-private-input-31"),
            (32, false, "complete-private-input"),
            (33, false, "trailing-private-input"),
            (31, true, "read-failure-during-private-input"),
            (32, true, "read-failure-after-private-input")
        ] {
            let header = try JSONSerialization.data(withJSONObject: [
                "v": 1, "operation": "wrap", "identity": [
                    "slotId": identity.slotId, "vaultId": identity.vaultId, "tier": identity.tier
                ]
            ])
            var length = UInt32(header.count).bigEndian
            var packet = withUnsafeBytes(of: &length) { Data($0) }
            packet.append(header)
            packet.append(Data(repeating: 0x7b, count: count))
            defer { erasePrivateBytes(&packet) }
            var offset = 0
            var wipedSizes: [Int] = []
            var wasInvalid = false
            do {
                var (_, privateKey) = try readRequest(read: { size in
                    if offset == packet.count && failsRead { throw VaultFailure.invalidRequest }
                    let end = min(offset + size, packet.count)
                    defer { offset = end }
                    return Data(packet[offset..<end])
                }, erasePrivate: { bytes in
                    wipedSizes.append(bytes.count)
                    erasePrivateBytes(&bytes)
                    guard bytes.allSatisfy({ $0 == 0 }) else {
                        print("FAIL private-buffer-erasure")
                        exit(1)
                    }
                })
                defer { erasePrivateBytes(&privateKey) }
                guard privateKey == Data(repeating: 0x7b, count: VaultNative.keyBytes) else {
                    print("FAIL complete-private-input")
                    exit(1)
                }
            } catch let failure as VaultFailure {
                wasInvalid = failure == .invalidRequest
            }
            guard wasInvalid == (count != VaultNative.keyBytes || failsRead),
                  wipedSizes.contains(min(count, VaultNative.keyBytes)),
                  (count != 31 || wipedSizes.filter({ $0 == 31 }).count == 2),
                  (count != 33 || wipedSizes.contains(1)),
                  (count != 32 || !failsRead || wipedSizes.filter({ $0 == 32 }).count == 2),
                  (count != 32 || failsRead || wipedSizes.filter({ $0 == 32 }).count == 1) else {
                print("FAIL \(name): invalidRequest/cleanup")
                exit(1)
            }
            print("PASS \(name): cleanup")
        }
        print("PASS native-contracts")
    }
}
