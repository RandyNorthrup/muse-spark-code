// A child task's result is never sliced silently. The full text stays on
// the result; bounded surfaces carry the slice plus a notice with both
// counts. Pure through the real host helpers, values passed in as data.
import { describe, expect, it } from 'vitest'
import {
  listedChildResult,
  visibleChildResultText,
} from '../../src/core/backends/modelapi/ModelApiHost'
import {
  MODEL_API_MODEL_TEXT,
  SUBAGENT_RESULT_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill, formatNumber } from '../../src/shared/l10n/text'

const LONG = `done: ${'y'.repeat(SUBAGENT_RESULT_TEXT_MAX_CHARS + 100)}`

describe('visibleChildResultText', () => {
  it('shows a short result with no clip note', () => {
    expect(visibleChildResultText({ summary: 'done' })).toBe('done')
  })

  it('names the kept and total counts beside a clipped listing', () => {
    const shown = visibleChildResultText(
      { summary: LONG.slice(0, 512), text: LONG },
      SUBAGENT_RESULT_TEXT_MAX_CHARS,
    )
    expect(shown).toContain('child transcript')
    expect(shown).toContain(formatNumber(SUBAGENT_RESULT_TEXT_MAX_CHARS))
    expect(shown).toContain(formatNumber(LONG.length))
  })

  it('returns undefined without a result', () => {
    expect(visibleChildResultText(undefined)).toBeUndefined()
  })
})

describe('listedChildResult', () => {
  it('passes a short result through unchanged', () => {
    const result = { summary: 'done', text: 'done' }
    expect(listedChildResult(result)).toBe(result)
  })

  it('bounds a long listing and marks it with both counts', () => {
    const result = { summary: LONG.slice(0, 512), text: LONG }
    const listed = listedChildResult(result)
    expect(listed.text).toBe(LONG.slice(0, SUBAGENT_RESULT_TEXT_MAX_CHARS))
    expect(listed.summary).toContain('child transcript')
  })
})

describe('child result clip notices', () => {
  it('tells the model the kept and total counts and where the full result lives', () => {
    const notice = fill(MODEL_API_MODEL_TEXT.subagentResultClipped, {
      kept: SUBAGENT_RESULT_TEXT_MAX_CHARS,
      total: LONG.length,
    })
    expect(notice).toContain('subagent_read_result')
    expect(notice).toContain(formatNumber(SUBAGENT_RESULT_TEXT_MAX_CHARS))
    expect(notice).toContain(formatNumber(LONG.length))
  })

  it('tells the person the kept and total counts and where the full result lives', () => {
    const notice = fill(UI_TEXT.subagentResultClipped, {
      kept: SUBAGENT_RESULT_TEXT_MAX_CHARS,
      total: LONG.length,
    })
    expect(notice).toContain('child transcript')
    expect(notice).toContain(formatNumber(SUBAGENT_RESULT_TEXT_MAX_CHARS))
    expect(notice).toContain(formatNumber(LONG.length))
  })
})
