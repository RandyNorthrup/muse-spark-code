// Explicit hardware capture only, never compiled into the product helper.
import Foundation
import CryptoKit

@main
struct MacVaultEnclaveCapture {
    static func main() throws {
        precondition(SecureEnclave.isAvailable, "capable Mac required")
        let tier = CommandLine.arguments.contains("--presence") ? "presence" : "hardware"
        let identity = SlotIdentity(slotId: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased(),
                                    vaultId: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased(), tier: tier)
        var key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        defer { key.resetBytes(in: key.startIndex..<key.endIndex) }
        do {
            let container = try wrap(key, identity: identity, certified: true)
            // Serialize and reload the opaque device-bound key blob as a slot would.
            let scratch = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            defer { try? FileManager.default.removeItem(at: scratch) }
            let record = scratch.appendingPathComponent("slot.json")
            try JSONEncoder().encode(container).write(to: record)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: record.path)
            let reloaded = try JSONDecoder().decode(MacContainer.self, from: Data(contentsOf: record))
            var first = try unwrap(reloaded, identity: identity, use: "M109 first throwaway presence capture", certified: true)
            defer { first.resetBytes(in: first.startIndex..<first.endIndex) }
            precondition(first == key, "first roundtrip")
            var second = try unwrap(reloaded, identity: identity, use: "M109 second throwaway presence capture", certified: true)
            defer { second.resetBytes(in: second.startIndex..<second.endIndex) }
            precondition(second == key, "second roundtrip")
            print("PASS \(tier): SE creation, blob reload, ECDH-HKDF-AES, two independent unwrap contexts")
        } catch {
            // Numeric OS status is evidence; localized errors may include identities.
            print("REFUSED \(tier): domain=\((error as NSError).domain) code=\((error as NSError).code)")
            exit(1)
        }
    }
}
