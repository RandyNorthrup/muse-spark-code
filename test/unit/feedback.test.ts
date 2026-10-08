import { describe, expect, it, vi } from 'vitest'
import {
  feedbackClassificationSchema,
  submitMuseFeedback,
} from '../../src/core/backends/musecode/feedback'
import { REDACTED_MARK, UI_TEXT } from '../../src/shared/constants'
import { redactSecrets } from '../../src/shared/redact'

const report = { sessionId: 's', classification: 'badResult', note: 'A wrong answer' } as const

describe('Muse Code feedback: user choices before an injected receipt reader', () => {
  it('scrubs M84 patterns even without a host literal scrubber', async () => {
    const submit = vi.fn().mockResolvedValue('uploaded')
    await submitMuseFeedback({ ...report, note: `ghp_${'x'.repeat(36)}` }, { submit })
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ note: REDACTED_MARK }))
  })
  it('scrubs a registered literal and an M84 credential pattern before dispatch', async () => {
    const literal = 'feedback-test-literal'
    const pattern = `ghp_${'x'.repeat(36)}`
    const submit = vi.fn().mockResolvedValue('uploaded')
    const scrubNote = vi.fn((note: string) => Promise.resolve(redactSecrets(note, [literal])))
    await submitMuseFeedback({ ...report, note: `${literal} / ${pattern}` }, { submit, scrubNote })
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      ...report,
      note: `${REDACTED_MARK} / ${REDACTED_MARK}`,
      withFiles: false,
      attachSessionRecord: false,
    })
  })

  it('refuses dispatch when scrubbing changes the approved preview', async () => {
    const submit = vi.fn()
    const note = 'feedback-test-literal'
    await expect(
      submitMuseFeedback(
        { ...report, note },
        { submit, scrubNote: () => Promise.resolve(REDACTED_MARK) },
        note,
      ),
    ).rejects.toThrow(UI_TEXT.feedbackFailed)
    expect(submit).not.toHaveBeenCalled()
  })
  it('keeps the client-selected classification vocabulary closed', () => {
    expect(feedbackClassificationSchema.safeParse('futureClassification').success).toBe(false)
  })

  it.each(['withFiles', 'attachSessionRecord'] as const)(
    'refuses non-boolean %s consent before dispatch',
    async (key) => {
      const submit = vi.fn()
      const input = { ...report, withFiles: false, attachSessionRecord: false }
      Reflect.set(input, key, '')
      await expect(submitMuseFeedback(input, { submit })).rejects.toThrow()
      expect(submit).not.toHaveBeenCalled()
    },
  )
  it('defaults both disclosures to false and sends only the selected parameters', async () => {
    const submit = vi.fn().mockResolvedValue('futureOutcome')
    const input = { ...report, clientArtifactsPath: '/private', unrelated: true }
    await expect(submitMuseFeedback(input, { submit })).resolves.toBe('futureOutcome')
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      ...report,
      withFiles: false,
      attachSessionRecord: false,
    })
  })

  it('preserves explicit files and session-record consent for a bad result', async () => {
    const submit = vi.fn().mockResolvedValue('recorded')
    const input = { ...report, withFiles: true, attachSessionRecord: true }
    await expect(submitMuseFeedback(input, { submit })).resolves.toBe('recorded')
    expect(submit).toHaveBeenCalledExactlyOnceWith(input)
  })

  it('refuses a blank bug note before dispatch', async () => {
    const submit = vi.fn()
    await expect(
      submitMuseFeedback({ ...report, classification: 'bug', note: '  ' }, { submit }),
    ).rejects.toThrow()
    expect(submit).not.toHaveBeenCalled()
  })

  it.each(['goodResult', 'other'] as const)(
    'refuses a record for %s before dispatch',
    async (classification) => {
      const submit = vi.fn()
      await expect(
        submitMuseFeedback(
          { ...report, classification, withFiles: true, attachSessionRecord: true },
          { submit },
        ),
      ).rejects.toThrow()
      expect(submit).not.toHaveBeenCalled()
    },
  )

  it('refuses a record without files consent before dispatch', async () => {
    const submit = vi.fn()
    await expect(
      submitMuseFeedback({ ...report, attachSessionRecord: true }, { submit }),
    ).rejects.toThrow()
    expect(submit).not.toHaveBeenCalled()
  })

  it('refuses an empty session before dispatch', async () => {
    const submit = vi.fn()
    await expect(submitMuseFeedback({ ...report, sessionId: '' }, { submit })).rejects.toThrow()
    expect(submit).not.toHaveBeenCalled()
  })

  it('refuses a non-string domain outcome and does not retry', async () => {
    const submit = vi.fn().mockResolvedValue({ outcome: 'uploaded' })
    await expect(submitMuseFeedback(report, { submit })).rejects.toThrow()
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
