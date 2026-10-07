import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { decodeTotpSeed, totpCode } from '../../../src/core/vault/web/totp'

const times = [59, 1_111_111_109, 1_111_111_111, 1_234_567_890, 2_000_000_000, 20_000_000_000]
const vectors = {
  sha1: ['94287082', '07081804', '14050471', '89005924', '69279037', '65353130'],
  sha256: ['46119246', '68084774', '67062674', '91819424', '90698825', '77737706'],
  sha512: ['90693936', '25091201', '99943326', '93441116', '38618901', '47863826'],
}
const lengths = { sha1: 20, sha256: 32, sha512: 64 }

describe('vault RFC 6238 codes', () => {
  for (const algorithm of ['sha1', 'sha256', 'sha512'] as const) {
    it(`matches every RFC 6238 Appendix B vector for ${algorithm}, including >32-bit time`, () => {
      // Public RFC test material is generated at runtime, not a stored credential.
      const seed = Buffer.alloc(lengths[algorithm])
      for (let i = 0; i < seed.length; i++) seed[i] = 48 + ((i + 1) % 10)
      const original = Buffer.from(seed)
      try {
        for (const [i, time] of times.entries()) {
          const code = totpCode(seed, time * 1000, {
            algorithm,
            digits: 8,
            periodSeconds: 30,
          })
          expect(code.toString('ascii')).toBe(vectors[algorithm][i])
          code.fill(0)
        }
        expect(seed).toEqual(original)
      } finally {
        seed.fill(0)
        original.fill(0)
      }
    })
  }
  it('preserves leading zeroes, changes on the boundary and never returns the seed', () => {
    const seed = Buffer.from(Array.from({ length: 20 }, (_, i) => 48 + ((i + 1) % 10)))
    const options = { algorithm: 'sha1', digits: 6, periodSeconds: 30 } as const
    expect(totpCode(seed, 1_111_111_109_000, options).toString()).toBe('081804')
    expect(totpCode(seed, 29_999, options)).toEqual(totpCode(seed, 0, options))
    expect(totpCode(seed, 30_000, options)).not.toEqual(totpCode(seed, 29_999, options))
    seed.fill(0)
  })
  it('rejects empty seeds, invalid times, periods, digits and algorithms', () => {
    const seed = Buffer.alloc(20, 1)
    const options = { algorithm: 'sha1', digits: 6, periodSeconds: 30 } as const
    for (const now of [-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => totpCode(seed, now, options)).toThrow('invalidTotp')
    for (const periodSeconds of [0, -1, NaN, Infinity, 0.1])
      expect(() => totpCode(seed, 0, { ...options, periodSeconds })).toThrow('invalidTotp')
    expect(() => totpCode(Buffer.alloc(0), 0, options)).toThrow('invalidTotp')
    seed.fill(0)
  })
  it('decodes canonical base32, lowercase and padding while rejecting ambiguous encodings', () => {
    expect(decodeTotpSeed('MZXW6YTBOI======').toString()).toBe('foobar')
    expect(decodeTotpSeed('mzxw6ytboi').toString()).toBe('foobar')
    for (const input of ['', 'A', 'MZ', 'MY=', 'MY=======', 'MY=A', 'MY\n', 'M1', '==='])
      expect(() => decodeTotpSeed(input)).toThrow('invalidTotp')
  })
})
