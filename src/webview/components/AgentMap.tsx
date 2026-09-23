// The Agent map (PLAN.md D17), as Claude Code's: this conversation on the
// left, the subagents it spawned on the right (objective, role, status,
// duration, tokens), the background tasks below, and a click on an agent for
// its own transcript, read from the child session the CLI keeps for it.
// When Muse Code's delegation is off (its default), the map says so and
// opens the CLI's settings file on request; the extension never edits it.

import { UI_TEXT } from '../../shared/constants'
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
  readonly onOpenMuseSettings: () => void
  readonly onClose: () => void
}

const RUNNING = 'inProgress'
const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

/** "45s", "1m 30s". */
export function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / MILLISECONDS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  return minutes === 0 ? `${String(seconds)}s` : `${String(minutes)}m ${String(seconds)}s`
}

function agentTokens(agent: SubagentEntry): string | undefined {
  return agent.usage === undefined
    ? undefined
    : `${formatTokenWindow(agent.usage.inputTokens + agent.usage.outputTokens)} ${UI_TEXT.agentTokens}`
}

function agentMeta(agent: SubagentEntry): string {
  return [
    agent.durationMs === undefined ? undefined : formatDurationMs(agent.durationMs),
    agentTokens(agent),
    agent.status === RUNNING ? UI_TEXT.agentRunning : (agent.controlStatus ?? agent.status),
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
}: {
  readonly agent: SubagentEntry
  readonly transcript: ChildTranscript | undefined
  readonly onBack: () => void
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
      {agent.resultSummary === undefined ? null : (
        <p className="agent-result">{agent.resultSummary}</p>
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
      : `${String(count)} ${count === 1 ? UI_TEXT.agentSingular : UI_TEXT.agentPlural} · ${UI_TEXT.agentMapHint}`
  const mainMeta = [
    modelId,
    contextUsedTokens === undefined
      ? undefined
      : `${formatTokenWindow(contextUsedTokens)} ${UI_TEXT.agentContextTokens}`,
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
                {String(backgroundTasks.length)}{' '}
                {backgroundTasks.length === 1
                  ? UI_TEXT.backgroundTaskSingular
                  : UI_TEXT.backgroundTaskPlural}
              </p>
              <ul className="agent-tasks" aria-label={UI_TEXT.backgroundTasksLabel}>
                {backgroundTasks.map((task) => (
                  <li key={task.id} className="agent-node">
                    <span className="agent-node-title">
                      <span className={statusClassOf(task.status)} aria-hidden="true" />
                      {task.tool}
                    </span>
                    <span className="agent-node-meta">
                      {[task.args === '' ? undefined : task.args, task.status]
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
        />
      )}
    </Modal>
  )
}
