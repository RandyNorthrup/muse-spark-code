import { describe, expect, it } from 'vitest'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'

const sessionId = 's1'

describe('mapNotification', () => {
  it.each([
    [
      'turn/started',
      { sessionId, turnId: 't1', viewCursor: 'v' },
      { type: 'turnStarted', turnId: 't1' },
    ],
    [
      'item/started',
      {
        sessionId,
        item: { itemId: 'i1', kind: 'agentMessage', status: 'inProgress', turnId: 't1' },
      },
      { type: 'itemStarted', itemId: 'i1', kind: 'agentMessage', turnId: 't1' },
    ],
    [
      'item/delta',
      { sessionId, itemId: 'i1', delta: 'hel', field: 'text', viewCursor: 'v' },
      { type: 'textDelta', itemId: 'i1', field: 'text', delta: 'hel' },
    ],
    [
      'item/delta',
      { sessionId, itemId: 'i1', delta: 'lo', viewCursor: 'v' },
      { type: 'textDelta', itemId: 'i1', field: 'text', delta: 'lo' },
    ],
    [
      'item/completed',
      {
        sessionId,
        item: { itemId: 'i1', kind: 'agentMessage', status: 'completed', text: 'hello' },
      },
      {
        type: 'itemCompleted',
        itemId: 'i1',
        kind: 'agentMessage',
        status: 'completed',
        text: 'hello',
      },
    ],
    [
      'turn/completed',
      { sessionId, turnId: 't1', terminal: 'completed', durationMs: 42 },
      { type: 'turnCompleted', turnId: 't1', terminal: 'completed', durationMs: 42 },
    ],
    [
      'turn/completed',
      {
        sessionId,
        turnId: 't1',
        terminal: 'failed',
        reason: 'not logged in',
        error: { kind: 'authRequired', message: 'not logged in', retryable: false },
      },
      {
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        reason: 'not logged in',
        errorKind: 'authRequired',
      },
    ],
    [
      'session/tokenUsage',
      {
        sessionId,
        modelId: 'muse-spark-1.3',
        usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, reasoningTokens: 1 },
      },
      {
        type: 'tokenUsage',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        reasoningTokens: 1,
        modelId: 'muse-spark-1.3',
      },
    ],
    [
      'session/contextUsage',
      { sessionId, usedTokens: 100, windowTokens: 1000, pressure: 'normal' },
      { type: 'contextUsage', usedTokens: 100, windowTokens: 1000, pressure: 'normal' },
    ],
    [
      'session/modelChanged',
      { sessionId, modelId: 'muse-spark-1.3', source: 'client' },
      { type: 'modelChanged', modelId: 'muse-spark-1.3' },
    ],
    [
      'session/statusChanged',
      { sessionId, status: 'running', viewCursor: 'v' },
      { type: 'sessionStatus', status: 'running' },
    ],
    [
      'session/reasoningEffortChanged',
      { sessionId, reasoningEffort: 'xhigh', source: 'user', viewCursor: 'v' },
      { type: 'effortChanged', effort: 'xhigh' },
    ],
    [
      'session/approvalModeChanged',
      { sessionId, mode: 'allowAll', source: 'approvalReconfigure', viewCursor: 'v' },
      { type: 'approvalModeChanged', mode: 'allowAll' },
    ],
    ['skill/changed', { sessionId }, { type: 'skillsChanged' }],
  ])('maps %s', (method, params, event) => {
    expect(mapNotification({ method, params })).toEqual({ sessionId, event })
  })

  it('ignores methods the UI does not consume', () => {
    expect(mapNotification({ method: 'view/gap', params: { sessionId } })).toBeUndefined()
    expect(mapNotification({ method: 'initialized' })).toBeUndefined()
  })

  it('ignores malformed params instead of throwing', () => {
    expect(
      mapNotification({ method: 'item/delta', params: { sessionId, itemId: 'i1' } }),
    ).toBeUndefined()
    expect(mapNotification({ method: 'turn/started', params: { turnId: 't1' } })).toBeUndefined()
  })
})
