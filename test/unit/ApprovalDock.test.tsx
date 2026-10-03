// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { ApprovalDock } from '../../src/webview/components/ApprovalDock'
import type { PendingApproval, WaitingApproval } from '../../src/webview/state/uiState'

/** A two-step approval waiting on `sourceIndex`, its Reject taking feedback. */
function pending(approvalId: string, sourceIndex = 0): WaitingApproval {
  const approval: PendingApproval = {
    approvalId,
    requirementId: { approvalId, sourceIndex },
    subject: {
      kind: 'shell',
      command: 'Set-Content x; Get-Content x',
      stages: [0, 1].map((index) => ({
        requirementId: { approvalId, sourceIndex: index },
        position: index + 1,
        totalStages: 2,
        argv: [index === 0 ? 'Set-Content' : 'Get-Content', 'x'],
      })),
    },
    rawArgs: '{}',
    availableChoices: [
      { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
      {
        choiceId: 'abort',
        label: 'Reject',
        decision: 'abort',
        scope: 'once',
        acceptsFeedback: true,
      },
    ],
    isProtectedWrite: false,
    isJudgeEscalated: false,
  }
  return { entryId: `row-${approvalId}`, toolName: 'powershell', approval }
}

function card() {
  return screen.getByRole('group', { name: /^Muse wants to / })
}

function box() {
  return screen.getByPlaceholderText(/what to do instead/)
}

describe('ApprovalDock (D26)', () => {
  it('shows nothing while no approval waits', () => {
    const { container } = render(<ApprovalDock waiting={[]} onDecide={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('docks the oldest approval, with how many wait, and decides it', () => {
    const onDecide = vi.fn()
    render(
      <ApprovalDock waiting={[pending('a1'), pending('a2'), pending('a3')]} onDecide={onDecide} />,
    )
    const dock = screen.getByRole('region', { name: UI_TEXT.approvalDockLabel })
    expect(dock).toContainElement(card())
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.getByText('Approvals waiting: 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(onDecide).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'a1', choiceId: 'allow_once' }),
    )
  })

  it('says no count for a single approval', () => {
    render(<ApprovalDock waiting={[pending('a1')]} onDecide={vi.fn()} />)
    expect(screen.queryByText(/^Approvals waiting/)).toBeNull()
  })

  it('moves focus to an arriving card, onto the card and not a choice', () => {
    const { rerender } = render(<ApprovalDock waiting={[]} onDecide={vi.fn()} />)
    rerender(<ApprovalDock waiting={[pending('a1')]} onDecide={vi.fn()} />)
    expect(card()).toHaveFocus()
    // Its next step is a new card, which takes focus in turn.
    rerender(<ApprovalDock waiting={[pending('a1', 1)]} onDecide={vi.fn()} />)
    expect(card()).toHaveFocus()
  })

  it('leaves focus where the user types; the live region announces the card instead', () => {
    const composer = document.createElement('textarea')
    document.body.append(composer)
    composer.value = 'half a sentence'
    composer.focus()
    const { rerender } = render(<ApprovalDock waiting={[]} onDecide={vi.fn()} />)
    rerender(<ApprovalDock waiting={[pending('a1')]} onDecide={vi.fn()} />)
    expect(composer).toHaveFocus()
    // A key a moment ago is typing too, even in an empty field.
    composer.value = ''
    fireEvent.keyDown(composer, { key: 'a' })
    rerender(<ApprovalDock waiting={[pending('a2')]} onDecide={vi.fn()} />)
    expect(composer).toHaveFocus()
    composer.remove()
  })

  it('takes focus from an empty composer that only kept it after a send', () => {
    const composer = document.createElement('textarea')
    document.body.append(composer)
    composer.focus()
    const { rerender } = render(<ApprovalDock waiting={[]} onDecide={vi.fn()} />)
    rerender(<ApprovalDock waiting={[pending('a1')]} onDecide={vi.fn()} />)
    expect(card()).toHaveFocus()
    composer.remove()
  })

  it('takes no focus behind a modal', () => {
    render(<ApprovalDock waiting={[pending('a1')]} onDecide={vi.fn()} isInert />)
    expect(card()).not.toHaveFocus()
    expect(screen.getByRole('region', { hidden: true })).toHaveAttribute('inert')
  })

  it('starts the feedback box empty on every stage of a multi-command approval (M25)', () => {
    const { rerender } = render(<ApprovalDock waiting={[pending('a1')]} onDecide={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'not the first one' } })
    rerender(<ApprovalDock waiting={[pending('a1')]} onDecide={vi.fn()} />)
    expect(box()).toHaveValue('not the first one')
    rerender(<ApprovalDock waiting={[pending('a1', 1)]} onDecide={vi.fn()} />)
    expect(box()).toHaveValue('')
  })
})
