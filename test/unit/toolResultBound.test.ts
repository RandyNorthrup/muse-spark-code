// TOOLCAP: pure-logic tests through the real bound module: the byte
// guarantee, the true notice arithmetic, the cap validation, and the
// recogniser on the recorded provider answer. No stand-ins: values in,
// values out.
import { describe, expect, it } from 'vitest'
import {
  MODEL_API_MODEL_TEXT,
  OBS_PACK_CHARS_PER_TOKEN,
  TOOL_RESULT_SPILL_MAX_AGE_DAYS,
  UI_TEXT,
} from '../../src/shared/constants'
import {
  boundToolResultText,
  callOutputItem,
  capRefusalReason,
  cutNotice,
  fixedHarnessText,
  canRecoverOverflow,
  limitsForByteGuard,
  parsePromptTooLong,
  toolNoteItem,
  utf8Length,
  validateToolResultCap,
  windowShareBytes,
  withCutNotice,
} from '../../src/core/backends/modelapi/toolResultBound'
import { restoredToolText } from '../../src/core/backends/modelapi/schemas'
import {
  isSpillFile,
  spillName,
  spillPrefix,
  isSpillStale,
} from '../../src/core/backends/modelapi/sessionStore'

const LIMITS = { maxTokens: 16_000, maxLineChars: 8000, maxBytes: 64_000, windowTokens: undefined }

/**
Every cut's kept and omitted add up to the total, and `keptChars` counts
ORIGINAL characters carried in the kept text: the `…` markers the cut
itself added are not original characters. These inputs contain no `…`,
so every one in the kept text is a marker, counted here independently.
*/
function expectSums(
  text: string,
  limits: typeof LIMITS,
): Exclude<ReturnType<typeof boundToolResultText>['cut'], undefined> {
  const bounded = boundToolResultText(text, limits)
  if (bounded.cut === undefined) throw new Error('expected a cut')
  expect(text).not.toContain('…')
  const markers = bounded.text.split('…').length - 1
  expect(bounded.cut.keptChars).toBe(bounded.text.length - markers)
  expect(bounded.cut.keptChars + bounded.cut.omittedChars).toBe(text.length)
  expect(bounded.cut.keptBytes).toBe(utf8Length(bounded.text))
  return bounded.cut
}

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
    expect(bounded.cut.keptChars + bounded.cut.omittedChars).toBe(text.length)
    expect(bounded.cut.keptChars).toBeLessThanOrEqual(bounded.text.length)
    expect(bounded.text.startsWith('h'.repeat(100))).toBe(true)
    expect(bounded.text.endsWith('t'.repeat(100))).toBe(true)
    expect(bounded.text).not.toContain('h'.repeat(40_000))
  })

  it('kept and omitted sum to the total for one enormous line', () => {
    const cut = expectSums('x'.repeat(200_000), LIMITS)
    expect(cut.totalLines).toBe(1)
    expect(cut.headLines).toBe(1)
    expect(cut.tailLines).toBe(0)
    expect(cut.longestLine).toBe(200_000)
  })

  it('kept and omitted sum to the total for many short lines', () => {
    const text = Array.from({ length: 20_000 }, (_, index) => `line ${String(index)}`).join('\n')
    const cut = expectSums(text, LIMITS)
    expect(cut.totalLines).toBe(20_000)
    // The head and tail parts hold real lines: every kept line is counted.
    expect(cut.headLines).toBeGreaterThan(0)
    expect(cut.tailLines).toBeGreaterThan(0)
    expect(cut.longestLine).toBe(0)
  })

  it('kept and omitted sum to the total for a cut inside a surrogate pair', () => {
    const text = `${'😀'.repeat(20_000)}\n${'😀'.repeat(20_000)}`
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.cut.keptChars + bounded.cut.omittedChars).toBe(text.length)
    expect(() => encodeURIComponent(bounded.text)).not.toThrow()
    expect(bounded.text).not.toMatch(/�/)
  })

  it('kept and omitted sum to the total for CRLF text', () => {
    const text = `${'h'.repeat(40_000)}\r\n${'t'.repeat(40_000)}\r\n`
    const cut = expectSums(text, LIMITS)
    expect(cut.totalLines).toBe(2)
    expect(hasNoCarriageReturn(text, LIMITS)).toBe(true)
  })

  it('cuts long lines even when the total fits, naming the longest', () => {
    const text = ['a'.repeat(20_000), 'short', 'b'.repeat(9000)].join('\n')
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.cut.longestLine).toBe(20_000)
    expect(bounded.cut.lineCap).toBe(8000)
    expect(bounded.cut.keptChars + bounded.cut.omittedChars).toBe(text.length)
    expect(bounded.cut.headLines).toBe(3)
    expect(bounded.cut.tailLines).toBe(0)
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

  it('the window share is a guarantee in bytes, not an estimate in characters', () => {
    // 62,061 ASCII characters: under the 16k-token estimate cap, over a 60k
    // window's byte share (15,000 bytes). Dense text must be cut the same.
    const thin = Array.from({ length: 62 }, () => 'm'.repeat(1000)).join('\n')
    expect(boundToolResultText(thin, LIMITS).cut).toBeUndefined()
    const small = boundToolResultText(thin, { ...LIMITS, windowTokens: 60_000 })
    if (small.cut === undefined) throw new Error('expected a cut')
    expect(utf8Length(small.text)).toBeLessThanOrEqual(windowShareBytes(60_000))
    expect(windowShareBytes(60_000)).toBe(15_000)
    // CJK text: 20,000 characters are 60,000 bytes, three tokens per char
    // under no honest rule — the character estimate alone would keep it.
    const dense = 'あ'.repeat(20_000)
    expect(dense.length).toBeLessThanOrEqual(16_000 * OBS_PACK_CHARS_PER_TOKEN)
    const denseCut = boundToolResultText(dense, { ...LIMITS, windowTokens: 60_000 })
    if (denseCut.cut === undefined) throw new Error('expected a cut')
    expect(utf8Length(denseCut.text)).toBeLessThanOrEqual(windowShareBytes(60_000))
  })

  it('a middle cut inside one line keeps no whole line, and says so', () => {
    // One line, line-capped to 8,000 then middle-cut by the byte guard: the
    // kept head and tail are fragments of the same line, never two lines.
    const cut = expectSums('x'.repeat(20_000), { ...LIMITS, maxBytes: 2000 })
    expect(cut.totalLines).toBe(1)
    expect(cut.headLines).toBe(0)
    expect(cut.tailLines).toBe(0)
    expect(cut.headLines + cut.tailLines).toBeLessThanOrEqual(cut.totalLines)
  })

  it('keptChars counts original characters, not the line-cut marker', () => {
    // One line cut to the 8,000 cap: 7,999 original characters plus the
    // one-character marker. The notice must not count the marker as kept.
    const bounded = boundToolResultText('x'.repeat(200_000), LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.text.length).toBe(8000)
    expect(bounded.cut.keptChars).toBe(7999)
    expect(bounded.cut.omittedChars).toBe(200_000 - 7999)
  })

  it('a middle cut marks where the kept head meets the kept tail', () => {
    // Without a mark, the head's last fragment and the tail's first would
    // read as one continuous line the tool never printed.
    const text = Array.from({ length: 2000 }, () => 'm'.repeat(49)).join('\n')
    const bounded = boundToolResultText(text, { ...LIMITS, maxBytes: 2000 })
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.text).toContain('…')
    expect(utf8Length(bounded.text)).toBeLessThanOrEqual(2000)
  })

  it('a result that cannot fit at all becomes the notice with an empty keep', () => {
    const bounded = boundToolResultText('0123456789'.repeat(100), { ...LIMITS, windowTokens: 0 })
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.cut.omittedChars).toBe(1000)
    expect(bounded.text).toBe('')
    expect(bounded.cut.headLines).toBe(0)
    expect(bounded.cut.tailLines).toBe(0)
  })
})

/** A CRLF cut keeps no carriage return the notice did not count. */
function hasNoCarriageReturn(text: string, limits: typeof LIMITS): boolean {
  const bounded = boundToolResultText(text, limits)
  return !bounded.text.includes('\r')
}

describe('cutNotice', () => {
  it('says how much, which head and tail, the longest line, and how to read more', () => {
    const text = `${'h'.repeat(20_000)}\n${'t'.repeat(20_000)}`
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    const notice = cutNotice(bounded.cut, '.muse-spark/tool-results/s-c1.txt', 'c1')
    expect(notice).toContain('40001 characters')
    expect(notice).toContain('characters omitted)')
    expect(notice).toContain('longest line 20000 characters, cut to 8000')
    expect(notice).toContain('.muse-spark/tool-results/s-c1.txt')
    expect(notice).toContain('recall_output id "c1"')
    expect(notice).toContain('read_file')
  })

  it('an unkept spill names no file and says the full result is gone', () => {
    const text = `${'h'.repeat(20_000)}\n${'t'.repeat(20_000)}`
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    const notice = cutNotice(bounded.cut, undefined, 'c1')
    expect(notice).toContain('The full result could not be kept')
    expect(notice).not.toContain('Full result in')
    expect(notice).not.toContain('recall_output')
  })

  it('names the head and tail the cut actually kept', () => {
    const text = Array.from({ length: 20_000 }, (_, index) => `line ${String(index)}`).join('\n')
    const bounded = boundToolResultText(text, LIMITS)
    if (bounded.cut === undefined) throw new Error('expected a cut')
    const notice = cutNotice(bounded.cut, 'spill.txt', 'c9')
    expect(notice).toContain(
      `kept ${String(bounded.cut.keptChars)} characters from the start and end (${String(bounded.cut.headLines)} whole lines at the start, ${String(bounded.cut.tailLines)} at the end`,
    )
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

  it('refuses below the readable floor with its own translated sentence', () => {
    const refused = validateToolResultCap(10, 1_000_000, 64_000)
    if (!('refused' in refused)) throw new Error('expected a refusal')
    expect(refused.fallback).toBe(64_000)
    expect(refused.refused).toEqual({ kind: 'below-floor' })
    expect(capRefusalReason(refused.refused)).toContain('1,024')
  })

  it('refuses a cap that could not fit the model window, naming the window', () => {
    const refused = validateToolResultCap(10_000_000, 100_000, 64_000)
    if (!('refused' in refused)) throw new Error('expected a refusal')
    expect(refused.refused).toEqual({ kind: 'above-window', windowTokens: 100_000 })
    expect(capRefusalReason(refused.refused)).toContain('100')
  })

  it('accepts a raised cap that fits', () => {
    expect(validateToolResultCap(128_000, 1_000_000, 64_000)).toEqual({ bytes: 128_000 })
  })

  it('without a known window the bound is the per-result caps alone', () => {
    expect(validateToolResultCap(10_000_000, undefined, 64_000)).toEqual({ bytes: 10_000_000 })
  })
})

describe('limitsForByteGuard', () => {
  it('the default byte guard keeps the fixed token cap', () => {
    expect(limitsForByteGuard(64_000, undefined)).toEqual(LIMITS)
  })

  it('raising the byte guard raises what one result may keep', () => {
    // 100,000 characters in short lines: cut at the default guard, whole at
    // a raised one. A raised setting that changed nothing would fail here.
    const text = Array.from({ length: 2000 }, () => 'm'.repeat(49)).join('\n')
    expect(text.length).toBe(99_999)
    expect(boundToolResultText(text, limitsForByteGuard(64_000, undefined)).cut).not.toBeUndefined()
    const raised = boundToolResultText(text, limitsForByteGuard(128_000, undefined))
    expect(raised.cut).toBeUndefined()
    expect(raised.text).toBe(text)
  })

  it('the window share still binds a raised guard', () => {
    const text = Array.from({ length: 2000 }, () => 'm'.repeat(49)).join('\n')
    const bounded = boundToolResultText(text, limitsForByteGuard(128_000, 60_000))
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(utf8Length(bounded.text)).toBeLessThanOrEqual(windowShareBytes(60_000))
  })
})

describe('windowShareBytes, utf8Length and spillName', () => {
  it('shares a quarter of the room in bytes: at most N bytes is at most N tokens', () => {
    expect(windowShareBytes(100_000)).toBe(25_000)
    expect(windowShareBytes(0)).toBe(0)
  })

  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('あ')).toBe(3)
    expect(utf8Length('😀')).toBe(4)
  })

  it('names deterministic, separator-free spill files', () => {
    expect(spillName('sess/1', 'call:2')).toBe('sess_1-call_2.txt')
  })

  it('a session prefix names exactly its spills', () => {
    expect(spillPrefix('sess/1')).toBe('sess_1-')
    expect(spillName('sess/1', 'call:2').startsWith(spillPrefix('sess/1'))).toBe(true)
  })

  it('the age sweep only recognises spill-shaped files', () => {
    expect(isSpillFile('sess_1-call_2.txt')).toBe(true)
    expect(isSpillFile('notes.txt')).toBe(false)
    expect(isSpillFile('.gitignore')).toBe(false)
    expect(isSpillFile('sess_1-call_2.md')).toBe(false)
  })

  it('a spill past the age rule is stale; an unreadable clock is kept', () => {
    const day = 24 * 60 * 60 * 1000
    expect(TOOL_RESULT_SPILL_MAX_AGE_DAYS).toBe(30)
    expect(isSpillStale(0, TOOL_RESULT_SPILL_MAX_AGE_DAYS * day)).toBe(true)
    expect(isSpillStale(0, TOOL_RESULT_SPILL_MAX_AGE_DAYS * day - 1)).toBe(false)
    expect(isSpillStale(NaN, 1000)).toBe(false)
    expect(isSpillStale(1000, NaN)).toBe(false)
  })
})

describe('canRecoverOverflow', () => {
  it('recovers count-based kinds without any wire words', () => {
    expect(canRecoverOverflow('preflight', undefined, undefined)).toBe(true)
    expect(canRecoverOverflow('input-above-window', undefined, undefined)).toBe(true)
    expect(canRecoverOverflow('empty-near-window', undefined, undefined)).toBe(true)
  })

  it('recovers the recorded refusal with its numbers, and nothing else phrased', () => {
    expect(canRecoverOverflow('error', 1_002_881, 1_000_000)).toBe(true)
    expect(canRecoverOverflow('error', undefined, undefined)).toBe(false)
    expect(canRecoverOverflow('error', 1_002_881, undefined)).toBe(false)
  })
})

describe('the brand constructors', () => {
  it('builds request items only from bounded text', () => {
    const bounded = boundToolResultText('small', LIMITS)
    if (bounded.cut !== undefined) throw new Error('expected no cut')
    const noticed = withCutNotice(bounded.text, 'a notice')
    expect(noticed).toBe('small\na notice')
    expect(callOutputItem('c1', noticed)).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: noticed,
    })
    expect(toolNoteItem(noticed)).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: noticed }],
    })
    expect(fixedHarnessText('Error: stopped')).toBe('Error: stopped')
    expect(restoredToolText('stored')).toBe('stored')
  })

  it('the cut notices say the spill file is removed with the session', () => {
    expect(MODEL_API_MODEL_TEXT.toolResultCut).toContain('removed with the session')
    expect(UI_TEXT.toolResultCutPreview).toContain('removed with the session')
  })
})
