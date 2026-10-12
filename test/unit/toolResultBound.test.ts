// TOOLCAP: unit tests for the one bound every tool result passes through.
import { describe, expect, it } from 'vitest'
import { OBS_PACK_CHARS_PER_TOKEN } from '../../src/shared/constants'
import {
  boundToolResultText,
  cutNotice,
  parsePromptTooLong,
  spillName,
  validateToolResultCap,
  windowShareChars,
} from '../../src/core/backends/modelapi/toolResultBound'

const LIMITS = { maxTokens: 16_000, maxLineChars: 8000, maxBytes: 64_000, windowTokens: undefined }

describe('boundToolResultText', () => {
  it('returns small results byte-identical, with no cut', () => {
    const text = 'line one\nline two\n'
    const bounded = boundToolResultText(text, LIMITS)
    expect(bounded.cut).toBeUndefined()
    expect(bounded.text).toBe(text)
  })

  it('cuts an oversized total to head and tail, counting the omitted middle', () => {
    const text = `${'h'.repeat(40_000)}\n${'t'.repeat(40_000)}`
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.cut.totalChars).toBe(text.length)
    expect(bounded.cut.totalTokens).toBe(Math.ceil(text.length / OBS_PACK_CHARS_PER_TOKEN))
    expect(bounded.cut.totalLines).toBe(2)
    expect(bounded.cut.omittedChars).toBeGreaterThan(0)
    expect(bounded.cut.keptChars).toBe(bounded.text.length)
    expect(bounded.text.startsWith('h'.repeat(100))).toBe(true)
    expect(bounded.text.endsWith('t'.repeat(100))).toBe(true)
    expect(bounded.text).not.toContain('h'.repeat(40_000))
  })

  it('cuts long lines even when the total fits, naming the longest', () => {
    const text = ['a'.repeat(20_000), 'short', 'b'.repeat(9000)].join('\n')
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.cut.longestLine).toBe(20_000)
    expect(bounded.cut.lineCap).toBe(8000)
    for (const line of bounded.text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(8000)
    }
    expect(bounded.text).toContain('short')
  })

  it('never splits a surrogate pair at a cut edge', () => {
    const text = `${'😀'.repeat(20_000)}\n${'😀'.repeat(20_000)}`
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(() => encodeURIComponent(bounded.text)).not.toThrow()
    expect(bounded.text).not.toMatch(/�/)
  })

  it('applies the window share: the same text is cut for a small room', () => {
    // 62,061 characters: under the token cap, over a 60k window's share.
    const text = Array.from({ length: 62 }, () => 'm'.repeat(1000)).join('\n')
    expect(boundToolResultText(text, LIMITS).cut).toBeUndefined()
    const small = boundToolResultText(text, { ...LIMITS, windowTokens: 60_000 })
    if (small.cut === undefined) throw new Error('expected a cut')
    // A quarter of 60k tokens at four characters each.
    expect(small.text.length).toBeLessThanOrEqual(60_000)
  })

  it('a result that cannot fit at all becomes the notice with an empty keep', () => {
    const bounded = boundToolResultText('0123456789'.repeat(100), { ...LIMITS, windowTokens: 0 })
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.cut.omittedChars).toBe(1000)
  })
})

describe('cutNotice', () => {
  it('says how much, which head and tail, the longest line, and how to read more', () => {
    const text = `${'h'.repeat(20_000)}\n${'t'.repeat(20_000)}`
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    const notice = cutNotice(bounded.cut, '.muse-spark/tool-results/s-c1.txt', 'c1')
    expect(notice).toContain('40001 characters')
    expect(notice).toContain('characters omitted in the middle')
    expect(notice).toContain('longest line 20000 characters, cut to 8000')
    expect(notice).toContain('.muse-spark/tool-results/s-c1.txt')
    expect(notice).toContain('recall_output id "c1"')
    expect(notice).toContain('read_file')
  })
})

describe('parsePromptTooLong', () => {
  it('types the exact Anthropic refusal with its numbers', () => {
    expect(parsePromptTooLong('prompt is too long: 1002881 tokens > 1000000 maximum')).toEqual({
      tokens: 1_002_881,
      maximum: 1_000_000,
    })
  })

  it('rejects anything else, so no cause is ever guessed', () => {
    expect(parsePromptTooLong('context_length_exceeded')).toBeUndefined()
    expect(parsePromptTooLong('prompt is too long')).toBeUndefined()
    expect(parsePromptTooLong('')).toBeUndefined()
  })
})

describe('validateToolResultCap', () => {
  it('keeps the default when unconfigured', () => {
    expect(validateToolResultCap(undefined, 1_000_000, 64_000)).toEqual({ bytes: 64_000 })
  })

  it('refuses below the readable floor', () => {
    const refused = validateToolResultCap(10, 1_000_000, 64_000)
    expect('refused' in refused && refused.fallback).toBe(64_000)
  })

  it('refuses a cap that could not fit the model window', () => {
    const refused = validateToolResultCap(10_000_000, 100_000, 64_000)
    expect('refused' in refused).toBe(true)
  })

  it('accepts a raised cap that fits', () => {
    expect(validateToolResultCap(128_000, 1_000_000, 64_000)).toEqual({ bytes: 128_000 })
  })
})

describe('windowShareChars and spillName', () => {
  it('shares a quarter of the room in characters', () => {
    expect(windowShareChars(100_000)).toBe(100_000)
  })

  it('names deterministic, separator-free spill files', () => {
    expect(spillName('sess/1', 'call:2')).toBe('sess_1-call_2.txt')
  })
})
