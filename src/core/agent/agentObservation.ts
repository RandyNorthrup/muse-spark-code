// Keep outcomes we observed; absence in a later native snapshot never erases history.
import type { ItemSnapshot, TodoItem } from '../../shared/agentEvents'
import {
  agentActivity,
  endedOutcome,
  agentStopReason,
  type AgentEvidence,
} from '../../shared/agentOutcome'
import { buildAgentReceipt } from '../../shared/agentReceipt'
import { listedAgents } from './agentListing'
import { finishedAgentEvidence } from './agentEvidence'

/** Reading a child can add check/unfinished proof; a native normal stop stays unknown. */
export function observeChildReceipt(
  parent: ItemSnapshot,
  items: readonly ItemSnapshot[],
  todos: readonly TodoItem[],
): ItemSnapshot {
  const before = parent.agentEvidence
  const last = before?.attempts?.at(-1)
  if (last === undefined) return parent
  const turnId = items.findLast((item) => item.turnId !== undefined)?.turnId
  const current = turnId === undefined ? items : items.filter((item) => item.turnId === turnId)
  const evidence: AgentEvidence = {
    ...before,
    ...finishedAgentEvidence(current, todos, before?.stopReason ?? 'unknown', []),
    worktree: 'unknown',
  }
  const receipt = buildAgentReceipt(
    current,
    evidence,
    parent.result?.text ?? parent.result?.summary,
  )
  evidence.attempts = [
    ...(before?.attempts ?? []).slice(0, -1),
    { number: last.number, outcome: endedOutcome({ status: parent.status, evidence }), receipt },
  ]
  return { ...parent, agentEvidence: evidence }
}

function observedEvidence(
  before: AgentEvidence | undefined,
  item: ItemSnapshot,
  now: number,
): AgentEvidence {
  const isInactive =
    agentActivity({ status: item.status, controlStatus: item.controlStatus }, now).activity ===
    'inactive'
  const previous = before?.attempts ?? []
  const last = previous.at(-1)
  const attempt = item.agentEvidence?.attempt ?? before?.attempt ?? 1
  const number =
    !isInactive && item.agentEvidence?.attempt === undefined && last?.number === attempt
      ? attempt + 1
      : attempt
  const evidence: AgentEvidence = {
    ...(isInactive && last?.number === number && before),
    attempt: number,
    attempts: previous,
  }
  if (!isInactive) return evidence
  evidence.stopReason = agentStopReason(item.status)
  const snapshotReceipt = buildAgentReceipt(
    [item],
    evidence,
    item.result?.text ?? item.result?.summary,
  )
  const receipt =
    last?.number === number
      ? {
          ...last.receipt,
          stopReason: evidence.stopReason,
          finalMessage: snapshotReceipt.finalMessage || last.receipt.finalMessage,
        }
      : snapshotReceipt
  const record = { number, outcome: endedOutcome({ status: item.status, evidence }), receipt }
  evidence.attempts =
    last?.number === number ? [...previous.slice(0, -1), record] : [...previous, record]
  return evidence
}

/** Uses only existing M14/M18/M47 fields; owned evidence lives outside the wire schema. */
export function observeAgentItem(
  before: ItemSnapshot | undefined,
  item: ItemSnapshot,
  now: number,
): ItemSnapshot {
  if (item.kind === 'subagent' && item.agentEvidence === undefined) {
    const isRestarted =
      before !== undefined &&
      agentActivity({ status: before.status, controlStatus: before.controlStatus }, now)
        .activity === 'inactive' &&
      agentActivity({ status: item.status, controlStatus: item.controlStatus }, now).activity !==
        'inactive'
    const merged = {
      ...before,
      ...item,
      controlStatus: item.controlStatus ?? (isRestarted ? undefined : before?.controlStatus),
      agentEvidence: undefined,
      result: item.result ?? (isRestarted ? undefined : before?.result),
    }
    return { ...merged, agentEvidence: observedEvidence(before?.agentEvidence, merged, now) }
  }
  if (item.kind !== 'workflow') return item
  const agentWorkflowEvidence = { ...before?.agentWorkflowEvidence }
  for (const child of listedAgents([item])) {
    const id = child.itemId
    agentWorkflowEvidence[id] = observedEvidence(agentWorkflowEvidence[id], child, now)
  }
  return { ...item, agentWorkflowEvidence }
}
