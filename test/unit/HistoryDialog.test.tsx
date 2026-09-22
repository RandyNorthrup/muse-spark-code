// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionRow } from '../../src/shared/sessions'
import {
  HistoryDialog,
  type HistoryDialogProps,
  layoutHistory,
} from '../../src/webview/components/HistoryDialog'

const NOW = new Date(2026, 8, 22, 15, 30).getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function row(overrides: Partial<SessionRow> & { readonly sessionId: string }): SessionRow {
  return {
    title: overrides.sessionId,
    isNamed: false,
    createdAt: new Date(NOW - HOUR).toISOString(),
    updatedAt: new Date(NOW - HOUR).toISOString(),
    status: 'notLoaded',
    turnCount: 1,
    isFork: false,
    ...overrides,
  }
}

const sessions = [
  row({ sessionId: 'now', title: 'Fix the parser', turnCount: 3, branch: 'main' }),
  row({
    sessionId: 'yesterday',
    title: 'Write docs',
    updatedAt: new Date(NOW - DAY).toISOString(),
    isFork: true,
  }),
  row({ sessionId: 'stale', title: 'Old idea', updatedAt: new Date(NOW - 30 * DAY).toISOString() }),
  row({ sessionId: 'archived', title: 'Put away' }),
]

function renderDialog(overrides: Partial<HistoryDialogProps> = {}) {
  const props: HistoryDialogProps = {
    sessions,
    archivedIds: ['archived'],
    currentSessionId: 'now',
    archiveAfterDays: 14,
    now: () => NOW,
    onResume: vi.fn(),
    onSetArchived: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<HistoryDialog {...props} />)
  return { props, search: screen.getByRole('combobox') }
}

function optionTitles(): string[] {
  return screen
    .getAllByRole('option')
    .map((option) => option.querySelector('.palette-item-label')?.textContent ?? '')
}

describe('layoutHistory', () => {
  it('numbers rows across groups', () => {
    const entries = layoutHistory([
      { id: 'today', title: 'Today', rows: [sessions[0]!, sessions[3]!] },
      { id: 'yesterday', title: 'Yesterday', rows: [sessions[1]!] },
    ])
    expect(entries.map((entry) => (entry.kind === 'title' ? entry.title : entry.index))).toEqual([
      'Today',
      0,
      1,
      'Yesterday',
      2,
    ])
  })
})

describe('HistoryDialog', () => {
  it('groups the visible sessions, marks the current one and shows the row details', () => {
    renderDialog()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.queryByText('Older')).toBeNull()
    expect(optionTitles()).toEqual(['Fix the parsercurrent', 'Write docs'])
    expect(screen.getByText('1 h ago · 3 turns · main')).toBeInTheDocument()
    expect(screen.getByText('1 d ago · 1 turn · fork')).toBeInTheDocument()
  })

  it('shows archived and stale rows behind the switch, with Unarchive on the archived one', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByLabelText('Show archived'))
    expect(optionTitles()).toEqual(['Fix the parsercurrent', 'Put away', 'Write docs', 'Old idea'])
    fireEvent.click(screen.getByLabelText('Unarchive: Put away'))
    expect(props.onSetArchived).toHaveBeenCalledWith('archived', false)
    // A row hidden by age is not in the archived set: it still offers Archive.
    fireEvent.click(screen.getByLabelText('Archive: Old idea'))
    expect(props.onSetArchived).toHaveBeenCalledWith('stale', true)
    expect(props.onResume).not.toHaveBeenCalled()
  })

  it('filters on title and branch and says when nothing matches', () => {
    const { search } = renderDialog()
    fireEvent.change(search, { target: { value: 'docs' } })
    expect(optionTitles()).toEqual(['Write docs'])
    fireEvent.change(search, { target: { value: 'MAIN' } })
    expect(optionTitles()).toEqual(['Fix the parsercurrent'])
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('No sessions match.')).toBeInTheDocument()
  })

  it('resumes with Enter on the arrowed row or with a click, closes on Escape', () => {
    const { props, search } = renderDialog()
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(props.onResume).toHaveBeenCalledWith('yesterday')
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(props.onResume).toHaveBeenLastCalledWith('now')
    fireEvent.click(screen.getByText('Write docs'))
    expect(props.onResume).toHaveBeenLastCalledWith('yesterday')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
    fireEvent.blur(search)
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('explains the loading and the empty states', () => {
    renderDialog({ sessions: undefined })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('says when the workspace has no sessions', () => {
    renderDialog({ sessions: [] })
    expect(screen.getByText('No sessions in this workspace yet.')).toBeInTheDocument()
  })
})
