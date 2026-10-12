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

async function setup(cap?: number) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(api, log)
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
    remainingModelCalls: cap === undefined ? undefined : () => cap,
  })
  return {
    api,
    host,
    io,
    ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
  }
}

/** Scripted tool replies for a model that keeps calling instead of answering. */
function toolCallReplies(count: number) {
  return Array.from({ length: count }, () => ({
    calls: [{ name: 'get_goal', arguments: '{}' }],
  }))
}

describe('model-call turn limit', () => {
  it('is typed and carries the permitted count', () => {
    const stop = new ModelCallLimitError(MODEL_API_MAX_TOOL_ROUNDS)
    expect(stop).toMatchObject({ name: 'ModelCallLimitError', limit: MODEL_API_MAX_TOOL_ROUNDS })
    expect(stop.message).toBe(plural(UI_TEXT.modelApiTurnLimit, MODEL_API_MAX_TOOL_ROUNDS))
  })

  it.each([51, 80, 199])('finishes %s tool rounds under the default cap', async (rounds) => {
    const t = await setup()
    try {
      const answer = `Answer after ${String(rounds)} tool rounds`
      t.api.script(...toolCallReplies(rounds), { text: answer })
      await t.session.sendTurn([{ type: 'text', text: 'Long review' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(rounds + 1)
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: answer }),
      )
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
    } finally {
      await t.host.close()
    }
  })

  it('lets a caller use more than the default 200 calls', async () => {
    const cap = 205
    const t = await setup(cap)
    try {
      t.api.script(...toolCallReplies(cap - 1), { text: 'Final review summary' })
      await t.session.sendTurn([{ type: 'text', text: 'Use the caller allowance' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(cap)
      expect(t.api.responseBodies().at(-1)?.['instructions']).toContain('limit of 205 model calls')
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ text: 'Final review summary' }),
      )
    } finally {
      await t.host.close()
    }
  })

  it('rebuilds an HTTP retry into a wrap-up when one call remains', async () => {
    const t = await setup(3)
    try {
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}' }] },
        { httpError: { status: 429 } },
        { text: 'Retried final answer' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review with a retry' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(3)
      expect(t.api.responseBodies().at(-1)).toMatchObject({ tools: [], tool_choice: 'none' })
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        errorKind: 'max_turn_requests',
      })
    } finally {
      await t.host.close()
    }
  })

  it('ends a tool loop with a translated resumable limit, then accepts another message', async () => {
    const cap = 3
    const t = await setup(cap)
    try {
      t.api.script(
        ...toolCallReplies(cap - 1),
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
