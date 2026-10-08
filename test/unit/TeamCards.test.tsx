// @vitest-environment jsdom
// The team's transcript cards (M96 lane U2): the delegation plan, the
// switch row, the four-choice waiting card, the merge card, the report row,
// and the worker label on a worker's own cards.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import {
  TeamMergeCard,
  TeamPlanCard,
  TeamReportRow,
  TeamSwitchRow,
  TeamWaitingCard,
  TeamWorkerLabel,
  teamEntryStateLabel,
  teamSwitchReasonLabel,
  type TeamMergeEntry,
  type TeamPlanEntry,
  type TeamReportEntry,
  type TeamSwitchEntry,
  type TeamWaitingEntry,
} from '../../src/webview/components/TeamCards'
import { ToolRow } from '../../src/webview/components/ToolRow'
import { AttentionDock } from '../../src/webview/components/AttentionDock'
import type { WaitingApproval } from '../../src/webview/state/uiState'

function setup() {
  setUiText(EN, BASE_LOCALE)
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

const planEntry: TeamPlanEntry = {
  kind: 'teamPlan',
  id: 'p1',
  status: 'completed',
  dryRun: true,
  items: [
    {
      disposition: 'delegated',
      role: 'engineering',
      brief: 'Add the retry',
      reason: 'parallel-work',
      entry: 'entry 1',
    },
    { disposition: 'kept', role: 'engineering', reason: 'small-task' },
  ],
}

const switchEntry: TeamSwitchEntry = {
  kind: 'teamSwitch',
  id: 's1',
  status: 'completed',
  roleId: 'engineering',
  fromEntry: 'entry 1',
  toEntry: 'entry 2',
  reason: 'cap',
}

const waitingEntry: TeamWaitingEntry = {
  kind: 'teamWaiting',
  id: 'w1',
  status: 'inProgress',
  waitingId: 'wait-1',
  roleId: 'qa',
  brief: 'Run the suite',
  reasonText: 'every entry is capped',
}

function mergeEntry(overrides: Partial<TeamMergeEntry> = {}): TeamMergeEntry {
  return {
    kind: 'teamMerge',
    id: 'm1',
    status: 'inProgress',
    taskId: 't3',
    roleId: 'engineering',
    brief: 'Add the retry',
    branch: 'agents/engineering/t3',
    filesChanged: 4,
    affectedFiles: ['src/retry.ts'],
    protectedPaths: [],
    review: 'reviewed',
    ...overrides,
  }
}

const reportEntry: TeamReportEntry = {
  kind: 'teamReport',
  id: 'r1',
  status: 'completed',
  taskId: 't3',
  roleId: 'engineering',
  brief: 'Add the retry',
  summary: 'Added retry with backoff.',
}

describe('TeamPlanCard', () => {
  it('lists each item delegated or kept, with its reason', () => {
    setup()
    render(<TeamPlanCard entry={planEntry} />)
    expect(screen.getByText('Delegation plan')).toBeDefined()
    expect(screen.getByText('Plan only: nothing started or spent.')).toBeDefined()
    const items = within(screen.getByRole('list', { name: 'Delegation plan' })).getAllByRole(
      'listitem',
    )
    expect(items).toHaveLength(2)
    expect(screen.getByText('Delegated')).toBeDefined()
    expect(screen.getByText('Kept by the main agent')).toBeDefined()
    expect(screen.getByText('Add the retry', { exact: false })).toBeDefined()
  })
})

describe('TeamSwitchRow', () => {
  it('shows the role, from and to, and the translated reason', () => {
    setup()
    render(<TeamSwitchRow entry={switchEntry} />)
    expect(screen.getByText(/engineering: entry 1 → entry 2 · cap reached/)).toBeDefined()
  })

  it('shows an unknown reason as it came', () => {
    setup()
    render(<TeamSwitchRow entry={{ ...switchEntry, reason: 'phase-of-moon' }} />)
    expect(screen.getByText(/phase-of-moon/)).toBeDefined()
  })
})

describe('TeamWaitingCard', () => {
  it('offers the four choices and answers once', () => {
    setup()
    const onAnswer = vi.fn()
    render(<TeamWaitingCard entry={waitingEntry} onAnswer={onAnswer} />)
    expect(screen.getByText('Waiting for you')).toBeDefined()
    for (const label of ['Queue it', 'Main agent does it', 'Raise a limit…', 'Cancel']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Queue it' }))
    expect(onAnswer).toHaveBeenCalledWith('wait-1', 'queue')
    expect(screen.getByRole('button', { name: 'Queue it' })).toBeDefined()
    // Answered: the other choices lock, as a decided approval card does.
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
  })

  it('reads only without an answer handler', () => {
    setup()
    render(<TeamWaitingCard entry={waitingEntry} />)
    expect(screen.getByText('Waiting for you')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('TeamMergeCard', () => {
  it('decides merge or discard, and opens the diff', () => {
    setup()
    const onDecide = vi.fn()
    const onReviewDiff = vi.fn()
    render(<TeamMergeCard entry={mergeEntry()} onDecide={onDecide} onReviewDiff={onReviewDiff} />)
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(onDecide).toHaveBeenCalledWith('t3', 'merge')
    fireEvent.click(screen.getByRole('button', { name: 'Review diff' }))
    expect(onReviewDiff).toHaveBeenCalledWith('t3')
  })

  it('marks an unreviewed merge and a moved branch', () => {
    setup()
    render(
      <TeamMergeCard
        entry={mergeEntry({ review: 'not-reviewed', branchMoved: true, conflicted: true })}
      />,
    )
    expect(screen.getByText(/Not reviewed/)).toBeDefined()
    expect(screen.getByText('The branch moved during the task.')).toBeDefined()
    expect(screen.getByText('Conflicts need resolving before merge.')).toBeDefined()
  })

  it('notes a same-model review', () => {
    setup()
    render(<TeamMergeCard entry={mergeEntry({ review: 'same-model' })} />)
    expect(screen.getByText(/Reviewed by the same model/)).toBeDefined()
  })

  it('reads only without handlers', () => {
    setup()
    render(<TeamMergeCard entry={mergeEntry()} />)
    expect(screen.getByText(/Add the retry/)).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('TeamReportRow', () => {
  it('shows the role and the report', () => {
    setup()
    render(<TeamReportRow entry={reportEntry} />)
    expect(screen.getByText('Report')).toBeDefined()
    expect(screen.getByText(/engineering · Add the retry — Added retry/)).toBeDefined()
  })
})

describe('F4 merge path layout', () => {
  it('gives the merge path lists their own full-width row so paths wrap, never one character per line', () => {
    const css = readFileSync(path.resolve(__dirname, '../../src/webview/styles.css'), 'utf8')
    // The merge card wraps its single-row activity layout ...
    expect(css).toMatch(/\.activity-team-merge\s*\{[^}]*flex-wrap:\s*wrap[^}]*\}/s)
    // ... and the path lists, notes and actions each take the full row with
    // room to shrink, so overflow-wrap keeps breaking at path width.
    expect(css).toMatch(
      /\.activity-team-merge\s*>\s*\.team-merge-details,[\s\S]*?\{[^}]*flex:\s*1\s+1\s+100%[^}]*min-width:\s*0[^}]*\}/s,
    )
    expect(css).toMatch(/\.team-merge-details\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*\}/s)
  })
})

describe('worker label', () => {
  const worker = { roleId: 'engineering', agentLabel: 'Codex', taskId: 't3' }

  it('labels a worker’s own approval with role, agent and task', async () => {
    setup()
    const waiting: WaitingApproval = {
      entryId: 'row-a1',
      toolName: 'edit',
      approval: {
        approvalId: 'a1',
        requirementId: { approvalId: 'a1', sourceIndex: 0 },
        subject: { kind: 'tool', toolName: 'edit', path: 'src/a.ts' },
        rawArgs: '{}',
        availableChoices: [
          { choiceId: 'allow', label: 'Allow once', decision: 'approved', scope: 'once' },
        ],
        isProtectedWrite: false,
        isJudgeEscalated: false,
      },
      teamWorker: worker,
    }
    render(<AttentionDock waiting={[waiting]} onDecide={vi.fn()} />)
    expect(await screen.findByText('engineering · Codex · t3')).toBeDefined()
  })

  it('draws the label from the task, never from worker text', async () => {
    setup()
    render(<TeamWorkerLabel worker={worker} />)
    expect(await screen.findByText('engineering · Codex · t3')).toBeDefined()
  })

  it('labels a worker’s own question row', async () => {
    setup()
    render(
      <ToolRow
        entry={{
          kind: 'tool',
          id: 'c1',
          tool: 'edit',
          args: '{}',
          status: 'inProgress',
          output: '',
          isBackground: false,
          teamWorker: worker,
          approval: undefined,
          approvalOutcome: undefined,
          question: {
            userInputId: 'q1',
            questions: [
              {
                id: 'q1-0',
                header: 'Edit',
                question: 'Apply this edit?',
                selection: { mode: 'single' },
                options: [{ label: 'Yes' }, { label: 'No' }],
              },
            ],
          },
          questionOutcome: undefined,
          taskRequest: undefined,
        }}
        isRunning={false}
        patchPage={undefined}
        onReadOutput={vi.fn()}
        onOpenOutput={vi.fn()}
        onAnswer={vi.fn()}
        onCancelQuestion={vi.fn()}
        onClarifyQuestion={vi.fn()}
        onAcceptElicitation={vi.fn()}
        onDeclineElicitation={vi.fn()}
        onCancelElicitation={vi.fn()}
        onOpenEditDiff={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenLink={vi.fn()}
        onRefuseLink={undefined}
        toolImages={{}}
        onReadImage={vi.fn()}
        onMoveToBackground={vi.fn()}
        onStopTask={vi.fn()}
        quoteMenu={null}
      />,
    )
    expect(await screen.findByText('engineering · Codex · t3')).toBeDefined()
  })
})

describe('team label fallbacks', () => {
  it('shows an unknown entry state as it came', () => {
    setup()
    expect(teamEntryStateLabel('quantum')).toBe('quantum')
    expect(teamEntryStateLabel('capped')).toBe('capped')
    expect(teamSwitchReasonLabel('cap')).toBe('cap reached')
  })
})

describe('RVM96B card regressions', () => {
  it('13 locks terminal and host-confirmed cards after remount', () => {
    setup()
    const onAnswer = vi.fn()
    const onDecide = vi.fn()
    const { rerender } = render(
      <TeamWaitingCard entry={{ ...waitingEntry, status: 'completed' }} onAnswer={onAnswer} />,
    )
    expect(screen.getByRole('button', { name: 'Queue it' }).hasAttribute('disabled')).toBe(true)
    rerender(
      <TeamWaitingCard entry={{ ...waitingEntry, teamDecision: 'self' }} onAnswer={onAnswer} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Queue it' }))
    expect(onAnswer).not.toHaveBeenCalled()
    rerender(<TeamMergeCard entry={mergeEntry({ status: 'completed' })} onDecide={onDecide} />)
    expect(screen.getByRole('button', { name: 'Merge' }).hasAttribute('disabled')).toBe(true)
    rerender(<TeamMergeCard entry={mergeEntry({ teamDecision: 'discard' })} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('13 unlocks a refused request on the host’s same-id update, retaining locks on ordinary rerenders', () => {
    setup()
    const onAnswer = vi.fn()
    const onDecide = vi.fn()
    const { rerender } = render(<TeamWaitingCard entry={waitingEntry} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue it' }))
    rerender(<TeamWaitingCard entry={waitingEntry} onAnswer={onAnswer} />)
    expect(screen.getByRole('button', { name: 'Queue it' }).hasAttribute('disabled')).toBe(true)
    rerender(
      <TeamWaitingCard
        entry={{ ...waitingEntry, reasonText: 'Request refused; choose again' }}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.getByRole('button', { name: 'Queue it' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Main agent does it' }))
    expect(onAnswer).toHaveBeenLastCalledWith('wait-1', 'self')
    const first = mergeEntry()
    rerender(<TeamMergeCard entry={first} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(true)
    rerender(<TeamMergeCard entry={{ ...first }} onDecide={onDecide} />)
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(false)
  })

  it('22 shows bounded affected, protected and conflict paths with review details', () => {
    setup()
    const paths = Array.from({ length: 12 }, (_, index) => `src/file-${String(index)}.ts`)
    render(
      <TeamMergeCard
        entry={mergeEntry({
          affectedFiles: paths,
          protectedPaths: ['.muse/team.json'],
          conflictPaths: ['src/conflict.ts'],
          reviewVerdict: 'changes requested',
          reviewerFindings: ['P1: preserve the user edit'],
        })}
      />,
    )
    const affected = within(screen.getByRole('list', { name: 'Affected files' }))
    expect(affected.getAllByRole('listitem')).toHaveLength(11)
    expect(affected.getByText('and 2 more')).toBeDefined()
    expect(affected.queryByText('src/file-10.ts')).toBeNull()
    expect(
      within(screen.getByRole('list', { name: 'Protected paths' })).getByText('.muse/team.json'),
    ).toBeDefined()
    expect(
      within(screen.getByRole('list', { name: 'Conflict paths' })).getByText('src/conflict.ts'),
    ).toBeDefined()
    expect(screen.getByText('Review verdict: changes requested')).toBeDefined()
    expect(screen.getByText('P1: preserve the user edit')).toBeDefined()
  })

  it('22 refuses merge when approval details are missing or the branch is conflicted/moved', () => {
    setup()
    const onDecide = vi.fn()
    const { rerender } = render(
      <TeamMergeCard entry={mergeEntry({ affectedFiles: undefined })} onDecide={onDecide} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(onDecide).not.toHaveBeenCalled()
    for (const overrides of [{ branchMoved: true }, { conflicted: true }]) {
      rerender(<TeamMergeCard entry={mergeEntry(overrides)} onDecide={onDecide} />)
      expect(screen.getByRole('button', { name: 'Merge' }).hasAttribute('disabled')).toBe(true)
    }
  })
})
