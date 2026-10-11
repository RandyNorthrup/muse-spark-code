import { describe, expect, it, vi } from 'vitest'
import { observeBackend } from '../../src/runtime/exec/sessionTap'
import type { LastResponse } from '../../src/runtime/exec/execProtocol'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { UI_TEXT } from '../../src/shared/constants'

const completed: LastResponse = {
  n: 1,
  terminal: 'completed',
  incompleteReason: null,
  endedWithoutTerminal: false,
  httpStatus: null,
  transportError: null,
  usage: 'valid',
  settlement: 'priced',
}
async function harness(kind: 'modelApi' | 'museCode' = 'modelApi') {
  const host = new FakeAgentHost()
  const prepared = new FakeAgentSession('prepared', 'm')
  host.sessions.push(prepared)
  const subscribed = vi.spyOn(prepared, 'onEvent')
  host.startSession.mockResolvedValue(prepared)
  const tap = observeBackend({
    kind,
    readiness: () => Promise.resolve({ state: 'ready' }),
    hostFor: () => Promise.resolve(host),
  })
  const wrapped = await tap.backend.hostFor('ws')
  const session = await wrapped.startSession({
    workspaceRoot: 'ws',
    modelId: 'm',
    approvalMode: 'denyUnmatched',
  })
  const actual = host.sessions.find((entry) => entry.sessionId === session.sessionId)!
  return { host, tap, wrapped, session: actual, subscribed }
}
function listen(h: Awaited<ReturnType<typeof harness>>): void {
  h.tap.subscribe(h.session.sessionId, () => undefined)
  h.tap.beginResponse(1)
}
function agentDone(itemId: string, text: string) {
  return {
    type: 'itemCompleted',
    item: { itemId, kind: 'agentMessage', status: 'completed', text },
  } as const
}

describe('M80 authoritative message release', () => {
  it('D22 host wrapper preserves prototype methods and leaves first backlog to ACP', async () => {
    const h = await harness('museCode')
    expect(h.subscribed).not.toHaveBeenCalled()
    expect(await h.tap.backend.hostFor('ws')).toBe(h.wrapped)
    const order: string[] = []
    vi.spyOn(h.session, 'onEvent').mockImplementation((listener) => {
      order.push(order.length === 0 ? 'ACP' : 'tap')
      return FakeAgentSession.prototype.onEvent.call(h.session, listener)
    })
    h.session.onEvent(() => undefined)
    h.tap.subscribe(h.session.sessionId, () => undefined)
    expect(order).toEqual(['ACP', 'tap'])
    expect(await h.wrapped.listModels()).not.toHaveLength(0)
    const request = { itemId: 'edit', outputRef: 'patch', offsetBytes: 0, lengthBytes: 1 }
    h.host.readSessionOutput.mockRejectedValueOnce(new Error('child output unavailable'))
    await expect(h.wrapped.readSessionOutput('child-1', request)).rejects.toThrow(
      'child output unavailable',
    )
    expect(h.host.readSessionOutput).toHaveBeenCalledWith('child-1', request)
  })
  it.each([false, true])(
    'D15/L12 settlement before itemCompleted=%s emits whole final item only',
    async (settlementFirst) => {
      const h = await harness()
      listen(h)
      h.session.emit({
        type: 'itemStarted',
        item: { itemId: 'a', kind: 'agentMessage', status: 'in_progress', text: 'prefix' },
      })
      if (settlementFirst) h.tap.settleResponse(completed)
      expect(h.tap.releasedMessages()).toEqual([])
      h.session.emit({
        type: 'itemCompleted',
        item: {
          itemId: 'a',
          kind: 'agentMessage',
          status: 'completed',
          text: 'whole final message',
        },
      })
      if (!settlementFirst) h.tap.settleResponse(completed)
      expect(h.tap.releasedMessages()).toEqual([
        { itemId: 'a', kind: 'agentMessage', text: 'whole final message', complete: true },
      ])
    },
  )
  it.each(['incomplete', 'failed', null])(
    'D25/D26 synthetic complete cannot authorize terminal %s',
    async (terminal) => {
      const h = await harness()
      listen(h)
      h.session.emit(agentDone('a', 'LLM|short'))
      h.tap.settleResponse({
        ...completed,
        terminal,
        settlement: 'full-reservation',
        endedWithoutTerminal: terminal === null,
      })
      expect(h.tap.releasedMessages()).toEqual([
        { itemId: 'a', kind: 'agentMessage', text: UI_TEXT.execMessageWithheld, complete: false },
      ])
    },
  )
  it('F2 terminal followed by transport error withholds; latest response does not rebind old items', async () => {
    const h = await harness()
    listen(h)
    h.session.emit(agentDone('a', 'first'))
    h.tap.settleResponse(completed)
    h.tap.beginResponse(2)
    h.session.emit({
      type: 'itemCompleted',
      item: { itemId: 'b', kind: 'reasoning', status: 'completed', summary: ['secret prefix'] },
    })
    h.tap.settleResponse({
      ...completed,
      n: 2,
      transportError: 'error',
      settlement: 'full-reservation',
    })
    expect(h.tap.releasedMessages().map((r) => [r.text, r.complete])).toEqual([
      ['first', true],
      [UI_TEXT.execMessageWithheld, false],
    ])
  })
  it.each(['completed', 'interrupted'])(
    'D22 Muse whole turn %s remains authority',
    async (terminal) => {
      const h = await harness('museCode')
      listen(h)
      h.session.emit(agentDone('a', 'whole'))
      h.session.emit({ type: 'turnCompleted', turnId: 't', terminal })
      expect(h.tap.releasedMessages()[0]).toMatchObject({
        text: terminal === 'completed' ? 'whole' : UI_TEXT.execMessageWithheld,
        complete: terminal === 'completed',
      })
    },
  )
})
