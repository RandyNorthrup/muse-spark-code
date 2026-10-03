// A session's events with a wait for its next turn's end, shared by the
// suites that drive `ModelApiHost` directly.

import type { AgentEvent } from '../../../src/shared/agentEvents'
import type { AgentSession } from '../../../src/core/agent/agentBackend'

/** A session's events, and a wait for its next turn's end. */
export function watchSessionTurns(session: AgentSession): {
  events: AgentEvent[]
  turnDone: () => Promise<void>
} {
  const events: AgentEvent[] = []
  let done = Promise.withResolvers<undefined>()
  session.onEvent((event) => {
    events.push(event)
    if (event.type !== 'turnCompleted') {
      return
    }
    done.resolve(undefined)
    done = Promise.withResolvers<undefined>()
  })
  return { events, turnDone: () => done.promise }
}
