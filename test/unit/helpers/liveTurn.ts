// One turn through a live Muse session (museReplay.ts: the SDK's real
// Connection over the recorded 1.4.7 capture, zero model calls), for
// the fast judge's turn suites. `turn/start` answers with the harness's
// loud refusal (no recorded result exists), so a drive records the
// input bytes the adapter sent and the events the session emitted.
import { expect } from 'vitest'
import type {
  MuseCodeFeaturePorts,
  MuseSession,
} from '../../../src/core/backends/musecode/MuseCodeHost'
import type { AgentEvent, ItemSnapshot } from '../../../src/shared/agentEvents'
import { refuseUnscripted, startLiveSession, type LiveSession } from './museReplay'

/** A completed `ls` shell call with its visible output. */
export const toolCall = (itemId: string, turnId: string): ItemSnapshot => ({
  itemId,
  kind: 'toolCall',
  status: 'completed',
  turnId,
  tool: 'shell',
  args: '{"command":"ls"}',
  visibleOutput: 'a.txt\n',
})

export interface Driven {
  readonly live: LiveSession
  readonly inputs: unknown[]
  readonly events: AgentEvent[]
}

/** Feeds the session, then sends `ping`: `turn/start` is refused and its input recorded. */
export async function drive(
  feed?: (session: MuseSession, sessionId: string) => void,
  features?: MuseCodeFeaturePorts,
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
