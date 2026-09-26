// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalCard } from '../../src/webview/components/ApprovalCard'
import { TodoPanel } from '../../src/webview/components/TodoPanel'
import type { PendingApproval } from '../../src/webview/state/uiState'

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

  it('locks every control once the current stage has been decided', () => {
    const onDecide = vi.fn()
    render(
      <ApprovalCard
        approval={{ ...approval, decidedSourceIndex: 1 }}
        toolName="powershell"
        onDecide={onDecide}
      />,
    )
    expect(screen.getByRole('group', { name: /^Muse wants to / })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByPlaceholderText(/what to do instead/)).toBeDisabled()
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
    fireEvent.click(screen.getByText('Allow once'))
    expect(onDecide).not.toHaveBeenCalled()
    // A decision on an earlier stage does not lock this one.
    render(
      <ApprovalCard
        approval={{ ...approval, decidedSourceIndex: 0 }}
        toolName="powershell"
        onDecide={onDecide}
      />,
    )
    expect(screen.getAllByText('Allow once')[1]).toBeEnabled()
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

  // M25: rows were keyed by their text, so two tasks with the same text collided.
  it('keeps two tasks with the same text apart', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // A key collision is reported here; the test asserts there is none.
    })
    const { rerender } = render(
      <TodoPanel
        items={[
          { text: 'Run the tests', status: 'completed' },
          { text: 'Run the tests', status: 'pending' },
        ]}
      />,
    )
    rerender(<TodoPanel items={[{ text: 'Run the tests', status: 'pending' }]} />)
    expect(screen.getAllByText('Run the tests')).toHaveLength(1)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('ApprovalCard tool subjects (M18)', () => {
  it('says "use" before a bare tool name, as for subagent_spawn', () => {
    render(
      <ApprovalCard
        approval={{
          approvalId: 'a2',
          requirementId: { approvalId: 'a2', sourceIndex: 0 },
          subject: { kind: 'tool', toolName: 'subagent_spawn' },
          rawArgs: '{"objective":"Map the tree","role":"explorer"}',
          availableChoices: [
            { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
          ],
          isProtectedWrite: false,
          isJudgeEscalated: false,
        }}
        toolName="subagent_spawn"
        onDecide={vi.fn()}
      />,
    )
    expect(screen.getByText('subagent_spawn').closest('.approval-title')).toHaveTextContent(
      'Muse wants to use subagent_spawn',
    )
    expect(screen.getByText('Map the tree')).toHaveClass('approval-prompt')
  })
})

describe('ApprovalCard for a paid call (M34, PLAN.md D30)', () => {
  const imageApproval: PendingApproval = {
    approvalId: 'i1',
    requirementId: { approvalId: 'i1', sourceIndex: 0 },
    rawArgs: JSON.stringify({ prompt: 'A lighthouse at dusk, flat colours', path: 'art/l.png' }),
    subject: {
      kind: 'paidTool',
      toolName: 'generate_image',
      path: 'art/l.png',
      paidFeature: 'imageGeneration',
    },
    availableChoices: [
      { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
      { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
    ],
    isProtectedWrite: false,
    isJudgeEscalated: false,
  }

  it('says what it creates, shows the prompt, and names the price', () => {
    render(<ApprovalCard approval={imageApproval} toolName="generate_image" onDecide={vi.fn()} />)
    const card = screen.getByRole('group', { name: 'Muse wants to create the image art/l.png' })
    expect(card).toHaveTextContent('A lighthouse at dusk, flat colours')
    expect(card).toHaveTextContent('Paid: $0.01 per image, billed to your Model API key')
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Allow once',
      'Reject',
    ])
  })

  it('names an edit’s new file and the images it starts from (M44)', () => {
    const editApproval: PendingApproval = {
      ...imageApproval,
      rawArgs: JSON.stringify({
        prompt: 'Add a red hat',
        images: ['art/fox.png', 'art/hat.webp'],
        path: 'art/fox-hat.png',
      }),
      subject: { ...imageApproval.subject, toolName: 'edit_image', path: 'art/fox-hat.png' },
    }
    render(<ApprovalCard approval={editApproval} toolName="edit_image" onDecide={vi.fn()} />)
    const card = screen.getByRole('group', {
      name: 'Muse wants to make the edited image art/fox-hat.png',
    })
    expect(card).toHaveTextContent('Add a red hat')
    expect(card).toHaveTextContent('Starting from art/fox.png, art/hat.webp')
    expect(card).toHaveTextContent('Paid: $0.01 per image')
  })

  it('shows one-use child consent with its actual model, objective, rates and request limit', () => {
    const approval: PendingApproval = {
      ...imageApproval,
      rawArgs: JSON.stringify({ role: 'reviewer', objective: 'Review current changes' }),
      subject: {
        kind: 'paidTool',
        toolName: 'subagent_spawn',
        paidFeature: 'subagents',
        modelId: 'muse-spark-1.3-contributor',
        requestLimit: 4,
      },
    }
    render(<ApprovalCard approval={approval} toolName="subagent_spawn" onDecide={vi.fn()} />)
    const card = screen.getByRole('group', { name: 'Run paid subagent task reviewer?' })
    expect(card).toHaveTextContent('Review current changes')
    expect(card).toHaveTextContent('muse-spark-1.3-contributor')
    expect(card).toHaveTextContent('$0.100 input, $0.002 cached input, $0.200 output')
    expect(card).toHaveTextContent('4 requests per task, including retries')
    expect(screen.queryByRole('button', { name: /session/i })).not.toBeInTheDocument()
  })
})
