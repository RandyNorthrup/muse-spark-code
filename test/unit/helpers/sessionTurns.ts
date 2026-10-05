// A session's events with a wait for its next turn's end, shared by the
// suites that drive `ModelApiHost` directly.

import type { AgentEvent } from '../../../src/shared/agentEvents'
import type { AgentSession } from '../../../src/core/agent/agentBackend'
import {
  type ModelApiHost,
  ModelApiSession,
} from '../../../src/core/backends/modelapi/ModelApiHost'

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

/** A Model API session on the contributor-free test model, with its events watched. */
export async function startWatchedSession(
  host: ModelApiHost,
  workspaceRoot: string,
  approvalMode: string,
): Promise<{ session: ModelApiSession; events: AgentEvent[]; turnDone: () => Promise<void> }> {
  const session = await host.startSession({
    workspaceRoot,
    modelId: 'muse-spark-1.3',
    approvalMode,
  })
  if (!(session instanceof ModelApiSession)) throw new Error('expected a Model API session')
  return { session, ...watchSessionTurns(session) }
}
