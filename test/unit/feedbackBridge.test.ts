// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { feedbackBridge } from '../../src/webview/feedbackBridge'
import { FEEDBACK_NOTE_MAX_CHARS, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { WebviewToHostMessage } from '../../src/shared/protocol'

function answer(message: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
}

describe('feedbackBridge: the zod round-trip', () => {
  const bridges: ReturnType<typeof feedbackBridge>[] = []
  afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.close()
  })

  function setup() {
    const posted: WebviewToHostMessage[] = []
    const bridge = feedbackBridge((message) => {
      posted.push(message)
    })
    bridges.push(bridge)
    bridge.open()
    return { bridge, posted }
  }

  it('previews the scrubbed note and sends the approved one with its classification', async () => {
    const { bridge, posted } = setup()
    const previewed = bridge.port.scrubNote?.('A wrong answer')
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ type: 'previewFeedback', note: 'A wrong answer' })
    const requestId = (posted[0] as { requestId: number }).requestId
    answer({ type: 'feedbackPreview', requestId, note: 'A scrubbed answer' })
    await expect(previewed).resolves.toBe('A scrubbed answer')
    const sent = bridge.port.submit({
      sessionId: 's',
      classification: 'badResult',
      note: 'A scrubbed answer',
      withFiles: false,
      attachSessionRecord: false,
    })
    expect(posted).toHaveLength(2)
    expect(posted[1]).toEqual({
      type: 'submitFeedback',
      requestId: expect.any(Number) as number,
      sessionId: 's',
      classification: 'badResult',
      note: 'A scrubbed answer',
    })
    const sendId = (posted[1] as { requestId: number }).requestId
    answer({ type: 'feedbackOutcome', requestId: sendId, outcome: UI_TEXT.feedbackUploaded })
    await expect(sent).resolves.toBe(UI_TEXT.feedbackUploaded)
  })

  it('rejects the send with the refusal text', async () => {
    const { bridge, posted } = setup()
    const sent = bridge.port.submit({
      sessionId: 's',
      classification: 'bug',
      note: 'Steps',
      withFiles: false,
      attachSessionRecord: false,
    })
    const requestId = (posted[0] as { requestId: number }).requestId
    answer({ type: 'feedbackOutcome', requestId, error: UI_TEXT.feedbackFailed })
    await expect(sent).rejects.toThrow(UI_TEXT.feedbackFailed)
  })

  it('drops malformed and stale answers and keeps waiting', async () => {
    const { bridge, posted } = setup()
    const previewed = bridge.port.scrubNote?.('note')
    const requestId = (posted[0] as { requestId: number }).requestId
    answer({ type: 'feedbackPreview', requestId })
    answer({ type: 'feedbackPreview', requestId: requestId + 1000, note: 'stale' })
    answer({ type: 'feedbackOutcome', requestId, outcome: 'wrong-channel' })
    let hasSettled = false
    void previewed?.then(
      () => {
        hasSettled = true
      },
      () => {
        hasSettled = true
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(hasSettled).toBe(false)
    answer({ type: 'feedbackPreview', requestId, note: 'late' })
    await expect(previewed).resolves.toBe('late')
  })

  it('refuses an attachable disclosure before posting anything', async () => {
    const { bridge, posted } = setup()
    await expect(
      bridge.port.submit({
        sessionId: 's',
        classification: 'badResult',
        note: 'note',
        withFiles: true,
        attachSessionRecord: true,
      }),
    ).rejects.toThrow(UI_TEXT.feedbackRecordUnsupported)
    expect(posted).toHaveLength(0)
  })

  it('refuses a fresh preview on a closed port without posting', async () => {
    const { bridge, posted } = setup()
    bridge.close()
    await expect(bridge.port.scrubNote?.('note')).rejects.toThrow(UI_TEXT.feedbackFailed)
    expect(posted).toHaveLength(0)
  })

  it('rejects the in-flight send when the dialog closes', async () => {
    const { bridge } = setup()
    const sent = bridge.port.submit({
      sessionId: 's',
      classification: 'other',
      note: 'note',
      withFiles: false,
      attachSessionRecord: false,
    })
    bridge.close()
    await expect(sent).rejects.toThrow(UI_TEXT.feedbackFailed)
  })

  it('rejects a reply that carries neither an outcome nor a refusal', async () => {
    const { bridge, posted } = setup()
    const sent = bridge.port.submit({
      sessionId: 's',
      classification: 'other',
      note: 'note',
      withFiles: false,
      attachSessionRecord: false,
    })
    const requestId = (posted[0] as { requestId: number }).requestId
    answer({ type: 'feedbackOutcome', requestId })
    await expect(sent).rejects.toThrow(UI_TEXT.feedbackFailed)
  })

  it('refuses an overlong note before posting anything', async () => {
    const { bridge, posted } = setup()
    const long = 'x'.repeat(FEEDBACK_NOTE_MAX_CHARS + 1)
    const reason = fill(UI_TEXT.feedbackNoteTooLong, { max: FEEDBACK_NOTE_MAX_CHARS })
    await expect(bridge.port.scrubNote?.(long)).rejects.toThrow(reason)
    await expect(
      bridge.port.submit({
        sessionId: 's',
        classification: 'other',
        note: long,
        withFiles: false,
        attachSessionRecord: false,
      }),
    ).rejects.toThrow(reason)
    expect(posted).toHaveLength(0)
  })

  it('keeps request ids unique across bridges and settles previews on close', async () => {
    const first = setup()
    const previewed = first.bridge.port.scrubNote?.('note')
    const firstId = (first.posted[0] as { requestId: number }).requestId
    first.bridge.close()
    await expect(previewed).rejects.toThrow(UI_TEXT.feedbackFailed)
    const second = setup()
    const next = second.bridge.port.scrubNote?.('note')
    const secondId = (second.posted[0] as { requestId: number }).requestId
    expect(secondId).not.toBe(firstId)
    // The closed bridge's late answer settles nothing on the new bridge.
    let hasSettled = false
    void next?.then(
      () => {
        hasSettled = true
      },
      () => {
        hasSettled = true
      },
    )
    answer({ type: 'feedbackPreview', requestId: firstId, note: 'stale' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(hasSettled).toBe(false)
    answer({ type: 'feedbackPreview', requestId: secondId, note: 'fresh' })
    await expect(next).resolves.toBe('fresh')
  })
})
