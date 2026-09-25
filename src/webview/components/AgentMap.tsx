// The Agent map (PLAN.md D17), as Claude Code's: this conversation on the
// left, the subagents it spawned on the right (objective, role, status,
// duration, tokens), the background tasks below, and a click on an agent for
// its own transcript, read from the child session the CLI keeps for it.
// When Muse Code's delegation is off (its default), the map says so and
// opens the CLI's settings file on request; the extension never edits it.

import { useState } from 'react'
import {
  SUBAGENT_CLOSED,
  SUBAGENT_RESULT_READY,
  SUBAGENT_RUNNING_STATUSES,
  type SubagentAction,
  UI_TEXT,
} from '../../shared/constants'
import type { TokenUsage } from '../../shared/agentEvents'
import { fill, formatUnit, plural } from '../../shared/l10n/text'
import { formatTokenWindow } from '../../shared/palette'
import type { ChildTranscript, TranscriptEntry } from '../state/uiState'
import { Modal } from './Modal'

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
  readonly onOpenMuseSettings: () => void
  readonly onClose: () => void
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

/** A status as the display language says it; one the table does not list shows as it came. */
export function agentStatusLabel(status: string): string {
  return Object.entries(UI_TEXT.agentStatuses).find(([known]) => known === status)?.[1] ?? status
}

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

/** "45s", "1m 30s", in the display language's short units. */
export function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / MILLISECONDS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = formatUnit(totalSeconds % SECONDS_PER_MINUTE, 'second')
  return minutes === 0 ? seconds : `${formatUnit(minutes, 'minute')} ${seconds}`
}

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
    case 'reasoning': {
      return entry.parts.join('\n')
    }
    case 'subagent': {
      return entry.objective ?? entry.role ?? UI_TEXT.agentUntitled
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
  onOpenMuseSettings,
  onClose,
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
  const subtitle =
    count === 0
      ? UI_TEXT.agentMapEmpty
      : `${plural(UI_TEXT.agentsCount, count)} · ${UI_TEXT.agentMapHint}`
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
          <p className="usage-row-meta">{subtitle}</p>
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
          {delegationMode !== undefined && !isDelegationEnabled && count === 0 ? (
            <div className="agent-notice" role="note">
              <p>{UI_TEXT.agentDelegationOff}</p>
              <button type="button" className="tool-more" onClick={onOpenMuseSettings}>
                {UI_TEXT.agentOpenMuseSettings}
              </button>
            </div>
          ) : null}
          {backgroundTasks.length === 0 ? null : (
            <>
              <p className="usage-row-meta">
                {plural(UI_TEXT.backgroundTasksCount, backgroundTasks.length)}
              </p>
              <ul className="agent-tasks" aria-label={UI_TEXT.backgroundTasksLabel}>
                {backgroundTasks.map((task) => (
                  <li key={task.id} className="agent-node">
                    <span className="agent-node-title">
                      <span className={statusClassOf(task.status)} aria-hidden="true" />
                      {task.tool}
                    </span>
                    <span className="agent-node-meta">
                      {[task.args === '' ? undefined : task.args, agentStatusLabel(task.status)]
                        .filter((part) => part !== undefined)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
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
