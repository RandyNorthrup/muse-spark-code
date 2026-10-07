// M101 lane P1 (PLAN.md D81, BYO items 1, 3, 13): the shared codec hygiene
// helpers. Every test below fails without its helper (the red drill
// renames `nativeCallId` to the identity and restores it; see
// docs/certification/m101-p1.md).
import { describe, expect, it } from 'vitest'

import {
  cleanJsonStrings,
  cleanWireText,
  isBlankWireText,
  isRecord,
  nativeCallId,
} from '../../src/core/backends/modelapi/codecs/shared'

describe('cleanWireText (BYO 13)', () => {
  it('replaces a lone lead or trail surrogate with U+FFFD', () => {
    expect(cleanWireText('a\u{D800}b')).toBe('a�b')
    expect(cleanWireText('a\u{DC00}b')).toBe('a�b')
    expect(cleanWireText('\u{D800}')).toBe('�')
  })

  it('keeps valid pairs, empty text and plain ASCII byte-identical', () => {
    expect(cleanWireText('')).toBe('')
    expect(cleanWireText('hello UTC')).toBe('hello UTC')
    expect(cleanWireText('a\u{1F600}b')).toBe('a\u{1F600}b')
  })
})

describe('isBlankWireText (BYO 1)', () => {
  it('treats empty and whitespace-only text as blank', () => {
    expect(isBlankWireText('')).toBe(true)
    expect(isBlankWireText(' '.repeat(3))).toBe(true)
    expect(isBlankWireText(' ')).toBe(true)
  })

  it('keeps text with visible characters', () => {
    expect(isBlankWireText('hi')).toBe(false)
    expect(isBlankWireText('  hi  ')).toBe(false)
  })
})

describe('cleanJsonStrings (BYO 13)', () => {
  it('preserves own __proto__ keys at every depth without creating inherited payload fields', () => {
    const cleaned = cleanJsonStrings(
      JSON.parse(
        String.raw`{"__proto__":{"name":"a\ud800b"},"normal":"ok","nested":[{"__proto__":{"value":"x\udc00"}}]}`,
      ),
    )
    if (!isRecord(cleaned)) throw new TypeError('expected a cleaned object')
    expect(Object.hasOwn(cleaned, '__proto__')).toBe(true)
    expect(Object.keys(cleaned)).toEqual(['__proto__', 'normal', 'nested'])
    expect(cleaned['name']).toBeUndefined()
    expect(JSON.stringify(cleaned)).toBe(
      '{"__proto__":{"name":"a�b"},"normal":"ok","nested":[{"__proto__":{"value":"x�"}}]}',
    )
  })

  it('cleans nested string values and keeps the shape', () => {
    expect(
      cleanJsonStrings({ path: 'a\u{D800}b', nested: { list: ['x\u{DC00}', 1, null] } }),
    ).toEqual({
      path: 'a�b',
      nested: { list: ['x�', 1, null] },
    })
  })

  it('passes scalars and clean payloads through', () => {
    expect(cleanJsonStrings(42)).toBe(42)
    expect(cleanJsonStrings('ok')).toBe('ok')
    expect(cleanJsonStrings(null)).toBe(null)
  })
})

describe('nativeCallId (BYO 3)', () => {
  it('keeps compliant ids byte-identical on every format', () => {
    expect(nativeCallId('toolu_01r', 'anthropic')).toBe('toolu_01r')
    expect(nativeCallId('rolling-call', 'anthropic')).toBe('rolling-call')
    expect(nativeCallId('chatcmpl-tool-b14640ae3beaf9d7', 'chat')).toBe(
      'chatcmpl-tool-b14640ae3beaf9d7',
    )
    expect(nativeCallId('call-1', 'chat')).toBe('call-1')
    expect(nativeCallId('TFgpitTpa', 'mistral')).toBe('TFgpitTpa')
    expect(nativeCallId('image0001', 'mistral')).toBe('image0001')
  })

  it('rewrites an Anthropic-hostile id into the accepted charset', () => {
    const mapped = nativeCallId('call:1/abc def', 'anthropic')
    expect(mapped).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(mapped).not.toBe('call:1/abc def')
  })

  it('keeps a captured 41-character server id and rewrites only pathological ones', () => {
    const captured = 'call_01a10910-a000-7d83-9b27-efc1bb3e764b'
    expect(captured.length).toBe(41)
    expect(nativeCallId(captured, 'chat')).toBe(captured)
    const long = `chat-call-4c7dca83f54445e19b3e16281105748c-0-${'x'.repeat(60)}`
    expect(long.length).toBeGreaterThan(64)
    const mapped = nativeCallId(long, 'chat')
    expect(mapped.length).toBeLessThanOrEqual(64)
    expect(mapped).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rewrites a Mistral-hostile id into exactly 9 alphanumerics', () => {
    for (const raw of ['image-1', 'time-1', 'fc_1', '']) {
      const mapped = nativeCallId(raw, 'mistral')
      expect(mapped).toMatch(/^[A-Za-z0-9]{9}$/)
    }
  })

  it('is deterministic and keeps distinct calls distinct', () => {
    expect(nativeCallId('image-1', 'mistral')).toBe(nativeCallId('image-1', 'mistral'))
    expect(nativeCallId('image-1', 'mistral')).not.toBe(nativeCallId('image-2', 'mistral'))
    expect(nativeCallId('a b', 'chat')).toBe(nativeCallId('a b', 'chat'))
    expect(nativeCallId('a b', 'anthropic')).not.toBe(nativeCallId('a  b', 'anthropic'))
  })
})
