// The ACP agent's child-work admission (M116, PLAN.md D215): `/agents
// continue|retry` through the same `SubagentAdmission` port the Model API
// host consults, as a `delegate` round. The decision is the hosts'
// capacity (D213): the M107 governor's latest reading pauses the resume
// only at its paused level, where the governor itself pauses new work;
// unknown never pauses work (owner rule). No journal is read or written:
// ACP sessions hold no module rounds (no runtime writer records a
// module), so there are no standings to evaluate — the same outcome as
// the governor's empty-standings path, which runs the effect with no
// journal touch. The round covers the control call; the wait honors
// `isOver` for callers that hold it open.
import type { SubagentAdmission } from '../../core/backends/modelapi/subagentTools'
import type { ReadingHolder } from '../../core/orchestration/playbook/readingHolder'
import { UI_TEXT } from '../../shared/l10n/text'
import type { ResourceStatus } from '../../shared/resources'

/** The port's English reason: fixed words, the rule and the pause it fired. */
export const SUBAGENT_PAUSED_REASON = 'Child work refused: the resource governor paused new work.'

export interface SubagentAdmissionDeps {
  /** The holder the decision reads; refreshed from `readResourceStatus` on every call. */
  readonly holder: Pick<ReadingHolder<ResourceStatus>, 'get' | 'refresh'>
  /** The latest M107 governor reading, or undefined while unknown. */
  readonly readResourceStatus: () => Promise<ResourceStatus | undefined>
}

export function createSubagentAdmission(deps: SubagentAdmissionDeps): SubagentAdmission {
  return async (_kind, _sessionId, _targetId, effect, isOver, refused) => {
    await deps.holder.refresh(deps.readResourceStatus)
    if (deps.holder.get()?.level === 'pause')
      return refused(SUBAGENT_PAUSED_REASON, UI_TEXT.agentResumePaused)
    const outcome = await effect()
    await new Promise<void>((resolve) => {
      const wake = (): void => {
        if (isOver(wake)) resolve()
      }
      wake()
    })
    return outcome
  }
}
