import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VaultScrubber, VaultScrubService } from '../../../src/core/vault/scrub'
import { scrubSecrets } from '../../../src/shared/redact'
import { REDACTED_MARK, VAULT_SCRUB_MIN_MBPS, VAULT_LIMITS } from '../../../src/shared/constants'

function generated() {
  return String.raw`v:${randomBytes(32).toString('base64')}:"\é`
}

function printableForms(value: string): string[] {
  const bytes = Buffer.from(value)
  try {
    return [
      value,
      JSON.stringify(value).slice(1, -1),
      encodeURIComponent(value),
      encodeURIComponent(value).replaceAll(/%[A-F\d]{2}/g, (part) => part.toLowerCase()),
      bytes.toString('base64'),
      bytes.toString('base64url'),
      bytes.toString('hex'),
      bytes.toString('hex').toUpperCase(),
    ]
  } finally {
    bytes.fill(0)
  }
}

describe('vault scrub', () => {
  it('catches literal, JSON, percent and hex forms without altering unrelated text', () => {
    const value = generated(),
      bytes = Buffer.from(value),
      scrub = new VaultScrubber([bytes])
    try {
      const forms = printableForms(value)
      for (const form of forms)
        expect(scrub.scrub(`before ${form} after`)).toBe(`before ${REDACTED_MARK} after`)
      expect(scrub.scrub('ordinary output\nwith lines')).toBe('ordinary output\nwith lines')
      expect(bytes.toString()).toBe(value)
    } finally {
      bytes.fill(0)
      scrub.dispose()
    }
  })
  it('catches base64 and base64url embedded at all three byte alignments', () => {
    const value = randomBytes(32),
      scrub = new VaultScrubber([value])
    try {
      for (const offset of [0, 1, 2]) {
        const prefix = randomBytes(offset),
          suffix = randomBytes(32)
        for (const encoding of ['base64', 'base64url'] as const) {
          const encoded = Buffer.concat([prefix, value, suffix]).toString(encoding)
          expect(scrub.scrub(encoded)).toContain(REDACTED_MARK)
        }
      }
    } finally {
      value.fill(0)
      scrub.dispose()
    }
  })
  it('scrubs overlapping values, suffix matches and Unicode', () => {
    const value = generated(),
      scrub = new VaultScrubber([Buffer.from(value), Buffer.from(value.slice(2))])
    try {
      expect(scrub.scrub(`🦄${value}🦄`)).toBe(`🦄${REDACTED_MARK}🦄`)
    } finally {
      scrub.dispose()
    }
  })
  it('catches every split write, line break and ANSI run without emitting a secret prefix', () => {
    const value = generated(),
      bytes = Buffer.from(value),
      scrub = new VaultScrubber([bytes])
    try {
      const forms = printableForms(value)
      for (const form of forms) {
        for (let at = 1; at < form.length; at += 1) {
          const stream = scrub.stream()
          const first = stream.push(`prefix ${form.slice(0, at)}\u{1B}[3`)
          expect(first).not.toContain(form.slice(0, at))
          const result =
            first + stream.push(`1m\n${form.slice(at)}\u{1B}[0m suffix`) + stream.finish()
          expect(result).toBe(`prefix ${REDACTED_MARK}\u{1B}[0m suffix`)
        }
      }
    } finally {
      bytes.fill(0)
      scrub.dispose()
    }
  })
  it('documents unknown encodings and one character per command as residuals', () => {
    const value = generated(),
      scrub = new VaultScrubber([Buffer.from(value)])
    try {
      const xor = Buffer.from(Buffer.from(value).map((byte) => byte ^ 100)).toString('hex')
      expect(scrub.scrub(xor)).toBe(xor)
      expect(Array.from(value, (char) => scrub.scrub(char)).join('')).toBe(value)
    } finally {
      scrub.dispose()
    }
  })
  it('retains an incomplete ANSI sequence until its terminator arrives', () => {
    const value = generated(),
      scrub = new VaultScrubber([Buffer.from(value)]),
      stream = scrub.stream()
    const decoration = `\u{1B}]${'title-'.repeat(100)}`
    try {
      const first = stream.push(`safe ${decoration}`)
      expect(first).toBe('safe ')
      expect(first + stream.push(`\u{7} ${value} after`) + stream.finish()).toBe(
        `safe ${decoration}\u{7} ${REDACTED_MARK} after`,
      )
    } finally {
      stream.dispose()
      scrub.dispose()
    }
  })
  it('locks immediately, wipes transferred values and cannot install a late build', async () => {
    const value = Buffer.from(generated()),
      service = new VaultScrubService()
    const pending = Promise.withResolvers<readonly Uint8Array[]>()
    const late = service.unlock(() => pending.promise)
    await Promise.resolve()
    service.lock()
    pending.resolve([value])
    await expect(late).rejects.toThrow('Obsolete')
    expect(value.every((byte) => byte === 0)).toBe(true)
    await expect(service.scrub('text')).rejects.toThrow('unavailable')
    const fresh = Buffer.from(generated()),
      text = fresh.toString()
    await service.unlock(() => Promise.resolve([fresh]))
    expect(fresh.every((byte) => byte === 0)).toBe(true)
    expect(await scrubSecrets(text, service)).toBe(REDACTED_MARK)
    service.lock()
    await expect(scrubSecrets(text, service)).rejects.toThrow('unavailable')
  })
  it('refuses disposed streams and retains no trie after disposal', () => {
    const scrub = new VaultScrubber([Buffer.from(generated())]),
      stream = scrub.stream()
    stream.dispose()
    expect(() => stream.push('output')).toThrow('closed')
    scrub.dispose()
    expect(() => scrub.scrub('output')).toThrow('disposed')
  })
  it('refuses decoration-only values instead of claiming a safe empty match', async () => {
    const bytes = Buffer.from('\n'),
      service = new VaultScrubService()
    expect(() => new VaultScrubber([bytes])).toThrow('no matchable text')
    await expect(service.unlock(() => Promise.resolve([bytes]))).rejects.toThrow(
      'no matchable text',
    )
    expect(bytes.every((byte) => byte === 0)).toBe(true)
    await expect(service.scrub('text')).rejects.toThrow('unavailable')
  })
  it('bounds streaming suffix memory and closes an over-limit stream without output', () => {
    const scrub = new VaultScrubber([Buffer.from(generated())]),
      stream = scrub.stream()
    try {
      expect(() => stream.push('\n'.repeat(VAULT_LIMITS.frameBytes + 1))).toThrow('buffer limit')
      expect(() => stream.finish()).toThrow('closed')
    } finally {
      stream.dispose()
      scrub.dispose()
    }
  })
  it('measures the 1,000-value throughput floor', () => {
    const values = Array.from({ length: 1000 }, () => Buffer.from(generated()))
    const scrub = new VaultScrubber(values)
    const text = 'ordinary compiler output with no matching value\n'.repeat(100_000)
    try {
      scrub.scrub(text)
      const start = performance.now()
      expect(scrub.scrub(text)).toBe(text)
      const mbps = Buffer.byteLength(text) / ((performance.now() - start) * 1000)
      expect(mbps).toBeGreaterThanOrEqual(VAULT_SCRUB_MIN_MBPS)
    } finally {
      for (const value of values) value.fill(0)
      scrub.dispose()
    }
  })
})
