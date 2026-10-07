// M109 P: one request per process, private key bytes on stdin/stdout only.
// The file-based login Keychain uses an ACL trusting this signed executable.
// CryptoKit's device-bound SE blob is not a provisioned Keychain item (Q-M109).
import Foundation
import Security
import CryptoKit
import LocalAuthentication

enum VaultNative {
    static let version = 1
    static let keyBytes = 32
    static let headerLimit = 4096
    static let blobLimit = 4096
    static let publicKeyBytes = 65
    static let sealedBytes = 60 // 12-byte nonce + 32-byte key + 16-byte tag
    static let service = "Muse Spark Code (Unofficial).vault.v1"
    // Q-M109: compiled, but never offered until creation/reload/presence are captured.
    static let enclaveCertified = false
    static let bindingDomain = "muse-spark-vault-macos-v1"
}

enum VaultFailure: String, Error {
    case invalidRequest, unavailable, keychainLocked, itemMissing, authentication, cancelled
}

struct SlotIdentity: Codable, Equatable {
    let slotId: String
    let vaultId: String
    let tier: String
    var binding: Data {
        Data("\(VaultNative.bindingDomain):\(vaultId):\(slotId):\(tier)".utf8)
    }
    func validate() throws {
        let pattern = "^[a-f0-9]{32}$"
        guard slotId.range(of: pattern, options: .regularExpression) != nil,
              vaultId.range(of: pattern, options: .regularExpression) != nil,
              ["osStore", "hardware", "presence"].contains(tier) else {
            throw VaultFailure.invalidRequest
        }
    }
}

struct MacContainer: Codable {
    let v: Int
    let identity: SlotIdentity
    let sealed: Data
    let keyBlob: Data?
    let ephemeral: Data?
    let salt: Data?
    func validate(for identity: SlotIdentity) throws {
        guard v == VaultNative.version, self.identity == identity,
              sealed.count == VaultNative.sealedBytes else { throw VaultFailure.invalidRequest }
        if identity.tier == "osStore" {
            guard keyBlob == nil, ephemeral == nil, salt == nil else {
                throw VaultFailure.invalidRequest
            }
        } else {
            guard let keyBlob, !keyBlob.isEmpty, keyBlob.count <= VaultNative.blobLimit,
                  ephemeral?.count == VaultNative.publicKeyBytes,
                  salt?.count == VaultNative.keyBytes else { throw VaultFailure.invalidRequest }
        }
    }
}

struct MacRequest: Decodable {
    let v: Int
    let operation: String
    let identity: SlotIdentity?
    let container: MacContainer?
    let use: String?
}

// JSON carries public metadata/ciphertext. The optional trailing 32 bytes are
// secret. Reading is bounded even if the writer never closes its input pipe.
func erasePrivateBytes(_ bytes: inout Data) {
    bytes.resetBytes(in: bytes.startIndex..<bytes.endIndex)
}

// Injected I/O/erasure lets pure tests observe cleanup, without a Keychain item.
// Production always uses stdin and the eraser; neither is a protocol option.
func readRequest(read: (Int) throws -> Data? = { try FileHandle.standardInput.read(upToCount: $0) },
                 erasePrivate: (inout Data) -> Void = erasePrivateBytes) throws -> (MacRequest, Data) {
    func exact(_ count: Int, isPrivate: Bool = false) throws -> Data {
        var result = Data()
        var isTransferred = false
        defer { if isPrivate && !isTransferred { erasePrivate(&result) } }
        while result.count < count {
            var part = try read(count - result.count) ?? Data()
            defer { if isPrivate { erasePrivate(&part) } }
            guard !part.isEmpty else { throw VaultFailure.invalidRequest }
            result.append(part)
        }
        isTransferred = true
        return result
    }
    let length = try exact(MemoryLayout<UInt32>.size).reduce(0) { ($0 << 8) | Int($1) }
    guard length > 0, length <= VaultNative.headerLimit else { throw VaultFailure.invalidRequest }
    let header = try exact(length)
    guard let fields = try JSONSerialization.jsonObject(with: header) as? [String: Any],
          let operation = fields["operation"] as? String else { throw VaultFailure.invalidRequest }
    let allowed: Set<String>
    switch operation {
    case "probe": allowed = ["v", "operation"]
    case "wrap", "delete": allowed = ["v", "operation", "identity"]
    case "unwrap": allowed = ["v", "operation", "identity", "container", "use"]
    default: throw VaultFailure.invalidRequest
    }
    guard Set(fields.keys) == allowed else { throw VaultFailure.invalidRequest }
    let request = try JSONDecoder().decode(MacRequest.self, from: header)
    guard request.v == VaultNative.version else { throw VaultFailure.invalidRequest }
    if operation != "probe" {
        guard let identity = request.identity else { throw VaultFailure.invalidRequest }
        try identity.validate()
        guard let object = fields["identity"] as? [String: Any],
              Set(object.keys) == ["slotId", "vaultId", "tier"] else {
            throw VaultFailure.invalidRequest
        }
    }
    if operation == "unwrap" {
        guard let identity = request.identity, let container = request.container,
              let use = request.use, !use.isEmpty, use.utf8.count <= VaultNative.headerLimit,
              !use.contains("\0"), !use.contains("\n"), !use.contains("\r"),
              let object = fields["container"] as? [String: Any],
              Set(object.keys).isSubset(of: ["v", "identity", "sealed", "keyBlob", "ephemeral", "salt"]),
              let nested = object["identity"] as? [String: Any],
              Set(nested.keys) == ["slotId", "vaultId", "tier"] else {
            throw VaultFailure.invalidRequest
        }
        try container.validate(for: identity)
    }
    var key = Data()
    var isTransferred = false
    defer { if !isTransferred { erasePrivate(&key) } }
    if operation == "wrap" { key = try exact(VaultNative.keyBytes, isPrivate: true) }
    var trailing = try read(1) ?? Data()
    defer { erasePrivate(&trailing) }
    guard trailing.isEmpty else { throw VaultFailure.invalidRequest }
    isTransferred = true
    return (request, key)
}

// Keep native failures fixed and distinct without relaying OS diagnostics.
func requireKeychainSuccess(_ status: OSStatus) throws {
    switch status {
    case errSecSuccess: return
    case errSecUserCanceled: throw VaultFailure.cancelled
    case errSecInteractionNotAllowed: throw VaultFailure.keychainLocked
    case errSecItemNotFound: throw VaultFailure.itemMissing
    case errSecAuthFailed: throw VaultFailure.authentication
    case errSecParam, errSecDuplicateItem: throw VaultFailure.invalidRequest
    default: throw VaultFailure.unavailable
    }
}

func loginKeychain() throws -> SecKeychain {
    var keychain: SecKeychain?
    let path = NSHomeDirectory() + "/Library/Keychains/login.keychain-db"
    try requireKeychainSuccess(SecKeychainOpen(path, &keychain))
    guard let keychain else { throw VaultFailure.unavailable }
    return keychain
}

func keychainQuery(_ identity: SlotIdentity) throws -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: VaultNative.service,
     kSecAttrAccount as String: identity.vaultId + ":" + identity.slotId,
     kSecMatchSearchList as String: [try loginKeychain()]]
}

func storeWrappingKey(_ key: Data, identity: SlotIdentity) throws {
    var trusted: SecTrustedApplication?
    var access: SecAccess?
    try requireKeychainSuccess(SecTrustedApplicationCreateFromPath(nil, &trusted))
    guard let trusted else { throw VaultFailure.unavailable }
    try requireKeychainSuccess(SecAccessCreate(VaultNative.service as CFString, [trusted] as CFArray, &access))
    guard let access else { throw VaultFailure.unavailable }
    var query = try keychainQuery(identity)
    query.removeValue(forKey: kSecMatchSearchList as String)
    query[kSecUseKeychain as String] = try loginKeychain()
    query[kSecAttrAccess as String] = access
    query[kSecValueData as String] = key
    // Add only: a reused slot cannot overwrite an existing entry.
    try requireKeychainSuccess(SecItemAdd(query as CFDictionary, nil))
}

func readWrappingKey(_ identity: SlotIdentity) throws -> Data {
    var query = try keychainQuery(identity)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    var bytes = (result as? Data) ?? Data()
    result = nil
    try validateWrappingKey(&bytes, status: status)
    return bytes
}

// Validate/erase the owned result separately so pure tests never query a store.
func validateWrappingKey(_ bytes: inout Data, status: OSStatus) throws {
    var isValidated = false
    defer { if !isValidated { erasePrivateBytes(&bytes) } }
    try requireKeychainSuccess(status)
    guard bytes.count == VaultNative.keyBytes else { throw VaultFailure.authentication }
    isValidated = true
}

// These explicit inputs let the capture harness exercise Q-M109; production
// never takes either from argv, stdin, an environment variable or settings.
func requireEnclave(available: Bool = SecureEnclave.isAvailable,
                    certified: Bool = VaultNative.enclaveCertified) throws {
    guard available, certified else { throw VaultFailure.unavailable }
}

func accessControl(_ presence: Bool) throws -> SecAccessControl {
    var error: Unmanaged<CFError>?
    let flags: SecAccessControlCreateFlags = presence ? [.privateKeyUsage, .userPresence] : [.privateKeyUsage]
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                      flags, &error) else {
        throw VaultFailure.unavailable
    }
    return access
}

func wrap(_ key: Data, identity: SlotIdentity, certified: Bool = VaultNative.enclaveCertified) throws -> MacContainer {
    if identity.tier == "osStore" {
        let wrapping = SymmetricKey(size: .bits256)
        let sealed = try AES.GCM.seal(key, using: wrapping, authenticating: identity.binding)
        guard let combined = sealed.combined else { throw VaultFailure.authentication }
        var bytes = wrapping.withUnsafeBytes { Data($0) }
        defer { erasePrivateBytes(&bytes) }
        try storeWrappingKey(bytes, identity: identity)
        return MacContainer(v: VaultNative.version, identity: identity, sealed: combined,
                            keyBlob: nil, ephemeral: nil, salt: nil)
    }
    try requireEnclave(certified: certified)
    let context = LAContext()
    defer { context.invalidate() }
    context.touchIDAuthenticationAllowableReuseDuration = 0
    let resident = try SecureEnclave.P256.KeyAgreement.PrivateKey(
        accessControl: accessControl(identity.tier == "presence"), authenticationContext: context)
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let salt = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    let shared = try ephemeral.sharedSecretFromKeyAgreement(with: resident.publicKey)
    let wrapping = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt,
                                                 sharedInfo: identity.binding, outputByteCount: VaultNative.keyBytes)
    let sealed = try AES.GCM.seal(key, using: wrapping, authenticating: identity.binding)
    guard let combined = sealed.combined else { throw VaultFailure.authentication }
    return MacContainer(v: VaultNative.version, identity: identity, sealed: combined,
                        keyBlob: resident.dataRepresentation, ephemeral: ephemeral.publicKey.x963Representation, salt: salt)
}

func unwrap(_ container: MacContainer, identity: SlotIdentity, use: String,
            certified: Bool = VaultNative.enclaveCertified) throws -> Data {
    try container.validate(for: identity)
    let sealed = try AES.GCM.SealedBox(combined: container.sealed)
    if identity.tier == "osStore" {
        var bytes = try readWrappingKey(identity)
        defer { erasePrivateBytes(&bytes) }
        return try AES.GCM.open(sealed, using: SymmetricKey(data: bytes), authenticating: identity.binding)
    }
    try requireEnclave(certified: certified)
    guard let blob = container.keyBlob, let ephemeral = container.ephemeral, let salt = container.salt else {
        throw VaultFailure.invalidRequest
    }
    // A new context AND a new process for every use: no remembered presence.
    let context = LAContext()
    context.localizedReason = use
    context.touchIDAuthenticationAllowableReuseDuration = 0
    defer { context.invalidate() }
    let resident = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blob, authenticationContext: context)
    let shared = try resident.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: ephemeral))
    let wrapping = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt,
                                                 sharedInfo: identity.binding, outputByteCount: VaultNative.keyBytes)
    return try AES.GCM.open(sealed, using: wrapping, authenticating: identity.binding)
}

func writeResponse(_ header: [String: Any], key: Data = Data()) throws {
    let json = try JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
    var length = UInt32(json.count).bigEndian
    let output = FileHandle.standardOutput
    try output.write(contentsOf: withUnsafeBytes(of: &length) { Data($0) })
    try output.write(contentsOf: json)
    try output.write(contentsOf: key)
}

func runVaultHelper() throws {
    var (request, key) = try readRequest()
    defer { erasePrivateBytes(&key) }
    if request.operation == "probe" {
        try writeResponse(["v": VaultNative.version, "status": "ok", "secureEnclave": SecureEnclave.isAvailable,
                           "certified": VaultNative.enclaveCertified])
        return
    }
    guard let identity = request.identity else { throw VaultFailure.invalidRequest }
    switch request.operation {
    case "wrap":
        let container = try wrap(key, identity: identity)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(container))
        try writeResponse(["v": VaultNative.version, "status": "ok", "container": object])
    case "unwrap":
        guard let container = request.container, let use = request.use else { throw VaultFailure.invalidRequest }
        var unwrapped = try unwrap(container, identity: identity, use: use)
        defer { erasePrivateBytes(&unwrapped) }
        try writeResponse(["v": VaultNative.version, "status": "ok"], key: unwrapped)
    case "delete":
        guard identity.tier == "osStore" else { throw VaultFailure.invalidRequest }
        let status = SecItemDelete(try keychainQuery(identity) as CFDictionary)
        if status != errSecItemNotFound { try requireKeychainSuccess(status) }
        try writeResponse(["v": VaultNative.version, "status": "ok"])
    default: throw VaultFailure.invalidRequest
    }
}

#if !VAULT_TEST
@main
struct VaultMain {
    static func main() {
        do {
            try runVaultHelper()
        } catch {
            // No OS messages, paths, account names or input in errors, including stderr.
            let code = (error as? VaultFailure)?.rawValue ?? VaultFailure.authentication.rawValue
            try? writeResponse(["v": VaultNative.version, "status": "error", "code": code])
            exit(1)
        }
    }
}
#endif
