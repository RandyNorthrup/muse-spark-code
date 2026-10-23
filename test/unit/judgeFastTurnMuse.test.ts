// M125 lane U (D107): the turn record through a live Muse session (the
// SDK's real Connection, the recorded 1.4.7 capture, zero model calls).
// A looped turn closes with its record: the loop acted, done and failure
// evaluated. The pin forces a loop note onto a clean turn and names it
// `pinned`; with the switch off no record is emitted.
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
import type { FastDecisionPin } from '../../src/core/judge/fast/turnRecord'
import type { MuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import {
  closeLiveHosts,
  refuseUnscripted,
  startLiveSession,
  type LiveSession,
} from './helpers/museReplay'

afterEach(async () => {
  await closeLiveHosts()
})

const toolCall = (itemId: string, turnId: string): ItemSnapshot => ({
  itemId,
  kind: 'toolCall',
  status: 'completed',
  turnId,
  tool: 'shell',
  args: '{"command":"ls"}',
  visibleOutput: 'a.txt\n',
})

const reply = (turnId: string, text: string): ItemSnapshot => ({
  itemId: `reply-${turnId}`,
  kind: 'agentMessage',
  status: 'completed',
  turnId,
  text,
})

interface Driven {
  readonly live: LiveSession
  readonly inputs: unknown[]
  readonly events: AgentEvent[]
}

async function drive(
  feed: (session: MuseSession, sessionId: string) => void,
  features?: { isFastPathOff?: () => boolean; fastDecisionPin?: FastDecisionPin },
): Promise<Driven> {
  const inputs: unknown[] = []
  const live = await startLiveSession((method, params) => {
    if (method === 'turn/start') {
      inputs.push(params['input'])
      return refuseUnscripted(method)
    }
    throw new Error(`unexpected ${method}`)
  }, features)
  const events: AgentEvent[] = []
  live.session.onEvent((event) => {
    events.push(event)
  })
  feed(live.session, live.session.sessionId)
  await expect(live.session.sendTurn([{ type: 'text', text: 'ping' }])).rejects.toThrow()
  return { live, inputs, events }
}

const complete = (session: MuseSession, sessionId: string, calls: number): void => {
  for (let index = 0; index < calls; index += 1) {
    session.receive(
      {
        sessionId,
        event: { type: 'itemCompleted', item: toolCall(`call-${String(index)}`, 'turn-1') },
      },
      false,
    )
  }
  session.receive(
    { sessionId, event: { type: 'itemCompleted', item: reply('turn-1', 'Done.') } },
    false,
  )
  session.receive(
    { sessionId, event: { type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' } },
    false,
  )
}

const turnEvents = (events: readonly AgentEvent[]): AgentEvent[] =>
  events.filter((event) => event.type === 'judgeFastTurn')

describe('Muse Code turn record', () => {
  it('closes a looped turn with its record', async () => {
    const { events } = await drive((session, sessionId) => {
      complete(session, sessionId, 3)
    })
    expect(turnEvents(events)).toEqual([
      {
        type: 'judgeFastTurn',
        turnId: 'turn-1',
        backend: 'museCode',
        method: 'deterministic',
        decisions: [
          { decision: 'loop.stuck', evaluated: 3, raised: true, acted: true, reason: 'repeat' },
          {
            decision: 'failure.unmentioned',
            evaluated: 1,
            raised: false,
            acted: false,
            reason: 'absent',
          },
          {
            decision: 'done.unbacked',
            evaluated: 1,
            raised: false,
            acted: false,
            reason: 'no-claim',
          },
        ],
        judgeCalls: 0,
        judgeTokens: 0,
      },
    ])
  })

  it('forces a pinned loop note onto a clean turn', async () => {
    const { inputs, events } = await drive(
      (session, sessionId) => {
        complete(session, sessionId, 1)
      },
      { fastDecisionPin: () => true },
    )
    const [turn] = turnEvents(events)
    expect(turn).toMatchObject({
      decisions: expect.arrayContaining([
        { decision: 'loop.stuck', evaluated: 1, raised: true, acted: true, reason: 'pinned' },
      ]),
    })
    expect(JSON.stringify(inputs[0])).toContain('repeat the same call')
  })

  it('emits no record with the switch off', async () => {
    const { events } = await drive(
      (session, sessionId) => {
        complete(session, sessionId, 3)
      },
      { isFastPathOff: () => true },
    )
    expect(turnEvents(events)).toHaveLength(0)
  })
})
