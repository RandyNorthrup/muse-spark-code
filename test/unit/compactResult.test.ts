import { describe, expect, it } from 'vitest'
import { compactResultText } from '../../src/core/compactResult'
import { UI_TEXT } from '../../src/shared/constants'

// A /compact turn never ends silently: every outcome carries a sentence.
describe('compactResultText', () => {
  it('names the turns and sizes a successful compaction folded', () => {
    const text = compactResultText({
      status: 'accepted',
      reason: undefined,
      turns: 12,
      beforeEntries: 48,
      afterEntries: 6,
    })
    expect(text).toContain('12')
    expect(text).toContain('48')
    expect(text).toContain('6')
  })

  it('uses the singular turn form for one turn', () => {
    const text = compactResultText({
      status: 'accepted',
      reason: undefined,
      turns: 1,
      beforeEntries: 9,
      afterEntries: 3,
    })
    expect(text).toContain('1')
    expect(text).not.toContain('turns')
  })

  it('falls back to the plain sentence when the backend counted nothing', () => {
    expect(compactResultText({ status: 'ok', reason: undefined })).toBe(UI_TEXT.compactionDone)
  })

  it('says why nothing was done on a noop', () => {
    const text = compactResultText({ status: 'noop', reason: 'no-compactable-history' })
    expect(text).toContain('no-compactable-history')
  })

  it('says the conversation is unchanged when stopped', () => {
    expect(compactResultText({ status: 'cancelled', reason: 'stopped' })).toBe(
      UI_TEXT.compactionStoppedNotice,
    )
  })
})
