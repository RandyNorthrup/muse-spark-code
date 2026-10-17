import { describe, expect, it } from 'vitest'
import {
  derivePassphraseKey,
  detectArgon2,
  newVaultKdf,
  scryptKey,
} from '../../../src/core/vault/kdf'
import { randomVaultBytes } from '../../../src/core/vault/crypto'
import { VAULT_KDF } from '../../../src/shared/constants'

describe('vault memory-hard KDF', () => {
  it('matches RFC 7914 scrypt test vector 1', async () => {
    const key = await scryptKey(Buffer.alloc(0), Buffer.alloc(0), { N: 16, r: 1, p: 1 }, 64)
    expect(key.toString('hex')).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    )
    expect(key.buffer.byteLength).toBe(key.length)
  })
  it('matches RFC 9106 Argon2id vector on capable Node and detects older hosts', async () => {
    expect(detectArgon2({})).toBeUndefined()
    expect(detectArgon2({ argon2: true })).toBeUndefined()
    const native = detectArgon2()
    if (!native) {
      expect(newVaultKdf(null).kind).toBe('scrypt')
      return
    }
    const key = await native({
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      memory: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
    })
    expect(key.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    )
  })
  it('pins production parameters, uses fresh salts and preserves input ownership', async () => {
    const password = randomVaultBytes()
    const original = Buffer.from(password)
    const scrypt = newVaultKdf(null)
    expect(scrypt).toMatchObject({ kind: 'scrypt', ...VAULT_KDF.scrypt })
    expect(Buffer.from(scrypt.salt, 'base64').length).toBe(16)
    expect(newVaultKdf(null).salt).not.toBe(scrypt.salt)
    const first = await derivePassphraseKey(password, scrypt, null)
    const second = await derivePassphraseKey(password, scrypt, null)
    expect(first).toEqual(second)
    expect(first.length).toBe(32)
    expect(first.buffer.byteLength).toBe(32)
    expect(password).toEqual(original)
    first.fill(0)
    expect(second.some((value) => value !== 0)).toBe(true)
  })
  it('refuses a weak KDF, malformed salt, empty passphrase and unavailable Argon2 without fallback', async () => {
    const password = randomVaultBytes()
    const record = newVaultKdf(null)
    if (record.kind !== 'scrypt') throw new Error('scrypt record')
    const weak = structuredClone(record)
    Reflect.set(weak, 'N', 16)
    await expect(derivePassphraseKey(password, weak, null)).rejects.toThrow()
    await expect(derivePassphraseKey(password, { ...record, salt: 'AAAA' }, null)).rejects.toThrow()
    await expect(derivePassphraseKey(Buffer.alloc(0), record, null)).rejects.toThrow()
    const argon = { kind: 'argon2id', salt: record.salt, ...VAULT_KDF.argon2 } as const
    await expect(derivePassphraseKey(password, argon, null)).rejects.toThrow()
  })
  it('erases owned Argon2 input even on rejection and rejects invalid implementation output', async () => {
    const record = newVaultKdf(() => Promise.resolve(Buffer.alloc(32)))
    let held: Uint8Array | undefined
    await expect(
      derivePassphraseKey(randomVaultBytes(), record, (options) => {
        held = options.message
        return Promise.reject(new Error('generated failure'))
      }),
    ).rejects.toThrow()
    expect(held?.every((value) => value === 0)).toBe(true)
    const short = Buffer.alloc(1, 1)
    await expect(
      derivePassphraseKey(randomVaultBytes(), record, () => Promise.resolve(short)),
    ).rejects.toThrow()
    expect(short[0]).toBe(0)
    const adapter = detectArgon2({
      argon2: (
        _algorithm: unknown,
        _parameters: unknown,
        callback: (error: unknown, result: unknown) => void,
      ) => {
        callback(null, Buffer.alloc(1, 1))
      },
    })
    if (!adapter) throw new Error('adapter')
    await expect(
      adapter({
        message: Buffer.alloc(1),
        nonce: Buffer.alloc(16),
        memory: 32,
        passes: 3,
        parallelism: 4,
        tagLength: 32,
      }),
    ).rejects.toThrow()
  })
})
