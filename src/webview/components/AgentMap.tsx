// The Agent map (PLAN.md D17), as Claude Code's: this conversation on the
// left, the subagents it spawned on the right (objective, role, status,
// duration, tokens), the workflow runs and their agents (M47), the
// background tasks below, and a click on an agent for its own transcript,
// read from the child session the CLI keeps for it. What Muse Code's
// settings file says about delegation and workflows is noted, with the file
// a click away; the extension never edits it.

import { useState } from 'react'
import {
  SUBAGENT_CLOSED,
  SUBAGENT_RESULT_READY,
  SUBAGENT_RUNNING_STATUSES,
  type SubagentAction,
  UI_TEXT,
  USER_SHELL_PREFIX,
} from '../../shared/constants'
import type { TokenUsage } from '../../shared/agentEvents'
import { fill, plural } from '../../shared/l10n/text'
import { formatTokenWindow } from '../../shared/palette'
import {
  type ChildTranscript,
  isRunningTask,
  type TranscriptEntry,
  type WorkflowEntry,
} from '../state/uiState'
import { describeTool } from '../toolPresentation'
import { agentStatusLabel, formatDurationMs } from '../agentFormat'
import { workflowName, workflowTriggerText } from '../workflowDetails'
import { Modal } from './Modal'
import { type WorkflowControls, WorkflowRunView } from './WorkflowRun'

export type SubagentEntry = Extract<TranscriptEntry, { kind: 'subagent' }>
export type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>

export interface AgentMapProps {
  readonly title: string
  readonly modelId: string | undefined
  readonly contextUsedTokens: number | undefined
  readonly agents: readonly SubagentEntry[]
  readonly backgroundTasks: readonly ToolEntry[]
  /** Muse Code's `run.subagent_delegation_mode`; undefined on the Model API backend. */
  readonly delegationMode: string | undefined
  readonly isDelegationEnabled: boolean
  readonly childTranscripts: Readonly<Record<string, ChildTranscript>>
  readonly selectedAgentId: string | undefined
  readonly onSelectAgent: (agentId: string | undefined) => void
  readonly onReadChild: (childSessionId: string) => void
  /** Owner controls on an agent (M18): interrupt, stop, resume, close. */
  readonly onControl: (subagentId: string, action: SubagentAction) => void
  /** A note to a running agent, or a follow-up task for a finished one (M18). */
  readonly onMessage: (subagentId: string, body: string, isFollowup: boolean) => void
  /** Stop one background task, or all of them (M46). */
  readonly onStopTask: (itemId: string) => void
  readonly onStopAllTasks: () => void
  readonly onOpenMuseSettings: () => void
  readonly onClose: () => void
  /** This conversation's workflow runs (M47), with their controls. */
  readonly workflows: readonly WorkflowEntry[]
  /** Muse Code's `run.workflow_trigger_mode`; undefined on the Model API backend. */
  readonly workflowTriggerMode: string | undefined
  readonly onCancelWorkflow: WorkflowControls['onCancelWorkflow']
  readonly onControlWorkflowChild: WorkflowControls['onControlWorkflowChild']
}

/** Which owner controls an agent's state allows (M18); none once it is closed. */
export function controlsFor(agent: SubagentEntry): readonly SubagentAction[] {
  if (agent.subagentId === undefined || agent.controlStatus === SUBAGENT_CLOSED) {
    return []
  }
  if (agent.controlStatus === SUBAGENT_RESULT_READY || agent.status !== RUNNING) {
    return ['close']
  }
  const isRunning =
    agent.controlStatus === undefined || SUBAGENT_RUNNING_STATUSES.has(agent.controlStatus)
  return [isRunning ? 'interrupt' : 'resume', 'stop']
}

function controlLabel(action: SubagentAction): string {
  const labels: Readonly<Record<SubagentAction, string>> = {
    interrupt: UI_TEXT.agentInterrupt,
    stop: UI_TEXT.agentStop,
    resume: UI_TEXT.agentResume,
    close: UI_TEXT.agentClose,
  }
  return labels[action]
}

function AgentControls({
  agent,
  onControl,
  onMessage,
}: {
  readonly agent: SubagentEntry
  readonly onControl: AgentMapProps['onControl']
  readonly onMessage: AgentMapProps['onMessage']
}) {
  const [body, setBody] = useState('')
  const controls = controlsFor(agent)
  const { subagentId } = agent
  if (subagentId === undefined || controls.length === 0) {
    return null
  }
  const isFollowup = !controls.includes('interrupt')
  const send = () => {
    if (body.trim() === '') {
      return
    }
    onMessage(subagentId, body.trim(), isFollowup)
    setBody('')
  }
  return (
    <div className="agent-controls" role="group" aria-label={UI_TEXT.agentControlsLabel}>
      <div className="agent-control-row">
        {controls.map((action) => (
          <button
            key={action}
            type="button"
            className="tool-more"
            onClick={() => {
              onControl(subagentId, action)
            }}
          >
            {controlLabel(action)}
          </button>
        ))}
      </div>
      <div className="agent-message-form">
        <input
          className="question-input agent-message-input"
          type="text"
          aria-label={isFollowup ? UI_TEXT.agentFollowup : UI_TEXT.agentSendMessage}
          placeholder={UI_TEXT.agentMessagePlaceholder}
          value={body}
          onChange={(event) => {
            setBody(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') {
              return
            }
            event.preventDefault()
            send()
          }}
        />
        <button type="button" className="tool-more" disabled={body.trim() === ''} onClick={send}>
          {isFollowup ? UI_TEXT.agentFollowup : UI_TEXT.agentSendMessage}
        </button>
      </div>
    </div>
  )
}

const RUNNING = 'inProgress'

/** The figure the map shows for an agent: its input and output tokens together. */
function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens
}

function agentTokens(agent: SubagentEntry): string | undefined {
  return agent.usage === undefined
    ? undefined
    : fill(UI_TEXT.agentTokens, { tokens: formatTokenWindow(totalTokens(agent.usage)) })
}

function agentMeta(agent: SubagentEntry): string {
  return [
    agent.durationMs === undefined ? undefined : formatDurationMs(agent.durationMs),
    agentTokens(agent),
    agentStatusLabel(
      agent.status === RUNNING ? agent.status : (agent.controlStatus ?? agent.status),
    ),
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
}

function statusClassOf(status: string): string {
  if (status === RUNNING) {
    return 'agent-dot agent-dot-running'
  }
  return status === 'completed' ? 'agent-dot agent-dot-done' : 'agent-dot agent-dot-failed'
}

function AgentNode({
  agent,
  onSelect,
}: {
  readonly agent: SubagentEntry
  readonly onSelect: () => void
}) {
  return (
    <button type="button" className="agent-node agent-node-clickable" onClick={onSelect}>
      <span className="agent-node-title">
        <span className={statusClassOf(agent.status)} aria-hidden="true" />
        {agent.objective ?? agent.role ?? UI_TEXT.agentUntitled}
      </span>
      <span className="agent-node-meta">{agentMeta(agent)}</span>
    </button>
  )
}

function entryText(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case 'user':
    case 'assistant':
    case 'error':
    case 'notice': {
      return entry.text
    }
    case 'tool': {
      return `${entry.tool}${entry.args === '' ? '' : ` ${entry.args}`}`
    }
    case 'userShell': {
      return `${USER_SHELL_PREFIX}${entry.command}`
    }
    case 'reasoning': {
      return entry.parts.join('\n')
    }
    case 'subagent': {
      return entry.objective ?? entry.role ?? UI_TEXT.agentUntitled
    }
    case 'workflow': {
      return workflowName(entry)
    }
    case 'item': {
      return entry.text ?? entry.status
    }
  }
}

function AgentDetails({
  agent,
  transcript,
  onBack,
  onControl,
  onMessage,
}: {
  readonly agent: SubagentEntry
  readonly transcript: ChildTranscript | undefined
  readonly onBack: () => void
  readonly onControl: AgentMapProps['onControl']
  readonly onMessage: AgentMapProps['onMessage']
}) {
  let body
  if (agent.childSessionId === undefined) {
    body = <p className="usage-row-meta">{UI_TEXT.agentNoTranscript}</p>
  } else if (transcript === undefined) {
    body = <p className="usage-row-meta">{UI_TEXT.agentTranscriptLoading}</p>
  } else if (transcript.entries.length === 0) {
    body = <p className="usage-row-meta">{UI_TEXT.agentNoTranscript}</p>
  } else {
    body = (
      <ul className="agent-transcript" aria-label={UI_TEXT.agentTranscriptLabel}>
        {transcript.entries.map((entry) => (
          <li key={entry.id} className={`agent-transcript-row agent-transcript-${entry.kind}`}>
            <span className="agent-transcript-kind">{entry.kind}</span>
            <span className="agent-transcript-text">{entryText(entry)}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <section className="agent-details" aria-label={agent.objective ?? UI_TEXT.agentUntitled}>
      <button type="button" className="tool-more" onClick={onBack}>
        {UI_TEXT.agentBack}
      </button>
      <h3 className="agent-details-title">
        {agent.objective ?? agent.role ?? UI_TEXT.agentUntitled}
      </h3>
      <p className="usage-row-meta">
        {[
          agent.role === undefined ? undefined : `${UI_TEXT.agentRole} ${agent.role}`,
          agentMeta(agent),
        ]
          .filter((part) => part !== undefined)
          .join(' · ')}
      </p>
      <AgentControls agent={agent} onControl={onControl} onMessage={onMessage} />
      {agent.resultSummary === undefined ? null : (
        <p className="agent-result">{agent.resultSummary}</p>
      )}
      {agent.resultText === undefined || agent.resultText === agent.resultSummary ? null : (
        <pre className="agent-result-text" aria-label={UI_TEXT.agentResultText}>
          {agent.resultText}
        </pre>
      )}
      {body}
    </section>
  )
}

/**
 * The conversation's background tasks (M14), each with its Stop while it
 * runs and one Stop all (M46): the row says what the task is, as its
 * transcript row does, and how it stands.
 */
function BackgroundTasks({
  tasks,
  onStopTask,
  onStopAllTasks,
}: {
  readonly tasks: readonly ToolEntry[]
  readonly onStopTask: (itemId: string) => void
  readonly onStopAllTasks: () => void
}) {
  const running = tasks.filter((task) => isRunningTask(task))
  return (
    <>
      <div className="agent-tasks-header">
        <p className="usage-row-meta">{plural(UI_TEXT.backgroundTasksCount, tasks.length)}</p>
        {running.length === 0 ? null : (
          <button
            type="button"
            className="tool-more"
            title={UI_TEXT.stopAllTasksTitle}
            onClick={onStopAllTasks}
          >
            {UI_TEXT.stopAllTasks}
          </button>
        )}
      </div>
      <ul className="agent-tasks" aria-label={UI_TEXT.backgroundTasksLabel}>
        {tasks.map((task) => {
          const presentation = describeTool(task.tool, task.args)
          return (
            <li key={task.id} className="agent-node agent-task">
              <span className="agent-node-title">
                <span className={statusClassOf(task.status)} aria-hidden="true" />
                {presentation.label}
              </span>
              <span className="agent-node-meta">
                {[
                  presentation.summary === '' ? undefined : presentation.summary,
                  agentStatusLabel(task.status),
                ]
                  .filter((part) => part !== undefined)
                  .join(' · ')}
              </span>
              {isRunningTask(task) ? (
                <button
                  type="button"
                  className="tool-more agent-task-stop"
                  aria-label={`${UI_TEXT.stopTask}: ${presentation.label} ${presentation.summary}`}
                  title={UI_TEXT.stopTaskTitle}
                  disabled={task.taskRequest === 'stop'}
                  onClick={() => {
                    onStopTask(task.id)
                  }}
                >
                  {UI_TEXT.stopTask}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function AgentMap({
  title,
  modelId,
  contextUsedTokens,
  agents,
  backgroundTasks,
  delegationMode,
  isDelegationEnabled,
  childTranscripts,
  selectedAgentId,
  onSelectAgent,
  onReadChild,
  onControl,
  onMessage,
  onStopTask,
  onStopAllTasks,
  onOpenMuseSettings,
  onClose,
  workflows,
  workflowTriggerMode,
  onCancelWorkflow,
  onControlWorkflowChild,
}: AgentMapProps) {
  const selected = agents.find((agent) => agent.id === selectedAgentId)
  const transcript =
    selected?.childSessionId === undefined ? undefined : childTranscripts[selected.childSessionId]
  const select = (agent: SubagentEntry) => {
    onSelectAgent(agent.id)
    if (
      agent.childSessionId !== undefined &&
      childTranscripts[agent.childSessionId] === undefined
    ) {
      onReadChild(agent.childSessionId)
    }
  }
  const count = agents.length
  // Delegation off explains an empty map; with agents in it there is nothing to explain.
  const isDelegationNoted = delegationMode !== undefined && !isDelegationEnabled && count === 0
  // A map with workflow runs is not empty, though it has no subagents (M47).
  let subtitle: string | undefined =
    `${plural(UI_TEXT.agentsCount, count)} · ${UI_TEXT.agentMapHint}`
  if (count === 0) {
    subtitle =
      workflows.length === 0 && backgroundTasks.length === 0 ? UI_TEXT.agentMapEmpty : undefined
  }
  const mainMeta = [
    modelId,
    contextUsedTokens === undefined
      ? undefined
      : fill(UI_TEXT.agentContextTokens, { tokens: formatTokenWindow(contextUsedTokens) }),
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
  return (
    <Modal title={UI_TEXT.agentMapTitle} titleId="agent-map-title" isWide onClose={onClose}>
      {selected === undefined ? (
        <>
          {subtitle === undefined ? null : <p className="usage-row-meta">{subtitle}</p>}
          <div className="agent-tree">
            <div className="agent-node agent-node-main">
              <span className="agent-node-title">{title}</span>
              <span className="agent-node-meta">{mainMeta}</span>
            </div>
            {count === 0 ? null : (
              <div className="agent-children">
                {agents.map((agent) => (
                  <AgentNode
                    key={agent.id}
                    agent={agent}
                    onSelect={() => {
                      select(agent)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {workflows.length === 0 ? null : (
            <>
              <p className="usage-row-meta">{plural(UI_TEXT.workflowsCount, workflows.length)}</p>
              <ul className="agent-workflows" aria-label={UI_TEXT.workflowsLabel}>
                {workflows.map((workflow) => (
                  <li
                    key={workflow.id}
                    className="agent-node workflow"
                    data-status={workflow.status}
                  >
                    <WorkflowRunView
                      entry={workflow}
                      onCancelWorkflow={onCancelWorkflow}
                      onControlWorkflowChild={onControlWorkflowChild}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
          {isDelegationNoted || workflowTriggerMode !== undefined ? (
            <div className="agent-notice" role="note">
              {isDelegationNoted ? <p>{UI_TEXT.agentDelegationOff}</p> : null}
              {workflowTriggerMode === undefined ? null : (
                <p>{workflowTriggerText(workflowTriggerMode)}</p>
              )}
              <button type="button" className="tool-more" onClick={onOpenMuseSettings}>
                {UI_TEXT.agentOpenMuseSettings}
              </button>
            </div>
          ) : null}
          {backgroundTasks.length === 0 ? null : (
            <BackgroundTasks
              tasks={backgroundTasks}
              onStopTask={onStopTask}
              onStopAllTasks={onStopAllTasks}
            />
          )}
        </>
      ) : (
        <AgentDetails
          agent={selected}
          transcript={transcript}
          onBack={() => {
            onSelectAgent(undefined)
          }}
          onControl={onControl}
          onMessage={onMessage}
        />
      )}
    </Modal>
  )
}
