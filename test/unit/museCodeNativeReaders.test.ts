import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFeedbackOutcome } from '../../src/core/backends/musecode/feedback'
import { parseModelEffortExtras } from '../../src/core/backends/musecode/modelEfforts'
import { UI_TEXT } from '../../src/shared/constants'

// Native readers for the C-M106-1 1.4.4 frames
// (test/fixtures/m106/msp-1.4.4-host-feedback.json): the `model/list`
// catalogue extras, the note-only `feedback/submit` receipt, and the
// upstream-request refusals where Muse Code sends no frame (record-attached
// receipts, `session/delete`). The readers take the served frames, never a
// guessed shape. Host dispatch (listModels, submitFeedback, deleteSession)
// needs a live `muse serve` connection, so it is proven by the real-life run
// in docs/certification/msm106.md, not here.
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/m106/msp-1.4.4-host-feedback.json', import.meta.url), 'utf8'),
) as {
  frames: {
    direction: string
    frame: { id?: number; result?: unknown }
  }[]
}

function receivedResult(id: number): unknown {
  const frame = fixture.frames.find(
    (row) => row.direction === 'received' && row.frame.id === id,
  )?.frame
  if (!frame) throw new Error(`Missing captured response ${String(id)}`)
  return frame.result
}

function catalogueRows(): Record<string, unknown>[] {
  const result = receivedResult(2) as { models: Record<string, unknown>[] }
  return result.models
}

describe('Native effort reader from the captured 1.4.4 catalogue', () => {
  it('reads every captured row with its ordered variants, descriptions and default', () => {
    const rows = catalogueRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const raw = row as {
        variants: readonly string[]
        reasoningEffortVariants: readonly { tier: string; description?: string }[]
        defaultReasoningEffort: string
      }
      expect(parseModelEffortExtras(row)).toEqual({
        variants: raw.variants,
        reasoningEffortVariants: raw.reasoningEffortVariants,
        defaultReasoningEffort: raw.defaultReasoningEffort,
      })
    }
  })

  it('pins the contributor catalogue the slider renders', () => {
    const row = catalogueRows().find(
      (candidate) => candidate['modelId'] === 'muse-spark-1.3-contributor',
    )
    expect(parseModelEffortExtras(row)).toEqual({
      variants: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      reasoningEffortVariants: [
        { tier: 'xhigh', description: 'Use this for deepest analysis and complex fixes.' },
      ],
      defaultReasoningEffort: 'max',
    })
  })

  it('keeps the old projection for rows without extras', () => {
    expect(parseModelEffortExtras({ modelId: 'other', opaque: true })).toEqual({})
  })

  it('preserves the explicit unknown catalogue and future tiers verbatim', () => {
    expect(parseModelEffortExtras({ variants: 'unknown' })).toEqual({ variants: 'unknown' })
    expect(parseModelEffortExtras({ variants: ['minimal', 'turbo'] })).toEqual({
      variants: ['minimal', 'turbo'],
    })
  })

  it('refuses malformed extras instead of guessing', () => {
    expect(() => parseModelEffortExtras({ variants: [1] })).toThrow()
    expect(() => parseModelEffortExtras({ reasoningEffortVariants: [{ tier: 1 }] })).toThrow()
    expect(() => parseModelEffortExtras({ defaultReasoningEffort: 2 })).toThrow()
  })
})

describe('Native feedback reader from the captured 1.4.4 receipt', () => {
  it('shows the captured note-only upload without its identifiers', () => {
    const receipt = receivedResult(5) as Record<string, unknown>
    expect(receipt['outcome']).toBe('uploaded')
    const shown = parseFeedbackOutcome(receipt)
    expect(shown).toBe(UI_TEXT.feedbackUploaded)
    for (const value of [receipt['uploadId'], receipt['bundlePath']]) {
      expect(typeof value).toBe('string')
      expect(shown).not.toContain(value as string)
    }
  })

  it('refuses a record-attached receipt with the upstream request', () => {
    const receipt = {
      ...(receivedResult(5) as Record<string, unknown>),
      sessionRecordAttached: true,
    }
    expect(() => parseFeedbackOutcome(receipt)).toThrow(UI_TEXT.feedbackRecordUnsupported)
  })

  it.each([
    ['recorded', UI_TEXT.feedbackRecorded],
    ['acceptedWithoutReceipt', UI_TEXT.feedbackAcceptedWithoutReceipt],
    ['trackingFailed', UI_TEXT.feedbackTrackingFailed],
    ['trackingUncertain', UI_TEXT.feedbackTrackingUncertain],
    ['dark', UI_TEXT.feedbackDark],
    ['disabled', UI_TEXT.feedbackDisabled],
    ['noCredential', UI_TEXT.feedbackNoCredential],
    ['authRejected', UI_TEXT.feedbackAuthRejected],
    ['rateLimited', UI_TEXT.feedbackRateLimited],
    ['failed', UI_TEXT.feedbackFailed],
  ] as const)('refuses a non-upload outcome with its own sentence: %s', (outcome, sentence) => {
    expect(() => parseFeedbackOutcome({ outcome, sessionRecordAttached: false })).toThrow(sentence)
  })

  it('refuses an outcome outside the taxonomy with the unrecognized-outcome line', () => {
    expect(() => parseFeedbackOutcome({ outcome: 'stored', sessionRecordAttached: false })).toThrow(
      'stored',
    )
  })

  it('refuses a malformed receipt', () => {
    expect(() => parseFeedbackOutcome({})).toThrow()
    expect(() => parseFeedbackOutcome({ outcome: '' })).toThrow()
  })
})
