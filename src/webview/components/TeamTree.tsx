import { webviewKey, webviewCharacter } from '../../shared/keybindings'
// The team's tree (M96 lane U2, PLAN.md D75): the orchestrator at the root,
// roles with their charter summary, mode and tools, pool entries with
// provider, model, caps and headroom, and each entry's workers with brief,
// branch, status, elapsed time, tokens and cost. Shared by the chat panel's
// Agent map and the Models & Agents panel's Agent map section (lane U1):
// it takes the tree and its actions as props and loads nothing itself, so
// in single-model mode it never renders and no team bundle is needed.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { TEAM_TREE_TYPEAHEAD_MS, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import { formatTokenWindow } from '../../shared/palette'
import type { TeamEntry, TeamRole, TeamTreeData, TeamWorker } from '../../shared/teamView'
import { formatUsd } from '../../core/usage/insights'
import { formatDurationMs } from '../agentFormat'
import { teamEntryStateLabel, type TeamMergeDecision } from './TeamCards'
import { isRunningTeamWorker, teamTaskCount, teamWorkerStatusLabel } from '../state/teamEntries'

/** What the tree's buttons ask the host to do (lanes T/A/W answer). */
export interface TeamTreeActions {
  readonly onOpenTranscript: (taskId: string) => void
  readonly onStopTask: (taskId: string) => void
  readonly onReviewDiff: (taskId: string) => void
  readonly onDecideMerge: (taskId: string, decision: TeamMergeDecision) => void
  readonly onEditRole: (roleId: string) => void
  readonly onResetEntry: (entryId: string) => void
  readonly onStopAll: () => void
}

export interface TeamTreeProps {
  readonly tree: TeamTreeData
  /** Absent where the host takes no action (history): the tree reads only. */
  readonly actions?: TeamTreeActions | undefined
}

/** A finished worker whose branch still waits for the merge card. */
const FINISHED_WORKER_STATUSES: ReadonlySet<string> = new Set(['done', 'completed'])

type WorkerGroup = 'entry' | 'queued' | 'unmerged' | 'interrupted'

function tokensOf(worker: TeamWorker): number | undefined {
  return worker.inputTokens === undefined && worker.outputTokens === undefined
    ? undefined
    : (worker.inputTokens ?? 0) + (worker.outputTokens ?? 0)
}

function EstimatedBadge() {
  return <span className="team-estimated">{UI_TEXT.teamEstimated}</span>
}

function WorkerMeta({ worker }: { readonly worker: TeamWorker }) {
  const tokens = tokensOf(worker)
  const meta = [
    teamWorkerStatusLabel(worker.status),
    worker.elapsedMs === undefined ? undefined : formatDurationMs(worker.elapsedMs),
    tokens === undefined
      ? undefined
      : fill(UI_TEXT.agentTokens, { tokens: formatTokenWindow(tokens) }),
    worker.costUsd === undefined ? undefined : formatUsd(worker.costUsd),
  ].filter((part) => part !== undefined)
  return (
    <span className="team-node-meta">
      {meta.join(' · ')}
      {worker.estimated === true ? (
        <>
          {' '}
          <EstimatedBadge />
        </>
      ) : null}
    </span>
  )
}

function WorkerNode({
  worker,
  group,
  actions,
}: {
  readonly worker: TeamWorker
  readonly group: WorkerGroup
  readonly actions: TeamTreeActions | undefined
}) {
  const isRunning = group === 'entry' && isRunningTeamWorker(worker.status)
  const canMerge = group === 'unmerged' || FINISHED_WORKER_STATUSES.has(worker.status)
  return (
    <div className="team-node-body">
      <span className="team-node-title" dir="auto">
        <span
          className={isRunning ? 'agent-dot agent-dot-running' : 'agent-dot agent-dot-done'}
          aria-hidden="true"
        />
        {worker.brief}
      </span>
      <WorkerMeta worker={worker} />
      {worker.branch === undefined ? null : (
        <span className="team-node-meta" dir="auto">
          {worker.branch}
        </span>
      )}
      {actions === undefined ? null : (
        <div className="team-node-actions">
          <button
            tabIndex={-1}
            type="button"
            className="tool-more"
            onClick={() => {
              actions.onOpenTranscript(worker.taskId)
            }}
          >
            {UI_TEXT.teamOpenTranscript}
          </button>
          {isRunning ? (
            <button
              tabIndex={-1}
              type="button"
              className="tool-more"
              onClick={() => {
                actions.onStopTask(worker.taskId)
              }}
            >
              {UI_TEXT.agentStop}
            </button>
          ) : null}
          {group === 'entry' || group === 'unmerged' ? (
            <button
              tabIndex={-1}
              type="button"
              className="tool-more"
              onClick={() => {
                actions.onReviewDiff(worker.taskId)
              }}
            >
              {UI_TEXT.teamReviewDiff}
            </button>
          ) : null}
          {canMerge && group !== 'queued' && group !== 'interrupted' ? (
            <>
              <button
                tabIndex={-1}
                type="button"
                className="tool-more"
                onClick={() => {
                  actions.onDecideMerge(worker.taskId, 'merge')
                }}
              >
                {UI_TEXT.teamMergeAction}
              </button>
              <button
                tabIndex={-1}
                type="button"
                className="tool-more"
                onClick={() => {
                  actions.onDecideMerge(worker.taskId, 'discard')
                }}
              >
                {UI_TEXT.teamDiscardAction}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

function CapLine({
  label,
  used,
  amount,
  estimated,
}: {
  readonly label: string
  readonly used: number
  readonly amount: number | undefined
  readonly estimated: boolean | undefined
}) {
  const text =
    amount === undefined
      ? `${label}: ${formatNumber(used)}`
      : `${label}: ${fill(UI_TEXT.teamCapUsed, { used: formatNumber(used), amount: formatNumber(amount) })}`
  return (
    <span className="team-node-meta" dir="auto">
      {text}
      {estimated === true ? (
        <>
          {' '}
          <EstimatedBadge />
        </>
      ) : null}
    </span>
  )
}

function EntryNode({
  entry,
  index,
  actions,
}: {
  readonly entry: TeamEntry
  /** The entry's position in its role's pool, counting from 1. */
  readonly index: number
  readonly actions: TeamTreeActions | undefined
}) {
  const isReady = entry.state === 'ready'
  return (
    <div className="team-node-body">
      <span className="team-node-title" dir="auto">
        {entry.model ?? fill(UI_TEXT.teamEntryUntitled, { number: formatNumber(index) })}
        {' · '}
        {entry.provider} · {entry.payKind}
      </span>
      <span className="team-node-meta" dir="auto">
        {[
          entry.concurrentMax === undefined
            ? formatNumber(entry.running)
            : fill(UI_TEXT.teamCapUsed, {
                used: formatNumber(entry.running),
                amount: formatNumber(entry.concurrentMax),
              }),
          entry.headroom,
          isReady ? undefined : teamEntryStateLabel(entry.state),
          entry.stateDetail,
        ]
          .filter((part) => part !== undefined)
          .join(' · ')}
      </span>
      {entry.caps.map((cap) => (
        <CapLine
          key={cap.label}
          label={cap.label}
          used={cap.used}
          amount={cap.amount}
          estimated={cap.estimated}
        />
      ))}
      {entry.warnings.map((warning) => (
        <span key={warning} className="team-node-meta" dir="auto">
          {warning}
        </span>
      ))}
      {actions === undefined ? null : (
        <div className="team-node-actions">
          <button
            tabIndex={-1}
            type="button"
            className="tool-more"
            onClick={() => {
              actions.onResetEntry(entry.id)
            }}
          >
            {UI_TEXT.teamResetEntry}
          </button>
        </div>
      )}
    </div>
  )
}

interface FlatNode {
  readonly id: string
  readonly parentId: string | undefined
  readonly level: number
  /** The screen-reader name: role, model and status (D75). */
  readonly label: string
  readonly expandable: boolean
  readonly body: ReactNode
}

function groupNodes(
  role: TeamRole,
  group: Exclude<WorkerGroup, 'entry'>,
  workers: readonly TeamWorker[],
  actions: TeamTreeActions | undefined,
): FlatNode[] {
  if (workers.length === 0) {
    return []
  }
  // Read when the group renders so the installed language shows.
  const title = {
    queued: UI_TEXT.teamQueuedGroup,
    unmerged: UI_TEXT.teamUnmergedGroup,
    interrupted: UI_TEXT.teamInterruptedGroup,
  }[group]
  const groupId = `team-group:${role.id}:${group}`
  return [
    {
      id: groupId,
      parentId: `team-role:${role.id}`,
      level: 3,
      label: `${title}, ${formatNumber(workers.length)}`,
      expandable: true,
      body: (
        <div className="team-node-body">
          <span className="team-node-title">{title}</span>
        </div>
      ),
    },
    ...workers.map((worker) => ({
      id: `team-task:${worker.taskId}`,
      parentId: groupId,
      level: 4,
      label: `${worker.brief}, ${role.name}, ${teamWorkerStatusLabel(worker.status)}`,
      expandable: false,
      body: <WorkerNode worker={worker} group={group} actions={actions} />,
    })),
  ]
}

function buildNodes(tree: TeamTreeData, actions: TeamTreeActions | undefined): FlatNode[] {
  const nodes: FlatNode[] = [
    {
      id: 'team-root',
      parentId: undefined,
      level: 1,
      label: `${UI_TEXT.teamOrchestrator}, ${tree.orchestrator.model}, ${tree.orchestrator.backend}, ${
        tree.orchestrator.slot === 'default'
          ? UI_TEXT.teamOrchestratorDefault
          : UI_TEXT.teamOrchestratorOverride
      }`,
      expandable: tree.roles.length > 0,
      body: (
        <div className="team-node-body">
          <span className="team-node-title" dir="auto">
            {UI_TEXT.teamOrchestrator} · {tree.orchestrator.model} · {tree.orchestrator.backend} ·{' '}
            {tree.orchestrator.slot === 'default'
              ? UI_TEXT.teamOrchestratorDefault
              : UI_TEXT.teamOrchestratorOverride}
          </span>
          <span className="team-node-meta">
            {plural(UI_TEXT.teamTasksCount, teamTaskCount(tree))}
          </span>
          {tree.spentUsdToday === undefined || tree.budgetUsdToday === undefined ? null : (
            <span className="team-node-meta">
              {fill(UI_TEXT.teamCapUsed, {
                used: formatUsd(tree.spentUsdToday),
                amount: formatUsd(tree.budgetUsdToday),
              })}{' '}
              · {UI_TEXT.teamUsageToday}
            </span>
          )}
          {actions === undefined ? null : (
            <div className="team-node-actions">
              <button
                tabIndex={-1}
                type="button"
                className="tool-more"
                onClick={() => {
                  actions.onStopAll()
                }}
              >
                {UI_TEXT.teamStopAll}
              </button>
            </div>
          )}
        </div>
      ),
    },
  ]
  for (const role of tree.roles) {
    const roleId = `team-role:${role.id}`
    const childCount =
      role.entries.length + role.queued.length + role.unmerged.length + role.interrupted.length
    nodes.push({
      id: roleId,
      parentId: 'team-root',
      level: 2,
      label: `${role.name}, ${role.mode}`,
      expandable: childCount > 0,
      body: (
        <div className="team-node-body">
          <span className="team-node-title" dir="auto">
            {role.name}
          </span>
          <span className="team-node-meta" dir="auto">
            {[role.mode, role.summary, role.toolGroups.join(', ')]
              .filter((part) => part !== undefined && part !== '')
              .join(' · ')}
          </span>
          {actions === undefined ? null : (
            <div className="team-node-actions">
              <button
                tabIndex={-1}
                type="button"
                className="tool-more"
                onClick={() => {
                  actions.onEditRole(role.id)
                }}
              >
                {UI_TEXT.teamEditRole}
              </button>
            </div>
          )}
        </div>
      ),
    })
    for (const [position, entry] of role.entries.entries()) {
      const entryId = `team-entry:${role.id}:${entry.id}`
      const entryLabel =
        entry.model ?? fill(UI_TEXT.teamEntryUntitled, { number: formatNumber(position + 1) })
      const running =
        entry.concurrentMax === undefined
          ? plural(UI_TEXT.teamRunningCount, entry.running)
          : fill(UI_TEXT.teamRunningOf, {
              used: formatNumber(entry.running),
              amount: formatNumber(entry.concurrentMax),
            })
      nodes.push({
        id: entryId,
        parentId: roleId,
        level: 3,
        label: `${role.name}, ${fill(UI_TEXT.teamEntryUntitled, { number: formatNumber(position + 1) })}, ${entryLabel}, ${entry.provider}, ${running}${entry.state === 'ready' ? '' : `, ${teamEntryStateLabel(entry.state)}`}`,
        expandable: entry.workers.length > 0,
        body: <EntryNode entry={entry} index={position + 1} actions={actions} />,
      })
      for (const worker of entry.workers) {
        nodes.push({
          id: `team-task:${worker.taskId}`,
          parentId: entryId,
          level: 4,
          label: `${worker.brief}, ${role.name}, ${entryLabel}, ${teamWorkerStatusLabel(worker.status)}`,
          expandable: false,
          body: <WorkerNode worker={worker} group="entry" actions={actions} />,
        })
      }
    }
    nodes.push(
      ...groupNodes(role, 'queued', role.queued, actions),
      ...groupNodes(role, 'unmerged', role.unmerged, actions),
      ...groupNodes(role, 'interrupted', role.interrupted, actions),
    )
  }
  return nodes
}

/**
 * The team tree: one tab stop, arrow keys, Home, End and type-ahead (D75,
 * WAI-ARIA's tree pattern). It is not a live region; the panel's one polite
 * region announces a finished worker once (D75).
 */
export function TeamTree({ tree, actions }: TeamTreeProps) {
  const nodes = buildNodes(tree, actions)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(nodes.filter((node) => node.expandable).map((node) => node.id)),
  )
  const [focusId, setFocusId] = useState('team-root')
  const elements = useRef(new Map<string, HTMLDivElement | null>())
  const typeahead = useRef({ text: '', at: 0 })
  const focusWithin = useRef(false)
  const visible = nodes.filter((node) => {
    let parentId = node.parentId
    while (parentId !== undefined) {
      if (!expanded.has(parentId)) {
        return false
      }
      parentId = byId.get(parentId)?.parentId
    }
    return true
  })
  const activeId = visible.some((node) => node.id === focusId) ? focusId : 'team-root'
  useEffect(() => {
    if (activeId !== focusId && focusWithin.current) {
      elements.current.get(activeId)?.focus()
    }
  }, [activeId, focusId])
  const focus = (id: string) => {
    setFocusId(id)
    elements.current.get(id)?.focus()
  }
  const childrenOf = (id: string) =>
    nodes.filter((node) => node.parentId === id).map((node) => node.id)
  const onKeyDown = (event: KeyboardEvent, node: FlatNode) => {
    const target = event.target
    if (target instanceof HTMLButtonElement) {
      const buttons = [...(elements.current.get(node.id)?.querySelectorAll('button') ?? [])]
      const index = buttons.indexOf(target)
      if (webviewKey('team.tree', event) === 'close') {
        event.preventDefault()
        focus(node.id)
      } else if (
        webviewKey('team.tree', event) === 'increase' ||
        webviewKey('team.tree', event) === 'decrease'
      ) {
        event.preventDefault()
        buttons[index + (webviewKey('team.tree', event) === 'increase' ? 1 : -1)]?.focus()
      }
      return
    }
    if (webviewKey('team.tree', event) === 'actions') {
      const button = elements.current.get(node.id)?.querySelector('button')
      if (button !== null && button !== undefined) {
        event.preventDefault()
        button.focus()
      }
      return
    }
    const index = visible.findIndex((candidate) => candidate.id === node.id)
    switch (webviewKey('team.tree', event)) {
      case 'next': {
        const below = visible[index + 1]
        if (below !== undefined) {
          event.preventDefault()
          focus(below.id)
        }
        break
      }
      case 'previous': {
        const above = visible[index - 1]
        if (above !== undefined) {
          event.preventDefault()
          focus(above.id)
        }
        break
      }
      case 'first': {
        const first = visible[0]
        if (first !== undefined) {
          event.preventDefault()
          focus(first.id)
        }
        break
      }
      case 'last': {
        const last = visible.at(-1)
        if (last !== undefined) {
          event.preventDefault()
          focus(last.id)
        }
        break
      }
      case 'increase': {
        event.preventDefault()
        if (node.expandable && !expanded.has(node.id)) {
          setExpanded(new Set(expanded).add(node.id))
        } else {
          const firstChild = childrenOf(node.id)[0]
          if (firstChild !== undefined) {
            focus(firstChild)
          }
        }
        break
      }
      case 'decrease': {
        event.preventDefault()
        if (node.expandable && expanded.has(node.id)) {
          const next = new Set(expanded)
          next.delete(node.id)
          setExpanded(next)
        } else if (node.parentId !== undefined) {
          focus(node.parentId)
        }
        break
      }
      default: {
        const character = webviewCharacter(event)
        if (character !== undefined) {
          // The event's own timestamp keeps the component pure (no Date.now in render).
          const at = event.timeStamp
          const text =
            at - typeahead.current.at > TEAM_TREE_TYPEAHEAD_MS
              ? character
              : typeahead.current.text + character
          typeahead.current = { text, at }
          const match = [...visible.slice(index + 1), ...visible.slice(0, index + 1)].find(
            (candidate) => candidate.label.toLowerCase().startsWith(text.toLowerCase()),
          )
          if (match !== undefined) {
            event.preventDefault()
            focus(match.id)
          }
        }
        break
      }
    }
  }
  return (
    <div
      className="team-tree"
      role="tree"
      aria-label={UI_TEXT.teamTreeLabel}
      aria-description={UI_TEXT.teamTreeKeyboardHint}
      onFocusCapture={() => {
        focusWithin.current = true
      }}
      onBlurCapture={(event) => {
        if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) {
          focusWithin.current = false
        }
      }}
    >
      {visible.map((node) => (
        <div
          key={node.id}
          ref={(element) => {
            if (element === null) elements.current.delete(node.id)
            else elements.current.set(node.id, element)
          }}
          role="treeitem"
          aria-level={node.level}
          aria-expanded={node.expandable ? expanded.has(node.id) : undefined}
          aria-label={node.label}
          tabIndex={node.id === activeId ? 0 : -1}
          className="team-node"
          data-level={node.level}
          onKeyDown={(event) => {
            onKeyDown(event, node)
          }}
          onFocus={() => {
            if (focusId !== node.id) {
              setFocusId(node.id)
            }
          }}
        >
          {node.body}
        </div>
      ))}
    </div>
  )
}
