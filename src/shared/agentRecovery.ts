import { endedOutcome, agentActivity, type AgentSignals, type AgentReceipt } from './agentOutcome'
import { UI_TEXT } from './constants'
import type { ItemSnapshot } from './agentEvents'

/** Elapsed time/usage can advance during a dialog without changing recovery authority. */
export function recoveryStamp(item: ItemSnapshot | undefined): string {
  return JSON.stringify({
    itemId: item?.itemId,
    subagentId: item?.subagentId,
    childSessionId: item?.childSessionId,
    objective: item?.objective,
    status: item?.status,
    controlStatus: item?.controlStatus,
    evidence: item?.agentEvidence,
  })
}

/** Every current child shares a workspace or lacks a captured checkpoint. */
export function recoveryRefusal(
  agent: AgentSignals,
  action: 'continue' | 'retry',
  now: number,
): string | undefined {
  if (action === 'retry') return UI_TEXT.agentRetryUnavailable
  const outcome = endedOutcome(agent)
  return agentActivity(agent, now).activity !== 'inactive' ||
    (outcome !== 'failed' && outcome !== 'incomplete')
    ? UI_TEXT.agentContinueUnavailable
    : undefined
}

/** Failure is context; the original objective follows byte-for-byte unchanged. */
export function continuationNote(receipt: AgentReceipt, objective: string, prefix: string): string {
  return `${prefix}\n${JSON.stringify({ stopReason: receipt.stopReason, unfinished: receipt.unfinished, checks: receipt.checks })}\n\n${objective}`
}
