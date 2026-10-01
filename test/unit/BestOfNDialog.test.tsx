// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BestOfNDialog, type BestOfNDialogProps } from '../../src/webview/components/BestOfNDialog'
import type { BestOfNAttempt, BestOfNRun } from '../../src/shared/bestOfN'

function attempt(
  overrides: Partial<BestOfNAttempt> & { readonly attemptId: string },
): BestOfNAttempt {
  return {
    branch: `best-of-n/bon-1/${overrides.attemptId}`,
    worktreePath: `/wt/${overrides.attemptId}`,
    status: 'running',
    requestsMade: 0,
    ceilingReached: false,
    approvalsDenied: 0,
    files: [],
    changedLines: 0,
    ...overrides,
  }
}

function runWith(overrides: Partial<BestOfNRun> = {}): BestOfNRun {
  return {
    runId: 'bon-1',
    prompt: 'leave a note',
    modelId: 'muse-spark-1.3',
    baseRef: 'HEAD',
    attempts: 2,
    requestCeilingPerAttempt: 20,
    status: 'running',
    runAttempts: [attempt({ attemptId: '0' }), attempt({ attemptId: '1' })],
    ...overrides,
  }
}

function renderDialog(overrides: Partial<BestOfNDialogProps> = {}) {
  const props: BestOfNDialogProps = {
    run: undefined,
    isPaidOn: true,
    defaultPrompt: 'leave a note',
    onStart: vi.fn(),
    onTake: vi.fn(),
    onOpen: vi.fn(),
    onCancelRun: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<BestOfNDialog {...props} />)
  return props
}

describe('BestOfNDialog', () => {
  it('validates the form before it starts', () => {
    const props = renderDialog()
    const start = screen.getByRole('button', { name: 'Start' })
    expect(start).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '9' } })
    expect(screen.getByText('Attempts must be between 2 and 5.')).toBeDefined()
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: ' '.repeat(3) } })
    expect(screen.getByText('Describe what the attempts should do.')).toBeDefined()
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'leave a note' } })
    fireEvent.click(start)
    expect(props.onStart).toHaveBeenCalledWith('leave a note', 3, 20)
  })

  it('says the feature is off instead of starting', () => {
    renderDialog({ isPaidOn: false })
    expect(
      screen.getByText('Best-of-N is off. Enable it and accept the price before starting a run.'),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('shows running attempts and cancels the run', () => {
    const props = renderDialog({ run: runWith() })
    expect(screen.getByText('Running…')).toBeDefined()
    expect(screen.getByText('best-of-n/bon-1/0')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(props.onCancelRun).toHaveBeenCalled()
  })

  it('takes a finished attempt and compares two diffs side by side', () => {
    const props = renderDialog({
      run: runWith({
        status: 'completed',
        runAttempts: [
          attempt({
            attemptId: '0',
            status: 'completed',
            requestsMade: 2,
            files: [{ path: 'a.txt', insertions: 2, deletions: 0 }],
            changedLines: 2,
            diff: 'left diff',
          }),
          attempt({
            attemptId: '1',
            status: 'completed',
            requestsMade: 3,
            ceilingReached: true,
            files: [{ path: 'b.txt', insertions: 1, deletions: 1 }],
            changedLines: 2,
            diff: 'right diff',
          }),
        ],
      }),
    })
    // The run and both attempts read done.
    expect(screen.getAllByText('Done')).toHaveLength(3)
    expect(screen.getByText(/2 requests/)).toBeDefined()
    expect(screen.getByText(/stopped at the request ceiling/)).toBeDefined()
    const takes = screen.getAllByRole('button', { name: /^Apply and stage:/ })
    expect(takes).toHaveLength(2)
    fireEvent.click(takes[0]!)
    expect(props.onTake).toHaveBeenCalledWith('0')
    // The side-by-side comparison shows both diffs.
    expect(screen.getByText('left diff')).toBeDefined()
    expect(screen.getByText('right diff')).toBeDefined()
  })

  it('marks the taken branch and closes with Escape', () => {
    const props = renderDialog({
      run: runWith({ status: 'completed', takenBranch: 'best-of-n/bon-1/0' }),
    })
    expect(screen.getByText(/Took best-of-n\/bon-1\/0/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Apply and stage:/ })).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })
})
