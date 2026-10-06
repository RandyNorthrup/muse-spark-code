import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost, questionResultText } from '../../src/core/backends/modelapi/ModelApiHost'
import { QUESTION_MODEL_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'

const call = {
  name: 'ask_user',
  arguments: JSON.stringify({
    questions: [
      {
        id: 'colour',
        header: 'Colour',
        question: 'Which colour?',
        options: [{ label: 'Blue' }, { label: 'Green' }],
        selection: { mode: 'single' },
      },
    ],
  }),
}

async function setup() {
  const api = fakeModelApi()
  const client = fakeModelApiClient(api, new FakeLogOutputChannel())
  const host = new ModelApiHost(
    fakeModelApiHostDeps({
      client,
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log: new FakeLogOutputChannel(),
    }),
  )
  const watched = await startWatchedSession(host, '/ws', 'promptUnmatched')
  api.script({ calls: [call] }, { text: 'Continuing independent work.' })
  return { api, host, ...watched }
}

describe('Model API question deferral', () => {
  it('settles with only the fixed deferral output and rejects a second settlement', async () => {
    const t = await setup()
    try {
      const done = t.turnDone()
      await t.session.sendTurn([{ type: 'text', text: 'go' }])
      await vi.waitFor(() => {
        expect(t.events.some((event) => event.type === 'questionRequested')).toBe(true)
      })
      const event = t.events.find((event) => event.type === 'questionRequested')
      if (event?.type !== 'questionRequested') throw new Error('missing question')
      const before = JSON.stringify(t.api.responseBodies()[0])
      const deferred = t.session.deferQuestions(event.userInputId)
      const cancelled = t.session.cancelQuestions(event.userInputId)
      await expect(cancelled).rejects.toMatchObject({
        name: 'PromptSettledError',
      })
      await deferred
      await done
      expect(t.events.find((event) => event.type === 'questionSettled')).toMatchObject({
        userInputId: event.userInputId,
        outcome: 'deferred',
        answers: [],
      })
      const requests = t.api.responseBodies()
      expect(JSON.stringify(requests[0])).toBe(before)
      expect(requests).toHaveLength(2)
      expect(requests[1]?.['instructions']).toEqual(requests[0]?.['instructions'])
      expect(requests[1]?.['tools']).toEqual(requests[0]?.['tools'])
      expect(requests[1]?.['input']).toContainEqual(
        expect.objectContaining({
          type: 'function_call_output',
          output: fill(QUESTION_MODEL_TEXT.deferred, { id: event.userInputId }),
        }),
      )
    } finally {
      await t.host.close()
    }
  })

  it('keeps ordinary answers and explanations byte-identical to the existing result format', () => {
    const answers = [{ questionId: 'colour', selectedLabel: 'Blue' }]
    expect(questionResultText({ kind: 'answered', answers })).toBe(
      `The user answered:\n${JSON.stringify(answers)}`,
    )
    expect(questionResultText({ kind: 'clarified', text: 'Green.' })).toBe(
      'The user chose none of the options and explained instead:\nGreen.',
    )
  })
})
