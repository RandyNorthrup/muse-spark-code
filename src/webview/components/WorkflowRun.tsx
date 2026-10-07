// A workflow run (M47, PLAN.md D40) as Muse Code reports it over MSP: its
// name, its status and what started it, its agents (label, state, time,
// tokens) and what it returned. Recovery controls explain the captured
// backend limit after owner confirmation. Pausing and resuming a run are the terminal UI's alone
// (no MSP verb), and a workflow agent keeps no
// session of its own to read, so there is no transcript to open. The
// transcript's card and the Agent map show this same view.

import { UI_TEXT, type SubagentAction } from '../../shared/constants'
import { AgentReceiptDisclosure } from './AgentReceiptBody'
import { buildAgentReceipt } from '../../shared/agentReceipt'
import { agentActivity, endedOutcome, agentStateText } from '../../shared/agentOutcome'
import { fill, plural } from '../../shared/l10n/text'
import { formatTokenWindow } from '../../shared/palette'
import { agentStatusLabel, formatDurationMs } from '../agentFormat'
import type { WorkflowChild, WorkflowEntry } from '../state/uiState'
import {
  childName,
  childStatusLabel,
  isChildRunning,
  triggerSourceLabel,
  workflowName,
  workflowOutcome,
  workflowTokens,
} from '../workflowDetails'
import { Clipped } from './ToolBlocks'
import { useAgentClock } from '../useAgentClock'

const RUNNING = 'inProgress'
const COMPLETED = 'completed'
const DOT = 'tool-dot'
const DOT_OK = 'tool-dot tool-dot-ok'
const DOT_FAILED = 'tool-dot tool-dot-failed'
const DOT_RUNNING = 'tool-dot tool-dot-running'
const FAILED_STATUSES: ReadonlySet<string> = new Set(['failed', 'cancelled'])

function runDot(status: string): string {
  if (status === RUNNING) {
    return DOT_RUNNING
  }
  if (status === COMPLETED) {
    return DOT_OK
  }
  return FAILED_STATUSES.has(status) ? DOT_FAILED : DOT
}

/** An agent's mark: its outcome once it ended, running, or waiting its turn. */
function agentDot(child: WorkflowChild): string {
  const outcome =
    child.terminal ??
    (child.status === COMPLETED || FAILED_STATUSES.has(child.status) ? child.status : undefined)
  if (outcome !== undefined) {
    if (outcome === COMPLETED) {
      return DOT_OK
    }
    return FAILED_STATUSES.has(outcome) ? DOT_FAILED : DOT
  }
  return isChildRunning(child) ? DOT_RUNNING : DOT
}

function tokensText(tokens: number): string {
  return fill(UI_TEXT.agentTokens, { tokens: formatTokenWindow(tokens) })
}

function joined(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined).join(' · ')
}

function agentMeta(child: WorkflowChild, now: number): string {
  return joined([
    child.attempt > 1 ? fill(UI_TEXT.workflowAttempt, { attempt: child.attempt }) : undefined,
    child.durationMs === undefined ? undefined : formatDurationMs(child.durationMs),
    child.usage === undefined
      ? undefined
      : tokensText(child.usage.inputTokens + child.usage.outputTokens),
    childStatusLabel(child),
    agentStateText(
      {
        status: child.terminal ?? (isChildRunning(child) ? 'inProgress' : child.status),
        controlStatus: child.status === 'scheduled' ? 'queued' : undefined,
        evidence: child.agentEvidence,
      },
      now,
    ),
  ])
}

function WorkflowAgent({
  child,
  index,
  onControl,
  entryId,
}: {
  readonly child: WorkflowChild
  readonly index: number
  readonly entryId: string
  readonly onControl: ((id: string, action: SubagentAction) => void) | undefined
}) {
  const now = useAgentClock()
  const name = childName(child, index)
  const signals = {
    status: child.terminal ?? (isChildRunning(child) ? 'inProgress' : child.status),
    controlStatus: child.status === 'scheduled' ? 'queued' : undefined,
    evidence: child.agentEvidence,
  }
  const isEnded = agentActivity(signals, now).activity === 'inactive'
  const outcome = endedOutcome(signals)
  const isRecoverable = isEnded && (outcome === 'failed' || outcome === 'incomplete')
  return (
    <li className="workflow-agent">
      <span className={agentDot(child)} aria-hidden="true" />
      <span className="workflow-agent-name" dir="auto">
        {name}
      </span>
      <span className="workflow-agent-meta" aria-live="polite">
        {agentMeta(child, now)}
      </span>
      {isEnded ? (
        <AgentReceiptDisclosure
          attempts={child.agentEvidence?.attempts?.slice(0, -1)}
          readReceipt={() =>
            child.agentEvidence?.attempts?.at(-1)?.receipt ??
            buildAgentReceipt([], child.agentEvidence)
          }
        />
      ) : null}
      {isRecoverable && onControl !== undefined ? (
        <div className="agent-control-row">
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onControl(`${entryId}/${child.childId}`, 'continue')
            }}
          >
            {UI_TEXT.agentContinue}
          </button>
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onControl(`${entryId}/${child.childId}`, 'retry')
            }}
          >
            {UI_TEXT.agentRetry}
          </button>
        </div>
      ) : null}
    </li>
  )
}

export function WorkflowRunView({
  entry,
  onControl,
}: {
  readonly entry: WorkflowEntry
  readonly onControl?: ((id: string, action: SubagentAction) => void) | undefined
}) {
  const outcome = workflowOutcome(entry.message)
  const tokens = workflowTokens(entry)
  const name = workflowName(entry)
  const meta = joined([
    agentStatusLabel(entry.status),
    entry.children.length === 0 ? undefined : plural(UI_TEXT.agentsCount, entry.children.length),
    tokens === undefined ? undefined : tokensText(tokens),
    entry.triggerSource === undefined ? undefined : triggerSourceLabel(entry.triggerSource),
  ])
  return (
    <>
      <div className="workflow-header">
        <span className={runDot(entry.status)} aria-hidden="true" />
        <span className="workflow-label">{UI_TEXT.workflowRowLabel}</span>
        <span className="workflow-name" dir="auto" title={name}>
          {name}
        </span>
      </div>
      <div className="workflow-meta">{meta}</div>
      {entry.children.length === 0 ? null : (
        <ul className="workflow-agents" aria-label={UI_TEXT.workflowAgentsLabel}>
          {entry.children.map((child, index) => (
            <WorkflowAgent
              key={child.childId}
              child={child}
              index={index}
              entryId={entry.id}
              onControl={onControl}
            />
          ))}
        </ul>
      )}
      {outcome?.summary === undefined ? null : (
        <div className="workflow-result">
          <span className="workflow-result-label">{UI_TEXT.agentResultText}</span>
          <Clipped text={outcome.summary} className="tool-output" />
        </div>
      )}
      {outcome?.failure === undefined ? null : (
        <div className="tool-failure">
          {UI_TEXT.toolFailed}: {outcome.failure}
        </div>
      )}
    </>
  )
}
