// @vitest-environment jsdom
// The Agent map's team tree (M96 lane U2): the hierarchy, the ARIA tree
// pattern, the actions, the read-only render, the header pill and the
// AgentMap region. Single-model mode renders no team tree: that is today's
// map, covered by AgentMap.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import type { TeamTreeData, TeamWorker } from '../../src/shared/teamView'
import { TeamTree, type TeamTreeActions } from '../../src/webview/components/TeamTree'
import { teamTaskCount, teamRunningTaskCount } from '../../src/webview/state/teamEntries'
import { Header } from '../../src/webview/components/Header'
import { renderAgentMap } from './helpers/transcriptFixtures'

function setup() {
  setUiText(EN, BASE_LOCALE)
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

const tree: TeamTreeData = {
  orchestrator: { model: 'muse-spark-1.3', backend: 'modelApi', slot: 'default' },
  roles: [
    {
      id: 'engineering',
      name: 'engineering',
      summary: 'Builds features',
      mode: 'own-branch',
      toolGroups: ['edit', 'shell'],
      entries: [
        {
          id: 'e1',
          provider: 'Meta',
          model: 'muse-spark-1.3',
          payKind: 'key',
          caps: [{ label: 'day tokens', used: 10_000, amount: 25_000 }],
          running: 2,
          concurrentMax: 4,
          headroom: 'room for 2 more',
          state: 'ready',
          warnings: [],
          workers: [
            {
              taskId: 't1',
              brief: 'Add the retry',
              reason: 'parallel-work',
              branch: 'agents/engineering/t1',
              status: 'running',
              elapsedMs: 90_000,
              inputTokens: 70_000,
              outputTokens: 7600,
              costUsd: 0.12,
            },
            { taskId: 't2', brief: 'Fix the test', status: 'done', costUsd: 0.03 },
          ],
        },
        {
          id: 'e2',
          provider: 'Muse Code',
          model: 'muse',
          payKind: 'subscription',
          caps: [{ label: 'day tasks', used: 3, amount: 10, estimated: true }],
          running: 0,
          state: 'capped',
          stateDetail: 'day tasks spent',
          warnings: ['cap resets at midnight'],
          workers: [],
        },
      ],
      queued: [{ taskId: 't3', brief: 'Docs pass', status: 'queued' }],
      unmerged: [
        {
          taskId: 't4',
          brief: 'Refactor auth',
          status: 'done',
          branch: 'agents/engineering/t4',
        },
      ],
      interrupted: [],
    },
  ],
  spentUsdToday: 1.2,
  budgetUsdToday: 50,
}

function actions(): TeamTreeActions {
  return {
    onOpenTranscript: vi.fn(),
    onStopTask: vi.fn(),
    onReviewDiff: vi.fn(),
    onDecideMerge: vi.fn(),
    onEditRole: vi.fn(),
    onResetEntry: vi.fn(),
    onStopAll: vi.fn(),
  }
}

function withWorkers(
  change: (workers: readonly TeamWorker[]) => readonly TeamWorker[],
): TeamTreeData {
  return {
    ...tree,
    roles: tree.roles.map((role) => ({
      ...role,
      entries: role.entries.map((entry) => ({ ...entry, workers: change(entry.workers) })),
    })),
  }
}

describe('TeamTree', () => {
  it('renders the hierarchy with caps, headroom and the budget', () => {
    setup()
    render(<TeamTree tree={tree} actions={actions()} />)
    expect(screen.getByRole('tree', { name: 'Team' })).toBeDefined()
    expect(screen.getByText(/Orchestrator · muse-spark-1.3 · modelApi · Default/)).toBeDefined()
    expect(screen.getByText('engineering')).toBeDefined()
    expect(screen.getByText(/own-branch · Builds features · edit, shell/)).toBeDefined()
    expect(screen.getByText(/muse-spark-1.3 · Meta · key/)).toBeDefined()
    expect(screen.getByText('day tokens: 10,000 of 25,000')).toBeDefined()
    expect(screen.getByText(/room for 2 more/)).toBeDefined()
    expect(screen.getByText('Add the retry')).toBeDefined()
    expect(screen.getByText('agents/engineering/t1')).toBeDefined()
    expect(screen.getByText('Queued')).toBeDefined()
    expect(screen.getByText('Unmerged')).toBeDefined()
    expect(screen.getByText('estimated')).toBeDefined()
    expect(screen.getByText(/\$1.20 of \$50.00 · Today/)).toBeDefined()
  })

  it('counts every task node', () => {
    expect(teamTaskCount(tree)).toBe(4)
  })

  it('names each item for screen readers with role, model and status', () => {
    setup()
    render(<TeamTree tree={tree} actions={actions()} />)
    expect(
      screen.getByRole('treeitem', {
        name: 'engineering, Entry 1, muse-spark-1.3, Meta, 2 of 4 running',
      }),
    ).toBeDefined()
    expect(
      screen.getByRole('treeitem', {
        name: 'Add the retry, engineering, muse-spark-1.3, running',
      }),
    ).toBeDefined()
    expect(
      screen.getByRole('treeitem', {
        name: 'engineering, Entry 2, muse, Muse Code, 0 running, capped',
      }),
    ).toBeDefined()
  })

  it('keeps one tab stop across the treeitems', () => {
    setup()
    const { container } = render(<TeamTree tree={tree} actions={actions()} />)
    const stops = [...container.querySelectorAll<HTMLElement>('button, [tabindex]')].filter(
      (node) => node.tabIndex >= 0,
    )
    expect(stops).toHaveLength(1)
  })

  it('moves with arrows, collapses, expands and types ahead', () => {
    setup()
    render(<TeamTree tree={tree} actions={actions()} />)
    const root = screen.getByRole('treeitem', { name: /Orchestrator/ })
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    expect(document.activeElement!.getAttribute('aria-label')).toBe('engineering, own-branch')
    const role = screen.getByRole('treeitem', { name: 'engineering, own-branch' })
    // Left collapses the role: its entries leave the tree.
    fireEvent.keyDown(role, { key: 'ArrowLeft' })
    expect(screen.queryByText('Add the retry')).toBeNull()
    // Right expands it again.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(screen.getByText('Add the retry')).toBeDefined()
    // Type-ahead finds the queued group from the root.
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /Orchestrator/ }), { key: 'q' })
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^Queued/)
  })

  it('sends each action with its task, entry or role', () => {
    setup()
    const seen = actions()
    render(<TeamTree tree={tree} actions={seen} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open transcript' })[0]!)
    expect(seen.onOpenTranscript).toHaveBeenCalledWith('t1')
    fireEvent.click(screen.getByRole('button', { name: 'Stop all team tasks' }))
    expect(seen.onStopAll).toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset' })[0]!)
    expect(seen.onResetEntry).toHaveBeenCalledWith('e1')
    fireEvent.click(screen.getByRole('button', { name: 'Edit in Roles section' }))
    expect(seen.onEditRole).toHaveBeenCalledWith('engineering')
    fireEvent.click(screen.getAllByRole('button', { name: 'Review diff' })[0]!)
    expect(seen.onReviewDiff).toHaveBeenCalledWith('t1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge' })[0]!)
    expect(seen.onDecideMerge).toHaveBeenCalledWith('t2', 'merge')
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge' })[1]!)
    expect(seen.onDecideMerge).toHaveBeenCalledWith('t4', 'merge')
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop' })[0]!)
    expect(seen.onStopTask).toHaveBeenCalledWith('t1')
  })

  it('reads only without actions', () => {
    setup()
    render(<TeamTree tree={tree} />)
    expect(screen.getByText('Add the retry')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

function headerProps() {
  return {
    title: 'Chrome control update',
    isFocusView: false,
    onNewConversation: vi.fn(),
    onOpenAgents: vi.fn(),
  }
}

describe('AgentMap team region', () => {
  it('shows the team tree with its task count', async () => {
    setup()
    renderAgentMap({ team: tree, teamActions: actions() })
    expect(screen.getByText(/Team · 4 team tasks/)).toBeDefined()
    expect(await screen.findByRole('tree', { name: 'Team' })).toBeDefined()
  })

  it('stays today’s map without a team', () => {
    setup()
    renderAgentMap()
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.queryByText(/team tasks/)).toBeNull()
  })
})

describe('Header team pill', () => {
  it('counts the team tasks and marks them running', () => {
    setup()
    render(<Header {...headerProps()} teamTaskCount={2} runningTeamTaskCount={1} />)
    expect(screen.getByRole('button', { name: '2 team tasks' })).toBeDefined()
  })

  it('stays today’s pill without team tasks', () => {
    setup()
    render(<Header {...headerProps()} agentCount={1} />)
    expect(screen.getByRole('button', { name: '1 agent' })).toBeDefined()
    expect(screen.queryByText(/team tasks/)).toBeNull()
  })

  it('shows no pill with nothing to show', () => {
    setup()
    render(<Header {...headerProps()} />)
    expect(screen.queryByRole('button', { name: /agent|task/ })).toBeNull()
  })
})

describe('RVM96B tree regressions', () => {
  it('14 has one total Tab stop and exposes every action through F2 and arrows', () => {
    setup()
    const seen = actions()
    const { container } = render(<TeamTree tree={tree} actions={seen} />)
    const stops = [...container.querySelectorAll<HTMLElement>('button, [tabindex]')].filter(
      (node) => node.tabIndex >= 0,
    )
    expect(stops).toHaveLength(1)
    const task = screen.getByRole('treeitem', { name: /^Add the retry,/ })
    fireEvent.keyDown(task, { key: 'F2' })
    expect(document.activeElement).toBe(
      screen.getAllByRole('button', { name: 'Open transcript' })[0],
    )
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(document.activeElement!)
    expect(seen.onStopTask).toHaveBeenCalledWith('t1')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(task)
  })

  it('15 retains a roving stop and recovers focus when the focused task disappears', () => {
    setup()
    const { container, rerender } = render(<TeamTree tree={tree} />)
    const root = screen.getByRole('treeitem', { name: /Orchestrator/ })
    fireEvent.keyDown(root, { key: 'End' })
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^Refactor auth,/)
    rerender(
      <TeamTree tree={{ ...tree, roles: tree.roles.map((role) => ({ ...role, unmerged: [] })) }} />,
    )
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /Orchestrator/ }))
  })

  it('16 excludes queued, interrupted and unknown tasks from running counts and Stop controls', () => {
    setup()
    const inactive: TeamTreeData = {
      ...tree,
      roles: tree.roles.map((role) => ({
        ...role,
        entries: [],
        unmerged: [],
        interrupted: [{ taskId: 'interrupted', brief: 'Interrupted task', status: 'interrupted' }],
      })),
    }
    expect(teamRunningTaskCount(inactive)).toBe(0)
    const { rerender } = render(<TeamTree tree={inactive} actions={actions()} />)
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(document.querySelector('.agent-dot-running')).toBeNull()
    expect(teamRunningTaskCount(tree)).toBe(1)
    const unknown = withWorkers((workers) =>
      workers.map((worker) => ({ ...worker, status: 'future-state' })),
    )
    expect(teamRunningTaskCount(unknown)).toBe(0)
    rerender(<TeamTree tree={unknown} actions={actions()} />)
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /^engineering, Entry 1,/ }), {
      key: 'ArrowRight',
    })
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(
      teamRunningTaskCount(
        withWorkers(() => [
          { taskId: 'approval', brief: 'Approval', status: 'waitingForApproval' },
        ]),
      ),
    ).toBe(2)
  })

  it('21 localizes entry names and known worker statuses, preserving unknown statuses', () => {
    const translated = {
      ...EN,
      teamEntryUntitled: 'Eintrag {number}',
      teamRunningOf: '{used} von {amount} aktiv',
      approvalDockLabel: 'Wartet auf deine Genehmigung',
      agentStatuses: { ...EN.agentStatuses, inProgress: 'aktiv', completed: 'fertig' },
    }
    setUiText(translated, 'de')
    const { rerender } = render(<TeamTree tree={tree} />)
    expect(
      screen.getByRole('treeitem', {
        name: 'engineering, Eintrag 1, muse-spark-1.3, Meta, 2 von 4 aktiv',
      }),
    ).toBeDefined()
    expect(
      screen.getByRole('treeitem', { name: 'Add the retry, engineering, muse-spark-1.3, aktiv' }),
    ).toBeDefined()
    expect(
      screen.getByRole('treeitem', { name: 'Fix the test, engineering, muse-spark-1.3, fertig' }),
    ).toBeDefined()
    rerender(
      <TeamTree
        tree={{
          ...tree,
          roles: tree.roles.map((role) => ({
            ...role,
            entries: role.entries.map((entry) => ({
              ...entry,
              workers: entry.workers.map((worker) =>
                worker.taskId === 't1' ? { ...worker, status: 'waitingForApproval' } : worker,
              ),
            })),
            interrupted: [{ taskId: 'future', brief: 'Future', status: 'future-state' }],
          })),
        }}
      />,
    )
    expect(
      screen.getByRole('treeitem', {
        name: 'Add the retry, engineering, muse-spark-1.3, Wartet auf deine Genehmigung',
      }),
    ).toBeDefined()
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /^Interrupted,/ }), {
      key: 'ArrowRight',
    })
    expect(
      screen.getByRole('treeitem', { name: /Future, engineering, future-state/ }),
    ).toBeDefined()
  })
})
