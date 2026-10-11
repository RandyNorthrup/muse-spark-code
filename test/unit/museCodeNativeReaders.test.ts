import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  NATIVE_FEEDBACK_READER,
  parseFeedbackOutcome,
} from '../../src/core/backends/musecode/feedback'
import {
  NATIVE_MODEL_EFFORTS,
  parseModelEffortExtras,
} from '../../src/core/backends/musecode/modelEfforts'
import {
  MuseCodeHost,
  type MuseCodeFeaturePorts,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeInitializeResult, fakeMspHost } from './helpers/fakeMsp'

// Native readers for the C-M106-1 1.4.4 frames
// (test/fixtures/m106/msp-1.4.4-host-feedback.json): the `model/list`
// catalogue extras, the note-only `feedback/submit` receipt, and the
// upstream-request refusals where Muse Code sends no frame (record-attached
// receipts, `session/delete`). The readers take the served frames, never a
// guessed shape.
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

function setup(features: MuseCodeFeaturePorts = {}, grants: readonly string[] = []) {
  const served = fakeMspHost({ ...fakeInitializeResult, grantedCapabilities: [...grants] })
  const host = new MuseCodeHost(
    served.host,
    new FakeLogOutputChannel(),
    { normalMs: 100, longMs: 100 },
    features,
  )
  return { ...served, host }
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

  it('carries the captured catalogue through listModels once bound', async () => {
    const { host, server } = setup({ modelEfforts: NATIVE_MODEL_EFFORTS })
    server.handle('model/list', () => receivedResult(2) as Record<string, unknown>)
    const models = await host.listModels()
    expect(models).toHaveLength(catalogueRows().length)
    const contributor = models.find((model) => model.modelId === 'muse-spark-1.3-contributor')
    expect(contributor).toMatchObject({ defaultReasoningEffort: 'max' })
    expect(contributor?.variants).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
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

  it('serves the captured receipt through the host and sends only ticked disclosures', async () => {
    const { host, server } = setup({ feedback: NATIVE_FEEDBACK_READER }, ['feedback'])
    server.handle('feedback/submit', () => receivedResult(5) as Record<string, unknown>)
    const note = 'A wrong answer'
    await expect(
      host.submitFeedback({
        sessionId: 's',
        classification: 'badResult',
        note,
        withFiles: false,
        attachSessionRecord: false,
      }),
    ).resolves.toBe(UI_TEXT.feedbackUploaded)
    expect(server.requestsFor('feedback/submit')).toHaveLength(1)
    expect(server.requestsFor('feedback/submit')[0]?.params).toEqual({
      sessionId: 's',
      classification: 'badResult',
      note,
      withFiles: false,
      attachSessionRecord: false,
    })
  })

  it('reports the uncertified attachment instead of an upload success', async () => {
    const { host, server } = setup({ feedback: NATIVE_FEEDBACK_READER }, ['feedback'])
    const receipt = {
      ...(receivedResult(5) as Record<string, unknown>),
      sessionRecordAttached: true,
    }
    server.handle('feedback/submit', () => receipt)
    await expect(
      host.submitFeedback({
        sessionId: 's',
        classification: 'badResult',
        note: 'A wrong answer',
        withFiles: true,
        attachSessionRecord: true,
      }),
    ).rejects.toThrow(UI_TEXT.feedbackRecordUnsupported)
    expect(server.requestsFor('feedback/submit')).toHaveLength(1)
  })
})

describe('Feedback submit golden and refusals', () => {
  const report = {
    sessionId: 's',
    classification: 'badResult',
    note: 'A wrong answer',
    withFiles: false,
    attachSessionRecord: false,
  } as const

  it('serializes the submit params byte-identically', async () => {
    const { host, server } = setup({ feedback: NATIVE_FEEDBACK_READER }, ['feedback'])
    server.handle('feedback/submit', () => receivedResult(5) as Record<string, unknown>)
    await host.submitFeedback({ ...report })
    expect(server.requestsFor('feedback/submit')).toHaveLength(1)
    expect(JSON.stringify(server.requestsFor('feedback/submit')[0]?.params)).toBe(
      '{"sessionId":"s","classification":"badResult","note":"A wrong answer","withFiles":false,"attachSessionRecord":false}',
    )
  })

  it('refuses without the reader or the grant before dispatch', async () => {
    const bare = setup()
    await expect(bare.host.submitFeedback({ ...report })).rejects.toThrow(UI_TEXT.feedbackFailed)
    expect(bare.server.requestsFor('feedback/submit')).toHaveLength(0)
    const ungranted = setup({ feedback: NATIVE_FEEDBACK_READER })
    await expect(ungranted.host.submitFeedback({ ...report })).rejects.toThrow(
      UI_TEXT.feedbackFailed,
    )
    expect(ungranted.server.requestsFor('feedback/submit')).toHaveLength(0)
  })
})

describe('Deletion refusal where Muse Code sends no frame', () => {
  it('refuses before dispatch with the upstream request', async () => {
    const { host, server } = setup()
    await expect(host.deleteSession('s')).rejects.toThrow(UI_TEXT.sessionDeleteUnsupported)
    expect(server.requestsFor('session/delete')).toHaveLength(0)
  })
})
