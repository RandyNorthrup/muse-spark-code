// A workflow run (M47, PLAN.md D40) as Muse Code reports it over MSP: its
// name, its status and what started it, its agents (label, state, time,
// tokens), what it returned, and the controls MSP offers: cancel the run,
// skip or retry an agent that is running. Pausing and resuming a run are
// the terminal UI's alone (no MSP verb), and a workflow agent keeps no
// session of its own to read, so there is no transcript to open. The
// transcript's card and the Agent map show this same view.

import { UI_TEXT, type WorkflowChildAction } from '../../shared/constants'
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

export interface WorkflowControls {
  /** Cancel the run (MSP `workflow/cancel`). */
  readonly onCancelWorkflow?: ((workflowRunId: string) => void) | undefined
  /** Skip or retry one agent's current attempt (MSP `workflow/childControl`). */
  readonly onControlWorkflowChild?:
    | ((
        workflowRunId: string,
        childId: string,
        attempt: number,
        action: WorkflowChildAction,
      ) => void)
    | undefined
}

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

function agentMeta(child: WorkflowChild): string {
  return joined([
    child.phase,
    child.attempt > 1 ? fill(UI_TEXT.workflowAttempt, { attempt: child.attempt }) : undefined,
    child.durationMs === undefined ? undefined : formatDurationMs(child.durationMs),
    child.usage === undefined
      ? undefined
      : tokensText(child.usage.inputTokens + child.usage.outputTokens),
    childStatusLabel(child),
  ])
}

function WorkflowAgent({
  child,
  index,
  workflowRunId,
  onControl,
}: {
  readonly child: WorkflowChild
  readonly index: number
  /** Set while the run is live and can be controlled. */
  readonly workflowRunId: string | undefined
  readonly onControl: WorkflowControls['onControlWorkflowChild']
}) {
  const name = childName(child, index)
  const control = (action: WorkflowChildAction) => () => {
    if (workflowRunId !== undefined) {
      onControl?.(workflowRunId, child.childId, child.attempt, action)
    }
  }
  const canControl = workflowRunId !== undefined && onControl !== undefined && isChildRunning(child)
  return (
    <li className="workflow-agent">
      <span className={agentDot(child)} aria-hidden="true" />
      <span className="workflow-agent-name" dir="auto">
        {name}
      </span>
      <span className="workflow-agent-meta">{agentMeta(child)}</span>
      {canControl ? (
        <span className="workflow-agent-controls">
          <button
            type="button"
            className="tool-more"
            aria-label={fill(UI_TEXT.workflowSkipChild, { child: name })}
            onClick={control('skip')}
          >
            {UI_TEXT.workflowSkip}
          </button>
          <button
            type="button"
            className="tool-more"
            aria-label={fill(UI_TEXT.workflowRetryChild, { child: name })}
            onClick={control('retry')}
          >
            {UI_TEXT.workflowRetry}
          </button>
        </span>
      ) : null}
    </li>
  )
}

export function WorkflowRunView({
  entry,
  onCancelWorkflow,
  onControlWorkflowChild,
}: { readonly entry: WorkflowEntry } & WorkflowControls) {
  const isRunning = entry.status === RUNNING
  const outcome = workflowOutcome(entry.message)
  const tokens = workflowTokens(entry)
  const name = workflowName(entry)
  // Only a live run with its handle can be controlled.
  const liveRunId = isRunning ? entry.workflowRunId : undefined
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
              workflowRunId={liveRunId}
              onControl={onControlWorkflowChild}
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
      {liveRunId === undefined || onCancelWorkflow === undefined ? null : (
        <div className="workflow-actions">
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onCancelWorkflow(liveRunId)
            }}
          >
            {UI_TEXT.workflowCancel}
          </button>
        </div>
      )}
    </>
  )
}
