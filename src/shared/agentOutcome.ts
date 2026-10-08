// D101: portable, structured evidence. These are our records, never new MSP fields.
import { AGENT_ACTIVITY_WINDOW_MS, UI_TEXT } from './constants'
import type { AgentEvidence, AgentOutcome, AgentReceipt } from './agentEvidence'

export interface AgentSignals {
  readonly status: string
  readonly controlStatus?: string | undefined
  readonly evidence?: AgentEvidence | undefined
}

export function agentStopReason(status: string): AgentReceipt['stopReason'] {
  switch (status) {
    case 'cancelled': {
      return 'cancelled'
    }
    case 'failed': {
      return 'error'
    }
    default: {
      return 'unknown'
    }
  }
}

/** A tool's exit is owned/captured proof; it never certifies an agent objective. */
export function toolAgentEvidence(status: string, exitCode?: number): AgentEvidence {
  const evidence: AgentEvidence = { stopReason: agentStopReason(status), finalCheck: 'unknown' }
  if (exitCode !== undefined) evidence.finalCheck = exitCode === 0 ? 'passed' : 'failed'
  return evidence
}

/** Cancellation is explicit; a final failed check wins over incompleteness. */
export function endedOutcome({ status, evidence }: AgentSignals): AgentOutcome {
  if (status === 'cancelled' || evidence?.stopReason === 'cancelled') return 'cancelled'
  if (status === 'failed' || evidence?.stopReason === 'error' || evidence?.finalCheck === 'failed')
    return 'failed'
  if (
    evidence?.stopReason === 'budget' ||
    evidence?.worktree === 'dirty' ||
    evidence?.reportedComplete === false ||
    (evidence?.unfinished?.length ?? 0) > 0 ||
    (evidence?.checksRequired === true && evidence.finalCheck === 'missing')
  )
    return 'incomplete'
  return evidence?.stopReason === 'normal' &&
    evidence.reportedComplete === true &&
    evidence.unfinished?.length === 0 &&
    (evidence.worktree === 'clean' || evidence.worktree === 'shared') &&
    evidence.finalCheck === 'passed'
    ? 'complete'
    : 'unverified'
}

export function agentActivity(agent: AgentSignals, now: number) {
  const control = agent.controlStatus
  const waiting =
    agent.evidence?.waiting ??
    (control === 'queued' || control === 'interrupted' ? control : undefined)
  if (waiting !== undefined) return { activity: 'waiting', reason: waiting } as const
  if (
    control === 'closed' ||
    control === 'resultReady' ||
    control === 'result_ready' ||
    ['completed', 'failed', 'cancelled'].includes(agent.status)
  )
    return { activity: 'inactive' } as const
  const recent = agent.evidence?.lastOutputAt
  if (
    agent.evidence?.inFlight === true ||
    (recent !== undefined && now >= recent && now - recent <= AGENT_ACTIVITY_WINDOW_MS)
  )
    return { activity: 'active' } as const
  // A captured running control state is the backend's in-flight report.
  return control === 'running' || control === 'working' || agent.status === 'inProgress'
    ? ({ activity: 'active' } as const)
    : ({ activity: 'waiting', reason: 'idle' } as const)
}

export function agentStateText(agent: AgentSignals, now: number): string {
  const state = agentActivity(agent, now)
  const text = UI_TEXT.agentActivities[state.activity]
  if (state.activity === 'waiting') return `${text}: ${UI_TEXT.agentWaitingReasons[state.reason]}`
  return state.activity === 'inactive'
    ? `${text} · ${UI_TEXT.agentOutcomes[endedOutcome(agent)]}`
    : text
}
