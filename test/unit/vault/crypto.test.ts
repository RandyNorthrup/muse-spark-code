import { withRngFailure } from './storeFixtures'
import type * as crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  aesGcmOpen,
  aesGcmSeal,
  areVaultBytesEqual,
  decodeVaultBytes,
  decodeVaultMaterial,
  encodeVaultMaterial,
  encodeVaultJson,
  eraseVaultMaterial,
  hkdfSha256,
  openVaultBlock,
  ownedBytes,
  randomVaultBytes,
  sealVaultBlock,
  vaultHmacSha256,
} from '../../../src/core/vault/crypto'
import { item } from '../helpers/vault/fixtures'
import { type VaultItem } from '../../../src/shared/vault'

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof crypto>()
  return { ...original, randomFillSync: vi.fn(original.randomFillSync) }
})

describe('vault crypto', () => {
  it('canonicalizes nested JSON keys and numeric spellings while retaining array order', () => {
    const left = encodeVaultJson({ z: [{ b: -0, a: 1e2 }], a: { z: 2, a: 1 } })
    const right = encodeVaultJson({ a: { a: 1, z: 2 }, z: [{ a: 100, b: 0 }] })
    expect(left).toEqual(right)
    expect(left.toString()).toBe('{"a":{"a":1,"z":2},"z":[{"a":100,"b":0}]}')
    expect(encodeVaultJson({ z: [1, 2] })).not.toEqual(encodeVaultJson({ z: [2, 1] }))
  })
  it('erases derived and partially filled random buffers when nonce RNG throws', async () => {
    const key = randomVaultBytes()
    await withRngFailure(key, 12, () => {
      expect(() =>
        sealVaultBlock(
          key,
          { vaultId: 'a'.repeat(32), id: 'index', kind: 'index', generation: 1 },
          key,
        ),
      ).toThrow('generated RNG failure')
    })
  })
  it('roundtrips every private material kind with owned bytes and no prototype-shaped field', () => {
    const materials: VaultItem['material'][] = [
      { kind: 'apiKey', value: randomVaultBytes(), auth: 'bearer', origin: 'https://example.com' },
      {
        kind: 'oauth',
        accessToken: randomVaultBytes(),
        refreshToken: randomVaultBytes(),
        issuer: 'https://example.com/issuer',
        resource: 'https://example.com/api',
        expiresAt: 1,
      },
      { kind: 'sshKey', storage: 'software', privateKey: randomVaultBytes(), algorithm: 'ed25519' },
      {
        kind: 'sshKey',
        storage: 'hardware',
        keyReference: 'test-reference',
        algorithm: 'ecdsa-p256',
      },
      { kind: 'password', username: null, password: randomVaultBytes() },
      { kind: 'totp', seed: randomVaultBytes(), algorithm: 'sha256', digits: 6, periodSeconds: 30 },
      { kind: 'session', cookies: randomVaultBytes(), origin: 'https://example.com', expiresAt: 1 },
      { kind: 'devicePair', value: randomVaultBytes() },
      { kind: 'internal', value: randomVaultBytes() },
    ]
    for (const material of materials)
      expect(decodeVaultMaterial(encodeVaultMaterial(material))).toEqual(material)
    const header = Buffer.from('{"kind":"secret","value":{"bytes":0},"__proto__":null}')
    const encoded = Buffer.alloc(4 + header.length + 4 + 1)
    encoded.writeUInt32BE(header.length)
    encoded.set(header, 4)
    encoded.writeUInt32BE(1, 4 + header.length)
    expect(() => decodeVaultMaterial(encoded)).toThrow()
  })
  it('matches NIST GCM AES-256 zero-key / 128-bit plaintext vector in both directions', () => {
    const key = Buffer.alloc(32)
    const nonce = Buffer.alloc(12)
    const plaintext = Buffer.alloc(16)
    const sealed = aesGcmSeal(key, nonce, plaintext, Buffer.alloc(0))
    expect(sealed.ciphertext.toString('hex')).toBe('cea7403d4d606b6e074ec5d3baf39d18')
    expect(sealed.tag.toString('hex')).toBe('d0d1c8a799996bf0265b98b5d48ab919')
    expect(aesGcmOpen(key, nonce, sealed.ciphertext, sealed.tag, Buffer.alloc(0))).toEqual(
      plaintext,
    )
  })
  it('matches RFC 5869 SHA-256 test case 1', () => {
    const result = hkdfSha256(
      Buffer.alloc(22, 0x0b),
      Buffer.from('000102030405060708090a0b0c', 'hex'),
      Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'),
      42,
    )
    expect(result.toString('hex')).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    )
    expect(result.buffer.byteLength).toBe(result.length)
  })
  it('matches RFC 4231 HMAC-SHA256 test case 1', () => {
    expect(vaultHmacSha256(Buffer.alloc(20, 0x0b), Buffer.from('Hi There')).toString('hex')).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
  })
  it('rejects altered GCM additional data independently of key derivation', () => {
    const key = randomVaultBytes()
    const nonce = randomVaultBytes(12)
    const aad = Buffer.from('identity')
    const sealed = aesGcmSeal(key, nonce, key, aad)
    expect(aesGcmOpen(key, nonce, sealed.ciphertext, sealed.tag, aad)).toEqual(key)
    expect(() =>
      aesGcmOpen(key, nonce, sealed.ciphertext, sealed.tag, Buffer.from('different')),
    ).toThrow()
  })
  it('binds every context field and rejects tampering before material is returned', () => {
    const key = randomVaultBytes()
    const context = { vaultId: 'a'.repeat(32), id: 'b'.repeat(32), kind: 'secret', generation: 1 }
    const plaintext = randomVaultBytes()
    const block = sealVaultBlock(key, context, plaintext)
    expect(openVaultBlock(key, context, block)).toEqual(plaintext)
    expect(
      openVaultBlock(
        key,
        {
          kind: context.kind,
          generation: context.generation,
          id: context.id,
          vaultId: context.vaultId,
        },
        block,
      ),
    ).toEqual(plaintext)
    expect(() => openVaultBlock(key, context, { ...block, generation: 2 })).toThrow()
    for (const changed of [
      { vaultId: 'c'.repeat(32) },
      { id: 'c'.repeat(32) },
      { kind: 'password' },
      { generation: 2 },
    ])
      expect(() => openVaultBlock(key, { ...context, ...changed }, block)).toThrow()
    for (const field of ['nonce', 'tag', 'ciphertext'] as const) {
      const value = Buffer.from(block[field], 'base64')
      value[0] = (value[0] ?? 0) ^ 1
      expect(() =>
        openVaultBlock(key, context, { ...block, [field]: value.toString('base64') }),
      ).toThrow()
    }
    expect(() => openVaultBlock(randomVaultBytes(), context, block)).toThrow()
  })
  it('generates fresh 96-bit nonces on repeated encryption and separates generations', () => {
    const key = randomVaultBytes()
    const context = { vaultId: 'a'.repeat(32), id: 'b'.repeat(32), kind: 'secret', generation: 1 }
    const blocks = Array.from({ length: 100 }, () => sealVaultBlock(key, context, key))
    expect(new Set(blocks.map((block) => block.nonce)).size).toBe(blocks.length)
    for (const block of blocks) expect(Buffer.from(block.nonce, 'base64').length).toBe(12)
    expect(sealVaultBlock(key, { ...context, generation: 2 }, key).ciphertext).not.toBe(
      blocks[0]?.ciphertext,
    )
  })
  it('checks exact primitive lengths, canonical base64 and constant-time equality semantics', () => {
    expect(() =>
      aesGcmSeal(Buffer.alloc(16), Buffer.alloc(12), Buffer.alloc(1), Buffer.alloc(0)),
    ).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(() =>
      aesGcmOpen(
        Buffer.alloc(32),
        Buffer.alloc(11),
        Buffer.alloc(1),
        Buffer.alloc(16),
        Buffer.alloc(0),
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(() =>
      aesGcmOpen(
        Buffer.alloc(32),
        Buffer.alloc(12),
        Buffer.alloc(1),
        Buffer.alloc(15),
        Buffer.alloc(0),
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid' }))
    for (const invalid of ['', 'Zg', 'Zh==', 'Zg====', ' Zg==', 'Zg==\n'])
      expect(() => decodeVaultBytes(invalid)).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(() => decodeVaultBytes('Zg==', 2)).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(areVaultBytesEqual(Buffer.from('a'), Buffer.from('a'))).toBe(true)
    expect(areVaultBytesEqual(Buffer.from('a'), Buffer.from('b'))).toBe(false)
    expect(areVaultBytesEqual(Buffer.from('a'), Buffer.from('aa'))).toBe(false)
  })
  it('encodes raw private material, returns independent unpooled buffers, and erases every byte field', () => {
    const original = item()
    const encoded = encodeVaultMaterial(original.material)
    expect(encoded.includes(Buffer.from(original.material.kind))).toBe(true)
    if (original.material.kind !== 'secret') throw new Error('fixture kind')
    expect(encoded.includes(Buffer.from(original.material.value))).toBe(true)
    expect(
      encoded.includes(Buffer.from(Buffer.from(original.material.value).toString('base64'))),
    ).toBe(false)
    const decoded = decodeVaultMaterial(encoded)
    expect(decoded).toEqual(original.material)
    if (decoded.kind !== 'secret' || !Buffer.isBuffer(decoded.value))
      throw new Error('decoded kind')
    expect(decoded.value.buffer.byteLength).toBe(decoded.value.byteLength)
    decoded.value.fill(0)
    expect(original.material.value.some((byte) => byte !== 0)).toBe(true)
    const multi = {
      kind: 'webLogin',
      origins: ['https://example.com'],
      username: randomVaultBytes(),
      password: randomVaultBytes(),
      totpSeed: randomVaultBytes(),
    } as const
    const roundtrip = decodeVaultMaterial(
      encodeVaultMaterial({ ...multi, origins: [...multi.origins] }),
    )
    eraseVaultMaterial(roundtrip)
    for (const field of Object.values(roundtrip))
      if (field instanceof Uint8Array) expect(field.every((byte) => byte === 0)).toBe(true)
    expect(() => decodeVaultMaterial(encoded.subarray(0, -1))).toThrow()
    expect(() => decodeVaultMaterial(Buffer.alloc(3))).toThrow()
    const copy = ownedBytes(original.material.value)
    expect(copy.buffer.byteLength).toBe(copy.length)
  })
  it('refuses malformed descriptors, duplicate byte references and trailing data', () => {
    const raw = encodeVaultMaterial({
      kind: 'password',
      username: randomVaultBytes(),
      password: randomVaultBytes(),
    })
    const headerSize = raw.readUInt32BE()
    const descriptor = raw.subarray(4, 4 + headerSize).toString('utf8')
    const changed = descriptor.replace('"bytes":1', '"bytes":0')
    raw.write(changed, 4)
    expect(() => decodeVaultMaterial(raw)).toThrow()
    const login = encodeVaultMaterial({
      kind: 'webLogin',
      origins: ['https://example.com'],
      username: randomVaultBytes(),
      password: randomVaultBytes(),
      totpSeed: randomVaultBytes(),
    })
    const header = login.toString('utf8', 4, 4 + login.readUInt32BE())
    const repeated = header
      .replace('"password":{"bytes":1}', '"password":{"bytes":0}')
      .replace('"totpSeed":{"bytes":2}', '"totpSeed":{"bytes":1}')
    login.write(repeated, 4)
    expect(() => decodeVaultMaterial(login.subarray(0, -36))).toThrow()
    const valid = encodeVaultMaterial({ kind: 'secret', value: randomVaultBytes() })
    expect(() => decodeVaultMaterial(Buffer.concat([valid, Buffer.alloc(4)]))).toThrow()
    const trailer = Buffer.alloc(5)
    trailer.writeUInt32BE(1)
    trailer[4] = 1
    expect(() => decodeVaultMaterial(Buffer.concat([valid, trailer]))).toThrow()
    valid.writeUInt32BE(0xff_ff_ff_ff)
    expect(() => decodeVaultMaterial(valid)).toThrow()
  })
})
