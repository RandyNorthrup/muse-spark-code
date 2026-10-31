// One worker port over every worker kind a surface can run (RLF-TEAMWORKERS,
// TEAMWIRE open question 2 as decided by the lead): the engine port and the
// process-worker ports (Muse Code, external ACP) sit side by side, and each
// task goes to the first port that can run its agent's kind. A kind no port
// claims stays unavailable: `canRun` answers false, never a silent fallback
// to another kind. Headless `exec --team` keeps its engine-only port and so
// keeps refusing non-engine workers by design (PLAN M96b).

import type { TeamAgentRef } from '../../../shared/team'
import { TEAM_MODEL_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { TeamWorkerPort } from '../teamHostService'

/** The composite `workers` port the host service drives, over `ports` in order. */
export function createCompositeTeamWorkerPort(ports: readonly TeamWorkerPort[]): TeamWorkerPort {
  const portFor = (agent: TeamAgentRef): TeamWorkerPort | undefined =>
    ports.find((port) => port.canRun(agent))
  const required = (agent: TeamAgentRef): TeamWorkerPort => {
    const port = portFor(agent)
    if (port === undefined)
      throw new Error(fill(TEAM_MODEL_TEXT.hostKindNotOffered, { kind: agent.kind }))
    return port
  }
  return {
    rates: (agent) => portFor(agent)?.rates?.(agent),
    canRun: (agent) => portFor(agent) !== undefined,
    probe: async (agent) => await required(agent).probe(agent),
    retirement: (taskId) => {
      for (const port of ports) {
        const proof = port.retirement?.(taskId)
        if (proof !== undefined) return proof
      }
      return
    },
    run: async (spec, signal) => await required(spec.entry.agent).run(spec, signal),
    isLimited: (agent) => portFor(agent)?.isLimited?.(agent) ?? false,
  }
}
