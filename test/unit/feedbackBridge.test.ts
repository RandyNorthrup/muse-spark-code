// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { feedbackBridge } from '../../src/webview/feedbackBridge'
import { UI_TEXT } from '../../src/shared/constants'
import type { WebviewToHostMessage } from '../../src/shared/protocol'

function answer(message: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
}

describe('feedbackBridge: the zod round-trip', () => {
  const bridges: ReturnType<typeof feedbackBridge>[] = []
  afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.close()
    vi.restoreAllMocks()
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
})
