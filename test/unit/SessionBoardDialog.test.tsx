// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  SessionBoardDialog,
  type SessionBoardDialogProps,
} from '../../src/webview/components/SessionBoardDialog'
import type { BoardRow } from '../../src/shared/sessionBoard'

function row(overrides: Partial<BoardRow> & { readonly sessionId: string }): BoardRow {
  return {
    title: overrides.sessionId,
    backend: 'modelApi',
    status: 'idle',
    awaitingApproval: false,
    ...overrides,
  }
}

const rows = [
  row({ sessionId: 's1', title: 'Main chat', status: 'running', branch: 'main' }),
  row({
    sessionId: 's2',
    title: 'Attempt',
    branch: 'best-of-n/bon-1/0',
    worktreePath: '/repo/app.worktrees/best-of-n-bon-1-0',
    changedFiles: 3,
    awaitingApproval: true,
  }),
  row({ sessionId: 's3', title: 'Old idea' }),
]

function renderDialog(overrides: Partial<SessionBoardDialogProps> = {}) {
  const props: SessionBoardDialogProps = {
    rows,
    currentSessionId: 's1',
    onResume: vi.fn(),
    onStartBestOfN: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<SessionBoardDialog {...props} />)
  return props
}

describe('SessionBoardDialog', () => {
  it('shows every conversation with its state, branch, changes and approvals', () => {
    renderDialog()
    expect(screen.getByRole('option', { name: /Main chat/ })).toHaveTextContent('Running')
    expect(screen.getByRole('option', { name: /Main chat/ })).toHaveTextContent('main')
    const attempt = screen.getByRole('option', { name: /Attempt/ })
    expect(attempt).toHaveTextContent('best-of-n/bon-1/0')
    expect(attempt).toHaveTextContent('3 changed files')
    expect(attempt).toHaveTextContent('1 approval waiting')
    expect(attempt).toHaveTextContent('/repo/app.worktrees/best-of-n-bon-1-0')
  })

  it('marks rows with unknown change counts', () => {
    renderDialog()
    expect(screen.getByRole('option', { name: /Old idea/ })).toHaveTextContent('changes unknown')
  })

  it('filters by title or branch and resumes with Enter', () => {
    const props = renderDialog()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'best-of-n' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(props.onResume).toHaveBeenCalledWith('s2', 'modelApi')
  })

  it('opens best-of-N and closes with Escape', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Best of N…' }))
    expect(props.onStartBestOfN).toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('says when no conversation matches, and while the host has not answered', () => {
    renderDialog({ rows: [] })
    expect(screen.getByText('No conversations yet. Send a message to start one.')).toBeDefined()
    renderDialog({ rows: undefined })
    expect(screen.getByText('Loading…')).toBeDefined()
  })
})
