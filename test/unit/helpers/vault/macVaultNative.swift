// Pure native assertions: no Keychain item, entitlement or authentication prompt.
import Foundation
import CryptoKit

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
        print("PASS native-contracts")
    }
}
