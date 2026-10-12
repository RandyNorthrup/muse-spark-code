import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelCallLimitError } from '../../src/core/backends/modelapi/sessionBudget'
import { MODEL_API_MAX_TOOL_ROUNDS, UI_TEXT } from '../../src/shared/constants'
import { mspApprovalMode } from '../../src/shared/permissionModes'
import { plural } from '../../src/shared/l10n/text'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'

async function setup(cap = MODEL_API_MAX_TOOL_ROUNDS) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(api, log)
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
    remainingModelCalls: () => cap,
  })
  return {
    api,
    host,
    io,
    ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
  }
}

describe('model-call turn limit', () => {
  it('is typed and carries the permitted count', () => {
    const stop = new ModelCallLimitError(MODEL_API_MAX_TOOL_ROUNDS)
    expect(stop).toMatchObject({ name: 'ModelCallLimitError', limit: MODEL_API_MAX_TOOL_ROUNDS })
    expect(stop.message).toBe(plural(UI_TEXT.modelApiTurnLimit, MODEL_API_MAX_TOOL_ROUNDS))
  })

  it('ends a tool loop with a translated resumable limit, then accepts another message', async () => {
    const cap = 3
    const t = await setup(cap)
    try {
      t.api.script(
        ...Array.from({ length: cap - 1 }, () => ({
          calls: [{ name: 'get_goal', arguments: '{}' }],
        })),
        {
          text: 'Done; found a bug; tests remain',
          calls: [
            {
              name: 'write_file',
              arguments: JSON.stringify({ path: 'should-not-run.txt', content: 'wrong' }),
            },
          ],
        },
        { text: 'Continued answer' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(cap)
      expect(t.events).toContainEqual(
        expect.objectContaining({
          type: 'turnCompleted',
          terminal: 'completed',
          errorKind: 'max_turn_requests',
          reason: plural(UI_TEXT.modelApiTurnLimit, cap),
        }),
      )
      expect(t.events).toContainEqual({
        type: 'backendNotice',
        level: 'warning',
        text: plural(UI_TEXT.modelApiTurnLimit, cap),
      })
      expect(t.io.files.has('/ws/should-not-run.txt')).toBe(false)
      const last = t.api.responseBodies().at(-1)
      expect(last?.['tools']).toEqual([])
      expect(last?.['tool_choice']).toBe('none')
      expect(last?.['instructions']).toContain('limit of 3 model calls')
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Done; found a bug; tests remain' }),
      )
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
