// M125 lane C (D107): the turn/start frame goldens through the real
// adapter and the replay wire (the SDK's real Connection, the recorded
// 1.4.7 capture's session, zero model calls). Off and on-but-abstaining
// send today's input bytes; a forced loop appends its hint at the tail
// and raises the stuck chip's event; no judge decision sends an effort
// frame. `turn/start` answers with the harness's loud refusal (no
// recorded result exists); the goldens pin the bytes the adapter sent.
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
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

interface Driven {
  readonly live: LiveSession
  readonly inputs: unknown[]
  readonly events: AgentEvent[]
}

async function drive(
  feed?: (session: MuseSession, sessionId: string) => void,
  features?: { isFastPathOff?: () => boolean },
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
  feed?.(live.session, live.session.sessionId)
  // The harness refuses turn/start loudly; the golden pins what was sent.
  await expect(live.session.sendTurn([{ type: 'text', text: 'ping' }])).rejects.toThrow()
  return { live, inputs, events }
}

const completes = (session: MuseSession, sessionId: string, isReplay: boolean): void => {
  for (const itemId of ['call-1', 'call-2', 'call-3']) {
    session.receive(
      {
        sessionId,
        event: { type: 'itemCompleted', item: toolCall(itemId, 'turn-1') },
      },
      isReplay,
    )
  }
}

describe('Muse Code turn goldens', () => {
  it('pins today’s turn/start input bytes', async () => {
    const { inputs } = await drive()
    expect(inputs).toHaveLength(1)
    expect(JSON.stringify(inputs[0])).toBe('[{"type":"text","text":"ping"}]')
  })

  it('red drill: a forced loop appends its hint and raises the chip, with no effort frame', async () => {
    const { live, inputs, events } = await drive((session, sessionId) => {
      completes(session, sessionId, false)
    })
    const stuck = events.filter((event) => event.type === 'judgeStuck')
    expect(stuck).toEqual([{ type: 'judgeStuck', pattern: 'repeat' }])
    expect(inputs).toHaveLength(1)
    expect(JSON.stringify(inputs[0])).toBe(
      '[{"type":"text","text":"ping"},{"type":"text","text":"The last three shell calls repeat the same call with the same result; try a different approach before calling it again."}]',
    )
    expect(live.wire.sentCount('session/setReasoningEffort')).toBe(0)
  })

  it('sends today’s bytes with the switch off, after the same loop', async () => {
    const { inputs, events } = await drive(
      (session, sessionId) => {
        completes(session, sessionId, false)
      },
      { isFastPathOff: () => true },
    )
    expect(events.filter((event) => event.type === 'judgeStuck')).toHaveLength(0)
    expect(inputs).toHaveLength(1)
    expect(JSON.stringify(inputs[0])).toBe('[{"type":"text","text":"ping"}]')
  })

  it('queues nothing from a replayed turn', async () => {
    const { inputs, events } = await drive((session, sessionId) => {
      completes(session, sessionId, true)
    })
    expect(events.filter((event) => event.type === 'judgeStuck')).toHaveLength(0)
    expect(inputs).toHaveLength(1)
    expect(JSON.stringify(inputs[0])).toBe('[{"type":"text","text":"ping"}]')
  })
})
