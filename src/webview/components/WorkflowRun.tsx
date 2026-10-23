// A workflow run (M47, PLAN.md D40) as Muse Code reports it over MSP: its
// name, its status and what started it, its agents (label, state, time,
// tokens) and what it returned. A live run offers Cancel, Pause and
// Resume, a running agent Skip and Retry (RLF-M47, captured live
// 2026-10-23); recovery controls on an ended agent explain the captured
// backend limit after owner confirmation. A workflow agent keeps no
// session of its own to read, so there is no transcript to open. The
// transcript's card and the Agent map show this same view.

import { UI_TEXT, type SubagentAction, type WorkflowControl } from '../../shared/constants'
import { AgentReceiptDisclosure } from './AgentReceiptBody'
import { buildAgentReceipt } from '../../shared/agentReceipt'
import { agentActivity, endedOutcome, agentStateText } from '../../shared/agentOutcome'
import { fill, formatTokenWindow, plural } from '../../shared/l10n/text'
import { agentStatusLabel, formatDurationMs } from '../agentFormat'
import type { WorkflowChild, WorkflowEntry } from '../state/uiState'
import {
  childName,
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
    // One true status: the derived activity and outcome, never the raw
    // child status beside it (RLTESTDRIVE item 1).
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

/** Drive one run from its card: the run, the control, and the agent for a child control. */
export type WorkflowControlHandler = (
  workflowRunId: string,
  control: WorkflowControl,
  childId?: string,
  childLabel?: string,
) => void

function WorkflowAgent({
  child,
  index,
  onControl,
  entryId,
  workflowRunId,
  onWorkflowControl,
}: {
  readonly child: WorkflowChild
  readonly index: number
  readonly entryId: string
  readonly onControl: ((id: string, action: SubagentAction) => void) | undefined
  readonly workflowRunId: string | undefined
  readonly onWorkflowControl: WorkflowControlHandler | undefined
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
  // Skip and Retry drive the in-flight attempt only; a scheduled or
  // ended agent has none (RLF-M47). The run id addresses the command.
  const canDriveChild = onWorkflowControl !== undefined && workflowRunId !== undefined
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
      {canDriveChild && isChildRunning(child) ? (
        <div className="agent-control-row">
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onWorkflowControl(workflowRunId, 'skip', child.childId, name)
            }}
          >
            {UI_TEXT.workflowSkip}
          </button>
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onWorkflowControl(workflowRunId, 'retry', child.childId, name)
            }}
          >
            {UI_TEXT.agentRetry}
          </button>
        </div>
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
  onWorkflowControl,
}: {
  readonly entry: WorkflowEntry
  readonly onControl?: ((id: string, action: SubagentAction) => void) | undefined
  readonly onWorkflowControl?: WorkflowControlHandler | undefined
}) {
  const outcome = workflowOutcome(entry.message)
  const tokens = workflowTokens(entry)
  const name = workflowName(entry)
  // The wire reports a paused run inProgress still; the card's own mark
  // says paused and offers Resume instead of Pause (RLF-M47).
  const isPaused = entry.pausedByUser === true
  const meta = joined([
    isPaused ? UI_TEXT.workflowPaused : agentStatusLabel(entry.status),
    entry.children.length === 0 ? undefined : plural(UI_TEXT.agentsCount, entry.children.length),
    tokens === undefined ? undefined : tokensText(tokens),
    entry.triggerSource === undefined ? undefined : triggerSourceLabel(entry.triggerSource),
  ])
  const runId = entry.workflowRunId
  const canDriveRun =
    onWorkflowControl !== undefined && runId !== undefined && entry.status === RUNNING
  return (
    <>
      <div className="workflow-header">
        <span className={isPaused ? DOT : runDot(entry.status)} aria-hidden="true" />
        <span className="workflow-label">{UI_TEXT.workflowRowLabel}</span>
        <span className="workflow-name" dir="auto" title={name}>
          {name}
        </span>
      </div>
      <div className="workflow-meta">{meta}</div>
      {canDriveRun ? (
        <div className="agent-control-row">
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onWorkflowControl(runId, isPaused ? 'resume' : 'pause')
            }}
          >
            {isPaused ? UI_TEXT.agentResume : UI_TEXT.workflowPause}
          </button>
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onWorkflowControl(runId, 'cancel')
            }}
          >
            {UI_TEXT.workflowCancel}
          </button>
        </div>
      ) : null}
      {entry.children.length === 0 ? null : (
        <ul className="workflow-agents" aria-label={UI_TEXT.workflowAgentsLabel}>
          {entry.children.map((child, index) => (
            <WorkflowAgent
              // A retry schedules N+1 beside terminal N under one childId (RLF-M47).
              key={`${child.childId}/${String(child.attempt)}`}
              child={child}
              index={index}
              entryId={entry.id}
              onControl={onControl}
              workflowRunId={entry.workflowRunId}
              onWorkflowControl={onWorkflowControl}
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
