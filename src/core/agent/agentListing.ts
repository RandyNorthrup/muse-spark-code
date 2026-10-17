// Equal local inspection in ACP and the panel, based on captured/owned snapshots.
import { workflowChildSchema } from '../../shared/workflowChild'
import type { ItemSnapshot } from '../../shared/agentEvents'
import { agentStateText, toolAgentEvidence } from '../../shared/agentOutcome'
import {
  AGENT_RECEIPT_MAX_ROWS,
  UI_TEXT,
  WORKFLOW_CHILD_RUNNING_STATUSES,
} from '../../shared/constants'
import { redactSecrets } from '../../shared/redact'
import { fill, formatNumber } from '../../shared/l10n/text'

export function listedAgents(items: readonly ItemSnapshot[]): ItemSnapshot[] {
  return items.flatMap((item) => {
    if (item.kind === 'subagent') return [item]
    if (item.kind === 'toolCall' && item.background === true)
      return [{ ...item, agentEvidence: toolAgentEvidence(item.status, item.exitCode) }]
    if (item.kind !== 'workflow') return []
    return (item.children ?? []).flatMap((raw) => {
      const child = workflowChildSchema.safeParse(raw).data
      if (child === undefined) return []
      const reported = typeof child.terminal === 'string' ? child.terminal : child.status
      const status = WORKFLOW_CHILD_RUNNING_STATUSES.has(reported) ? 'inProgress' : reported
      return [
        {
          itemId: `${item.itemId}/${child.childId}`,
          kind: 'workflowAgent',
          status,
          controlStatus: child.status === 'scheduled' ? 'queued' : undefined,
          objective: typeof child.label === 'string' ? child.label : child.childId,
          agentEvidence: item.agentWorkflowEvidence?.[`${item.itemId}/${child.childId}`] ?? {
            attempt: child.attempt,
          },
        },
      ]
    })
  })
}

export function listedAgentId(item: ItemSnapshot): string {
  return item.subagentId ?? item.itemId
}

export function agentListingText(items: readonly ItemSnapshot[], now: number): string {
  const rows = listedAgents(items).slice(-AGENT_RECEIPT_MAX_ROWS)
  return rows.length === 0
    ? UI_TEXT.agentMapEmpty
    : rows
        .map(
          (item) =>
            `${listedAgentId(item)} · ${redactSecrets(item.objective ?? item.tool ?? UI_TEXT.agentUntitled)} · ${agentStateText({ status: item.status, controlStatus: item.controlStatus, evidence: item.agentEvidence }, now)}${item.agentEvidence?.attempt === undefined ? '' : ` · ${fill(UI_TEXT.workflowAttempt, { attempt: formatNumber(item.agentEvidence.attempt) })}`}`,
        )
        .join('\n')
}
