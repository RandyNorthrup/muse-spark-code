// M110os OS3: the first-boot setup's shapes. The browser setup over the LAN
// (network, disk, the setup code, an optional SSH key, the Chrome and NVIDIA
// choices) posts these; the seed reader fills the network part from the
// cloud-init seed. Length bounds below are the wire's own (802.11, WPA,
// RFC 1035): nothing of ours caps a person's value (PLAN.md D121).
import * as z from 'zod/mini'

/** An 802.11 network name is 1 to 32 bytes on the wire. */
const SSID_MAX_LENGTH = 32
/** A WPA passphrase is 8 to 63 characters; a 64-digit key is the raw PSK. */
const WIFI_PSK_MIN_LENGTH = 8
const WIFI_PSK_MAX_LENGTH = 63
/** `/dev/` plus at least one name character. */
const DISK_TARGET_MIN_LENGTH = 6
/** The SSH wire names a field with a big-endian length of this many bytes. */
const SSH_WIRE_U32_BYTES = 4

export const setupSsidSchema = z.string().check(z.minLength(1), z.maxLength(SSID_MAX_LENGTH))

export const setupWifiPskSchema = z.union([
  z.string().check(z.minLength(WIFI_PSK_MIN_LENGTH), z.maxLength(WIFI_PSK_MAX_LENGTH)),
  z.string().check(z.regex(/^[0-9a-fA-F]{64}$/)),
])

export const setupNetworkSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dhcp') }),
  z.strictObject({
    kind: z.literal('wifi'),
    ssid: setupSsidSchema,
    psk: z.optional(setupWifiPskSchema),
  }),
])

export type SetupNetwork = z.infer<typeof setupNetworkSchema>

/** A hostname as RFC 1035 spells it. */
export const setupHostnameSchema = z
  .string()
  .check(
    z.regex(
      /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    ),
  )

/** An install target: a device path, never a relative or escaped one. */
export const setupDiskTargetSchema = z.string().check(
  z.minLength(DISK_TARGET_MIN_LENGTH),
  z.regex(/^\/dev\/[A-Za-z0-9_./-]+$/),
  z.refine((target) => !target.includes('..'), 'a disk target never escapes /dev'),
)

export const setupEncryptionSchema = z.enum(['tpm', 'passphrase', 'none'])

export const setupDiskSchema = z.strictObject({
  target: setupDiskTargetSchema,
  encryption: setupEncryptionSchema,
  /** The optional TPM PIN: non-empty when given, of whatever length the person chose. */
  tpmPin: z.optional(z.string().check(z.minLength(1))),
})

export type SetupDisk = z.infer<typeof setupDiskSchema>

/** Public key types the seed and the setup page accept (OpenSSH PROTOCOL.u2f names the sk pair). */
export const SSH_PUBLIC_KEY_TYPES: readonly string[] = [
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ssh-ed25519@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com',
]

export interface ParsedSshPublicKey {
  readonly type: string
  readonly comment: string | undefined
}

/** Read one RFC 4251 string field, or undefined past the blob's end. */
function readWireString(blob: Buffer, at: number): { value: Buffer; next: number } | undefined {
  if (at < 0 || blob.length - at < SSH_WIRE_U32_BYTES) return undefined
  const length = blob.readUInt32BE(at)
  const start = at + SSH_WIRE_U32_BYTES
  return blob.length - start < length
    ? undefined
    : { value: blob.subarray(start, start + length), next: start + length }
}

/** The blob's first field must name its own type. */
function readKeyType(blob: Buffer, type: string): number | undefined {
  const field = readWireString(blob, 0)
  return field?.value.toString('ascii') === type ? field.next : undefined
}

/** ssh-ed25519: the type name and exactly 32 key bytes. */
function isEd25519Blob(blob: Buffer): boolean {
  const at = readKeyType(blob, 'ssh-ed25519')
  if (at === undefined) return false
  const key = readWireString(blob, at)
  return key?.value.length === ED25519_KEY_BYTES && key.next === blob.length
}

/** ssh-rsa: the type name and two non-empty mpints, with nothing trailing. */
function isRsaBlob(blob: Buffer): boolean {
  const at = readKeyType(blob, 'ssh-rsa')
  if (at === undefined) return false
  const e = readWireString(blob, at)
  if (e === undefined || e.value.length === 0) return false
  const n = readWireString(blob, e.next)
  return n !== undefined && n.value.length > 0 && n.next === blob.length
}

/** An ed25519 public key is 32 bytes (RFC 8032). */
const ED25519_KEY_BYTES = 32
/** Uncompressed point lengths: 0x04 plus two coordinates (SEC 1). */
const ECDSA_NISTP256_POINT_BYTES = 65
const ECDSA_NISTP384_POINT_BYTES = 97
const ECDSA_NISTP521_POINT_BYTES = 133
const EC_UNCOMPRESSED_POINT = 0x04

/** The curve each ecdsa key type carries, and its uncompressed point length. */
const ECDSA_CURVES: Readonly<Record<string, { curve: string; pointLength: number }>> = {
  'ecdsa-sha2-nistp256': { curve: 'nistp256', pointLength: ECDSA_NISTP256_POINT_BYTES },
  'ecdsa-sha2-nistp384': { curve: 'nistp384', pointLength: ECDSA_NISTP384_POINT_BYTES },
  'ecdsa-sha2-nistp521': { curve: 'nistp521', pointLength: ECDSA_NISTP521_POINT_BYTES },
}

/** ecdsa: the type name, its curve name, and one uncompressed point. */
function isEcdsaBlob(blob: Buffer, type: string): boolean {
  const want = ECDSA_CURVES[type]
  if (want === undefined) return false
  const at = readKeyType(blob, type)
  if (at === undefined) return false
  const curve = readWireString(blob, at)
  if (curve?.value.toString('ascii') !== want.curve) return false
  const point = readWireString(blob, curve.next)
  return (
    point?.value.length === want.pointLength &&
    point.value[0] === EC_UNCOMPRESSED_POINT &&
    point.next === blob.length
  )
}

/** Whether the blob is exactly one key of its named type. */
function isIntactBlob(blob: Buffer, type: string): boolean {
  if (type === 'ssh-ed25519') return isEd25519Blob(blob)
  if (type === 'ssh-rsa') return isRsaBlob(blob)
  return type.startsWith('ecdsa-') ? isEcdsaBlob(blob, type) : readKeyType(blob, type) !== undefined
}

/**
Parse one `authorized_keys` line: a known type, canonical base64, and a
blob that type fully accounts for. Security keys (sk-*) keep the type-name
check only: their full layout needs a hardware token to prove, so sshd is
their final judge and the threat model says so. Anything else is not a key.
*/
export function parseSshPublicKey(line: string): ParsedSshPublicKey | undefined {
  const [type, encoded, ...rest] = line.trim().split(/\s+/)
  if (type === undefined || encoded === undefined || !SSH_PUBLIC_KEY_TYPES.includes(type)) {
    return undefined
  }
  const blob = Buffer.from(encoded, 'base64')
  // Buffer skips characters outside the alphabet instead of failing, so the
  // round trip is the alphabet check: only canonical base64 survives it.
  if (blob.length < SSH_WIRE_U32_BYTES || blob.toString('base64') !== encoded) {
    return undefined
  }
  if (!isIntactBlob(blob, type)) return undefined
  return { type, comment: rest.length === 0 ? undefined : rest.join(' ') }
}

export const setupChoicesSchema = z.strictObject({
  network: setupNetworkSchema,
  disk: setupDiskSchema,
  /** Empty means no key: SSH stays off. */
  sshKey: z.string(),
  chrome: z.enum(['install', 'skip']),
  nvidia: z.enum(['install', 'skip']),
})

export type SetupChoices = z.infer<typeof setupChoicesSchema>
