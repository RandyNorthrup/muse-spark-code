import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { CLARIFICATION_MAX_CHARS, QUESTION_MODEL_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeInitializeResult, fakeMspHost, settle } from './helpers/fakeMsp'
import { QUESTION_CLARIFIED } from './helpers/m46Capture'
import type { AgentEvent } from '../../src/shared/agentEvents'

async function setup() {
  const handle = fakeMspHost(fakeInitializeResult)
  const log = new FakeLogOutputChannel()
  const host = new MuseCodeHost(handle.host, log)
  handle.server.handle('session/start', () => ({
    session: { sessionId: QUESTION_CLARIFIED.sessionId, modelId: 'muse-spark-1.3', status: 'idle' },
  }))
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'askUnmatched',
  })
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  const question = {
    sessionId: session.sessionId,
    userInputId: QUESTION_CLARIFIED.userInputId,
    itemId: 'item-q',
    questions: [
      {
        id: 'colour',
        header: 'Colour',
        question: 'Which colour?',
        selection: { mode: 'single' },
        options: [{ label: 'Blue' }, { label: 'Green' }],
      },
    ],
  }
  handle.server.notify('userInput/requested', question)
  await settle()
  return { handle, host, session, events }
}

describe('Muse Code question deferral uses the M46 capture', () => {
  it('reserves before dispatch, waits for settlement, and maps only deferred clarified ids', async () => {
    const t = await setup()
    try {
      const clarify = vi.fn((params: Record<string, unknown>) => ({
        status: 'accepted',
        commandId: params['commandId'],
      }))
      t.handle.server.handle('userInput/clarify', clarify)
      let isSettled = false
      const pending = (async () => {
        await t.session.deferQuestions(QUESTION_CLARIFIED.userInputId)
        isSettled = true
      })()
      void pending.catch(() => undefined)
      await settle()
      expect(isSettled).toBe(false)
      expect(clarify).toHaveBeenCalledWith(
        expect.objectContaining({
          clarification: {
            format: 'text',
            content: fill(QUESTION_MODEL_TEXT.deferredClarification, {
              id: QUESTION_CLARIFIED.userInputId,
            }),
          },
        }),
      )
      expect(
        fill(QUESTION_MODEL_TEXT.deferredClarification, { id: QUESTION_CLARIFIED.userInputId })
          .length,
      ).toBeLessThanOrEqual(CLARIFICATION_MAX_CHARS)
      await expect(t.session.deferQuestions(QUESTION_CLARIFIED.userInputId)).rejects.toMatchObject({
        name: 'PromptSettledError',
      })
      t.handle.server.notify('userInput/settled', QUESTION_CLARIFIED)
      await pending
      expect(t.events.at(-1)).toMatchObject({ type: 'questionSettled', outcome: 'deferred' })
      t.handle.server.notify('userInput/settled', {
        ...QUESTION_CLARIFIED,
        userInputId: 'user-explained',
      })
      await settle()
      expect(t.events.at(-1)).toMatchObject({ outcome: 'clarified' })
    } finally {
      await t.host.close()
    }
  })

  it('preserves future settlement words even for a deferred id', async () => {
    const t = await setup()
    try {
      t.handle.server.handle('userInput/clarify', (params) => {
        t.handle.server.notify('userInput/settled', {
          ...QUESTION_CLARIFIED,
          outcome: 'futureSettlement',
        })
        return { status: 'accepted', commandId: params['commandId'] }
      })
      await t.session.deferQuestions(QUESTION_CLARIFIED.userInputId)
      expect(t.events.at(-1)).toMatchObject({ outcome: 'futureSettlement' })
    } finally {
      await t.host.close()
    }
  })
})
