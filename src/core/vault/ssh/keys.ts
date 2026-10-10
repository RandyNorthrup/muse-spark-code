import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  createHash,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto'
import * as z from 'zod/mini'
import { VAULT_KEY_BYTES, VAULT_LIMITS } from '../../../shared/constants'
import { SSH, SshReader, sshString, sshFailure } from './wire'
import { readOpenSshKey } from './openSshFile'

const jwkSchema = z.strictObject({
  kty: z.string(),
  crv: z.optional(z.string()),
  x: z.optional(z.string()),
  y: z.optional(z.string()),
  n: z.optional(z.string()),
  e: z.optional(z.string()),
})
export function sshFingerprint(blob: Uint8Array): string {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/u, '')}`
}
export function publicBlob(key: KeyObject): Buffer {
  const jwk = jwkSchema.parse(key.export({ format: 'jwk' }))
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x)
    return Buffer.concat([sshString('ssh-ed25519'), sshString(Buffer.from(jwk.x, 'base64url'))])
  if (jwk.kty === 'EC' && jwk.crv === 'P-256' && jwk.x && jwk.y)
    return Buffer.concat([
      sshString('ecdsa-sha2-nistp256'),
      sshString('nistp256'),
      sshString(
        Buffer.concat([
          Buffer.from([SSH.uint32Bytes]),
          Buffer.from(jwk.x, 'base64url'),
          Buffer.from(jwk.y, 'base64url'),
        ]),
      ),
    ])
  if (jwk.kty === 'RSA' && jwk.n && jwk.e)
    return Buffer.concat([
      sshString('ssh-rsa'),
      sshString(mpint(Buffer.from(jwk.e, 'base64url'))),
      sshString(mpint(Buffer.from(jwk.n, 'base64url'))),
    ])
  throw sshFailure()
}
const highBit = { mask: 0x80 }
function mpint(bytes: Buffer): Buffer {
  return bytes[0] && bytes[0] & highBit.mask ? Buffer.concat([Buffer.from([0]), bytes]) : bytes
}
function unsigned(bytes: Buffer): Buffer {
  if (bytes.length === 0 || (bytes[0] && bytes[0] & highBit.mask)) throw sshFailure()
  return bytes[0] === 0 ? bytes.subarray(1) : bytes
}
export function parsePublicKey(blob: Buffer): { key: KeyObject; algorithm: string } {
  const reader = new SshReader(blob),
    algorithm = reader.text()
  let key: KeyObject
  switch (algorithm) {
    case 'ssh-ed25519': {
      const x = reader.string()
      if (x.length !== VAULT_KEY_BYTES) throw sshFailure()
      key = createPublicKey({
        format: 'jwk',
        key: { kty: 'OKP', crv: 'Ed25519', x: x.toString('base64url') },
      })
      break
    }
    case 'ecdsa-sha2-nistp256': {
      if (reader.text() !== 'nistp256') throw sshFailure()
      const point = reader.string()
      if (point.length !== SSH.ecPointBytes || point[0] !== SSH.uint32Bytes) throw sshFailure()
      key = createPublicKey({
        format: 'jwk',
        key: {
          kty: 'EC',
          crv: 'P-256',
          x: point.subarray(1, 1 + SSH.ecScalarBytes).toString('base64url'),
          y: point.subarray(1 + SSH.ecScalarBytes).toString('base64url'),
        },
      })
      break
    }
    case 'ssh-rsa': {
      const e = unsigned(reader.string()),
        n = unsigned(reader.string())
      key = createPublicKey({
        format: 'jwk',
        key: { kty: 'RSA', e: e.toString('base64url'), n: n.toString('base64url') },
      })
      break
    }
    default: {
      throw sshFailure()
    }
  }
  reader.end()
  return { key, algorithm }
}
function signatureAlgorithm(blob: Buffer, flags: number): string {
  const { algorithm } = parsePublicKey(blob)
  if (algorithm === 'ssh-rsa') {
    if (flags === SSH.rsa256) return 'rsa-sha2-256'
    if (flags === SSH.rsa512) return 'rsa-sha2-512'
    throw sshFailure()
  }
  if (flags !== 0) throw sshFailure()
  return algorithm
}
export function validateSignFlags(blob: Buffer, flags: number): string {
  return signatureAlgorithm(blob, flags)
}
export function isSshSignatureValid(
  blob: Buffer,
  data: Buffer,
  signature: Buffer,
  expected?: string,
): boolean {
  try {
    const { key, algorithm } = parsePublicKey(blob),
      reader = new SshReader(signature)
    const method = reader.text(),
      value = reader.string()
    reader.end()
    if (expected && expected !== method) return false
    if (algorithm === 'ssh-ed25519')
      return (
        method === algorithm &&
        value.length === SSH.edSignatureBytes &&
        verify(null, data, key, value)
      )
    if (algorithm === 'ecdsa-sha2-nistp256') {
      if (method !== algorithm) return false
      const ec = new SshReader(value),
        r = unsigned(ec.string()),
        s = unsigned(ec.string())
      ec.end()
      if (r.length > SSH.ecScalarBytes || s.length > SSH.ecScalarBytes) return false
      const raw = Buffer.alloc(SSH.ecScalarBytes * 2)
      r.copy(raw, SSH.ecScalarBytes - r.length)
      s.copy(raw, raw.length - s.length)
      return verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, raw)
    }
    return (
      ['rsa-sha2-256', 'rsa-sha2-512'].includes(method) &&
      verify(method === 'rsa-sha2-256' ? 'sha256' : 'sha512', data, key, value)
    )
  } catch {
    return false
  }
}
export function signSshData(
  privateKey: Uint8Array,
  blob: Buffer,
  data: Buffer,
  flags: number,
): Buffer {
  const method = signatureAlgorithm(blob, flags),
    key = createPrivateKey({
      key: Buffer.from(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength),
      format: 'der',
      type: 'pkcs8',
    })
  if (!publicBlob(createPublicKey(key)).equals(blob)) throw sshFailure()
  let raw: Buffer | undefined
  try {
    const digest = method === 'rsa-sha2-512' ? 'sha512' : 'sha256'
    const hash = method === 'ssh-ed25519' ? null : digest
    raw = sign(hash, data, { key, dsaEncoding: 'ieee-p1363' })
    const value =
      method === 'ecdsa-sha2-nistp256'
        ? Buffer.concat([
            sshString(mpint(raw.subarray(0, SSH.ecScalarBytes))),
            sshString(mpint(raw.subarray(SSH.ecScalarBytes))),
          ])
        : raw
    return Buffer.concat([sshString(method), sshString(value)])
  } finally {
    raw?.fill(0)
  }
}
export interface SoftwareSshKey {
  algorithm: 'ed25519' | 'ecdsa-p256' | 'rsa'
  privateKey: Buffer<ArrayBuffer>
  publicKey: string
  fingerprint: string
}
function ownedKey(key: KeyObject): SoftwareSshKey {
  const type = key.asymmetricKeyType
  if (type !== 'ed25519' && type !== 'ec' && type !== 'rsa') throw sshFailure()
  const blob = publicBlob(createPublicKey(key))
  const exported = key.export({ format: 'der', type: 'pkcs8' })
  try {
    const privateKey = Buffer.alloc(exported.length)
    exported.copy(privateKey)
    const algorithm = type === 'ec' ? 'ecdsa-p256' : type
    return {
      algorithm,
      privateKey,
      publicKey: `${parsePublicKey(blob).algorithm} ${blob.toString('base64')}`,
      fingerprint: sshFingerprint(blob),
    }
  } finally {
    exported.fill(0)
  }
}
export function generateEd25519Key(): SoftwareSshKey {
  return ownedKey(generateKeyPairSync('ed25519').privateKey)
}
/** The caller owns and erases the selected file bytes and optional passphrase. No ambient file reads. */
export function importSshKey(bytes: Buffer, passphrase?: Buffer): SoftwareSshKey {
  if (bytes.length > VAULT_LIMITS.valueBytes) throw sshFailure()
  try {
    const armorType = 'OPENSSH PRIVATE KEY'
    if (bytes.includes(Buffer.from(`-----BEGIN ${armorType}-----`))) {
      const { key, blob } = readOpenSshKey(bytes)
      const result = ownedKey(key)
      if (result.publicKey.split(' ', 2)[1] !== blob.toString('base64')) {
        result.privateKey.fill(0)
        throw sshFailure()
      }
      return result
    }
    return ownedKey(
      createPrivateKey({ key: bytes, format: 'pem', ...(passphrase && { passphrase }) }),
    )
  } catch {
    throw sshFailure()
  }
}
