// B9: a child task's result is never sliced silently. The full text stays on
// the result; bounded surfaces carry the slice plus a notice with both
// counts. Pure through the real modules, values passed in as data.
import { describe, expect, it } from 'vitest'
import { clipChildResultText } from '../../src/shared/agentReceipt'
import {
  MODEL_API_MODEL_TEXT,
  SUBAGENT_RESULT_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill, formatNumber } from '../../src/shared/l10n/text'

describe('clipChildResultText', () => {
  it('passes a short result through byte-identical with no clip', () => {
    const text = 'done: all 14 checks passed'
    expect(clipChildResultText(text)).toEqual({
      text,
      kept: text.length,
      total: text.length,
      clipped: false,
    })
  })

  it('passes a result exactly at the bound through unclipped', () => {
    const text = 'x'.repeat(SUBAGENT_RESULT_TEXT_MAX_CHARS)
    const clipped = clipChildResultText(text)
    expect(clipped.clipped).toBe(false)
    expect(clipped.text).toBe(text)
  })

  it('clips a long result at the bound and reports both counts', () => {
    const text = 'y'.repeat(SUBAGENT_RESULT_TEXT_MAX_CHARS + 100)
    const clipped = clipChildResultText(text)
    expect(clipped.clipped).toBe(true)
    expect(clipped.text).toBe(text.slice(0, SUBAGENT_RESULT_TEXT_MAX_CHARS))
    expect(clipped.kept).toBe(SUBAGENT_RESULT_TEXT_MAX_CHARS)
    expect(clipped.total).toBe(text.length)
  })

  it('leaves an empty result unclipped', () => {
    expect(clipChildResultText('')).toEqual({ text: '', kept: 0, total: 0, clipped: false })
  })
})

describe('child result clip notices', () => {
  it('tells the model the kept and total counts and where the full result lives', () => {
    const clipped = clipChildResultText('z'.repeat(SUBAGENT_RESULT_TEXT_MAX_CHARS + 7))
    const notice = fill(MODEL_API_MODEL_TEXT.subagentResultClipped, {
      kept: clipped.kept,
      total: clipped.total,
    })
    expect(notice).toContain('subagent_read_result')
    expect(notice).toContain(formatNumber(SUBAGENT_RESULT_TEXT_MAX_CHARS))
    expect(notice).toContain(formatNumber(SUBAGENT_RESULT_TEXT_MAX_CHARS + 7))
  })

  it('tells the person the kept and total counts and where the full result lives', () => {
    const clipped = clipChildResultText('z'.repeat(SUBAGENT_RESULT_TEXT_MAX_CHARS + 7))
    const notice = fill(UI_TEXT.subagentResultClipped, {
      kept: clipped.kept,
      total: clipped.total,
    })
    expect(notice).toContain('child transcript')
    expect(notice).toContain(formatNumber(SUBAGENT_RESULT_TEXT_MAX_CHARS))
    expect(notice).toContain(formatNumber(SUBAGENT_RESULT_TEXT_MAX_CHARS + 7))
  })
})
