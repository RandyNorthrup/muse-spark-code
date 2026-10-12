import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelCallLimitError } from '../../src/core/backends/modelapi/sessionBudget'
import { MODEL_API_MAX_TOOL_ROUNDS, UI_TEXT } from '../../src/shared/constants'
import { plural } from '../../src/shared/l10n/text'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'

async function setup() {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(api, log)
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost(fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }))
  return { api, host, ...(await startWatchedSession(host, '/ws', 'promptUnmatched')) }
}

describe('model-call turn limit', () => {
  it('is typed and carries the permitted count', () => {
    const stop = new ModelCallLimitError(MODEL_API_MAX_TOOL_ROUNDS)
    expect(stop).toMatchObject({ name: 'ModelCallLimitError', limit: MODEL_API_MAX_TOOL_ROUNDS })
    expect(stop.message).toBe(plural(UI_TEXT.modelApiTurnLimit, MODEL_API_MAX_TOOL_ROUNDS))
  })

  it('ends a tool loop with a translated resumable limit, then accepts another message', async () => {
    const t = await setup()
    try {
      t.api.script(
        ...Array.from({ length: MODEL_API_MAX_TOOL_ROUNDS }, () => ({
          calls: [{ name: 'get_goal', arguments: '{}' }],
        })),
        { text: 'Continued answer' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS)
      expect(t.events).toContainEqual(
        expect.objectContaining({
          type: 'turnCompleted',
          terminal: 'completed',
          errorKind: 'max_turn_requests',
          reason: plural(UI_TEXT.modelApiTurnLimit, MODEL_API_MAX_TOOL_ROUNDS),
        }),
      )
      expect(t.events).toContainEqual({
        type: 'backendNotice',
        level: 'warning',
        text: plural(UI_TEXT.modelApiTurnLimit, MODEL_API_MAX_TOOL_ROUNDS),
      })
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
      await t.session.sendTurn([{ type: 'text', text: 'Continue' }])
      await t.turnDone()
      expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        type: 'turnCompleted',
        terminal: 'completed',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Continued answer' }),
      )
    } finally {
      await t.host.close()
    }
  })
})
