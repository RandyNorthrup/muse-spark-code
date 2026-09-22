// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalCard } from '../../src/webview/components/ApprovalCard'
import { QuestionCard } from '../../src/webview/components/QuestionCard'
import { TodoPanel } from '../../src/webview/components/TodoPanel'
import type { PendingApproval, PendingQuestion } from '../../src/webview/state/uiState'

const approval: PendingApproval = {
  approvalId: 'a1',
  requirementId: { approvalId: 'a1', sourceIndex: 1 },
  rawArgs: '{"command":"Set-Content x; Get-Content x"}',
  subject: {
    kind: 'shell',
    command: 'Set-Content x; Get-Content x',
    stages: [
      {
        requirementId: { approvalId: 'a1', sourceIndex: 0 },
        position: 1,
        totalStages: 2,
        argv: ['Set-Content', 'x'],
      },
      {
        requirementId: { approvalId: 'a1', sourceIndex: 1 },
        position: 2,
        totalStages: 2,
        argv: ['Get-Content', 'x'],
      },
    ],
  },
  availableChoices: [
    { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
    {
      choiceId: 'allow_local_prefix',
      label: 'Always allow in this workspace: Get-Content ...',
      decision: 'approvedPolicyAmendment',
      scope: 'localPersistent',
      rulePreview: 'Always allow in this workspace: Get-Content ...',
    },
    { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once', acceptsFeedback: true },
  ],
  isProtectedWrite: true,
  isJudgeEscalated: false,
}

describe('ApprovalCard', () => {
  it('shows the current stage, flags, and sends the chosen decision with feedback', () => {
    const onDecide = vi.fn()
    render(<ApprovalCard approval={approval} toolName="powershell" onDecide={onDecide} />)
    expect(screen.getByText('Get-Content x')).toBeInTheDocument()
    expect(screen.getByText('(step 2 of 2)')).toBeInTheDocument()
    expect(screen.getByText('Protected write')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/what to do instead/), {
      target: { value: ' use the file tool ' },
    })
    fireEvent.click(screen.getByText('Allow once'))
    expect(onDecide).toHaveBeenLastCalledWith({
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 1 },
      feedback: undefined,
    })
    fireEvent.click(screen.getByText('Reject'))
    expect(onDecide).toHaveBeenLastCalledWith({
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 1 },
      feedback: 'use the file tool',
    })
    expect(screen.getByTitle('Always allow in this workspace: Get-Content ...')).toHaveClass(
      'button-primary',
    )
  })

  it('falls back to the subject fields and hides the feedback box without such a choice', () => {
    const onDecide = vi.fn()
    render(
      <ApprovalCard
        approval={{
          ...approval,
          subject: { kind: 'fileAccess', path: '/etc/hosts' },
          availableChoices: [approval.availableChoices[0]!],
          isProtectedWrite: false,
        }}
        toolName="write_file"
        onDecide={onDecide}
      />,
    )
    expect(screen.getByText('/etc/hosts')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/what to do instead/)).toBeNull()
    expect(screen.queryByText('Protected write')).toBeNull()
    render(
      <ApprovalCard
        approval={{ ...approval, subject: { kind: 'tool' }, isJudgeEscalated: true }}
        toolName="mystery"
        onDecide={onDecide}
      />,
    )
    expect(screen.getByText('mystery')).toBeInTheDocument()
    expect(screen.getByText('Escalated by the safety check')).toBeInTheDocument()
  })
})

const question: PendingQuestion = {
  userInputId: 'q1',
  questions: [
    {
      id: 'colour',
      header: 'Colour',
      question: 'Which colour?',
      selection: { mode: 'single' },
      options: [{ label: 'Red' }, { label: 'Blue', description: 'cool' }],
    },
    {
      id: 'tools',
      header: 'Tools',
      question: 'Pick up to two',
      selection: { mode: 'multiple', minSelections: 1, maxSelections: 2 },
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    },
    {
      id: 'name',
      header: 'Name',
      question: 'What is it called?',
      selection: { mode: 'single' },
      options: [],
    },
  ],
}

describe('QuestionCard', () => {
  it('collects single, multiple and free-text answers before enabling Submit', () => {
    const onAnswer = vi.fn()
    render(<QuestionCard question={question} onAnswer={onAnswer} />)
    const submit = screen.getByText('Submit')
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Red' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }))
    expect(screen.getByRole('checkbox', { name: 'C' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Type your answer'), {
      target: { value: 'Muse' },
    })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(onAnswer).toHaveBeenCalledWith('q1', [
      { questionId: 'colour', selectedLabel: 'Blue' },
      { questionId: 'tools', selectedLabels: ['B'] },
      { questionId: 'name', freeText: 'Muse' },
    ])
  })
})

describe('TodoPanel', () => {
  it('lists tasks with their status marks and the active form, and hides when empty', () => {
    const { rerender } = render(
      <TodoPanel
        items={[
          { text: 'Write tests', status: 'inProgress', activeForm: 'Writing tests' },
          { text: 'Ship', status: 'pending' },
          { text: 'Plan', status: 'completed' },
          { text: 'Skip', status: 'cancelled' },
        ]}
      />,
    )
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByText('Writing tests')).toBeInTheDocument()
    expect(screen.getByText('Plan').closest('li')).toHaveClass('todo-completed')
    rerender(<TodoPanel items={[]} />)
    expect(screen.queryByRole('region')).toBeNull()
  })
})
