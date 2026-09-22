// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { segment, Transcript, type TranscriptProps } from '../../src/webview/components/Transcript'
import type { TranscriptEntry } from '../../src/webview/state/uiState'

const attachment = {
  id: 'att-1',
  name: 'shot.png',
  mediaType: 'image/png',
  width: 695,
  height: 1032,
  sizeBytes: 24,
}

function tool(overrides: Partial<Extract<TranscriptEntry, { kind: 'tool' }>>) {
  return {
    kind: 'tool' as const,
    id: 't',
    tool: 'read_file',
    args: '{"path":"a.ts"}',
    status: 'completed',
    output: '',
    failureReason: undefined,
    patchSummary: undefined,
    patchRef: undefined,
    outputRef: undefined,
    approval: undefined,
    approvalOutcome: undefined,
    question: undefined,
    questionOutcome: undefined,
    ...overrides,
  }
}

function renderTranscript(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps> = {},
) {
  const props: TranscriptProps = {
    entries,
    isRunning: false,
    isFocusView: false,
    outputPages: {},
    onOpenLink: vi.fn(),
    onCopy: vi.fn(),
    onInsert: vi.fn(),
    onReadOutput: vi.fn(),
    onDecide: vi.fn(),
    onAnswer: vi.fn(),
    ...overrides,
  }
  render(<Transcript {...props} />)
  return props
}

const longOutput = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join('\n')

describe('Transcript', () => {
  it('renders every entry kind', () => {
    renderTranscript([
      { kind: 'user', id: 'u1', text: 'hello', status: 'sent', attachments: [attachment] },
      { kind: 'user', id: 'u2', text: 'lost', status: 'failed', reason: 'nope', attachments: [] },
      { kind: 'assistant', id: 'a1', text: '**bold** streaming', isStreaming: true },
      { kind: 'assistant', id: 'a2', text: 'done', isStreaming: false },
      {
        kind: 'reasoning',
        id: 'r1',
        parts: ['because'],
        isStreaming: false,
        startedAt: 0,
        durationMs: 14_200,
      },
      tool({ id: 't1', status: 'inProgress' }),
      { kind: 'item', id: 'i1', itemKind: 'subagent', status: 'completed', text: 'Explorer done' },
      { kind: 'error', id: 'e1', text: 'The turn failed.' },
      { kind: 'notice', id: 'n1', level: 'info', text: 'Nothing to compact.' },
      { kind: 'notice', id: 'n2', level: 'error', text: 'Could not switch model.' },
    ])
    const list = screen.getByRole('list', { name: 'Conversation' })
    expect(list.querySelectorAll(':scope > li')).toHaveLength(10)
    expect(screen.getByText('shot.png')).toBeInTheDocument()
    expect(screen.getByText('695×1032')).toBeInTheDocument()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
      'nope',
      'The turn failed.',
      'Could not switch model.',
    ])
    expect(screen.getByText('Thought for 14s')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Explorer done')).toBeInTheDocument()
    expect(document.querySelector('.tool-dot-running')).not.toBeNull()
  })

  it('shows the status line while a turn runs', () => {
    renderTranscript([{ kind: 'assistant', id: 'a', text: 'x', isStreaming: true }], {
      isRunning: true,
    })
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…')
  })

  it('opens a reasoning row to its parts and labels a streaming one', () => {
    renderTranscript([
      {
        kind: 'reasoning',
        id: 'r1',
        parts: ['first part', 'second part'],
        isStreaming: false,
        startedAt: 0,
        durationMs: 400,
      },
      {
        kind: 'reasoning',
        id: 'r2',
        parts: [],
        isStreaming: true,
        startedAt: 0,
        durationMs: undefined,
      },
    ])
    fireEvent.click(screen.getByText('Thought for 1s'))
    expect(screen.getByText('second part')).toBeInTheDocument()
    expect(screen.getByText('Thinking…').closest('button')).toBeDisabled()
  })

  it('renders shell rows with IN/OUT boxes and clips long output', () => {
    renderTranscript([
      tool({
        id: 'sh',
        tool: 'powershell',
        args: '{"command":"Get-ChildItem","description":"List files"}',
        output: longOutput,
      }),
    ])
    fireEvent.click(screen.getByText('PowerShell'))
    expect(screen.getByText('IN')).toBeInTheDocument()
    expect(screen.getByText('Get-ChildItem')).toBeInTheDocument()
    expect(screen.getByText('OUT')).toBeInTheDocument()
    expect(screen.queryByText(/line 20/)).toBeNull()
    fireEvent.click(screen.getByText('Show more'))
    expect(screen.getByText(/line 20/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show less'))
    expect(screen.queryByText(/line 20/)).toBeNull()
  })

  it('renders an edit row from the visible-output diff, then from the fetched patch', () => {
    const props = renderTranscript([
      tool({
        id: 'ed',
        tool: 'edit_file',
        args: '{"find":"a","path":"notes.md","replace":"b"}',
        output: '--- original\n+++ updated\n@@\n-first line\n+second line\n',
        patchSummary: { files: 1, added: 1, removed: 1 },
        patchRef: { id: 'tool_patch-1', byteLen: 300 },
      }),
    ])
    expect(screen.getByText('Modified')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Edit'))
    expect(props.onReadOutput).toHaveBeenCalledWith('ed', 'tool_patch-1', 0)
    expect(screen.getByText('first line').closest('tr')).toHaveClass('diff-remove')
    expect(screen.getByText('second line').closest('tr')).toHaveClass('diff-add')
  })

  it('renders a fetched patch with line numbers and a write from its content', () => {
    renderTranscript(
      [
        tool({
          id: 'ed',
          tool: 'edit_file',
          args: '{}',
          patchRef: { id: 'p', byteLen: 1 },
        }),
        tool({
          id: 'wr',
          tool: 'write_file',
          args: String.raw`{"content":"hi\n","path":"hello.txt"}`,
          patchSummary: { files: 1, added: 1, removed: 0 },
        }),
        tool({ id: 'pending', tool: 'edit_file', args: '{}', patchRef: { id: 'q', byteLen: 1 } }),
      ],
      {
        outputPages: {
          'ed:p': {
            content: JSON.stringify({
              files: [
                {
                  path: 'notes.md',
                  hunks: [{ oldStart: 3, newStart: 3, lines: ['-old', '+new'] }],
                },
              ],
            }),
            isEof: true,
            nextOffset: 1,
          },
        },
      },
    )
    fireEvent.click(screen.getAllByText('Edit')[0]!)
    expect(screen.getByText('old').closest('tr')?.querySelector('.diff-gutter')).toHaveTextContent(
      '3',
    )
    fireEvent.click(screen.getByText('Write'))
    expect(screen.getByText('Added 1 line')).toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Edit')[1]!)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows failures, generic bodies, and decided or answered outcomes', () => {
    renderTranscript([
      tool({
        id: 'f',
        tool: 'powershell',
        args: '{"command":"ls"}',
        status: 'failed',
        failureReason: 'sandbox enforcement unavailable',
        approvalOutcome: { decision: 'approved', resolvedBy: 'user' },
      }),
      tool({
        id: 'g',
        tool: 'grep_files',
        args: '{"pattern":"x"}',
        output: 'match',
        status: 'rejected',
        questionOutcome: {
          outcome: 'answered',
          answers: [{ questionId: 'c', selectedLabel: 'Red' }],
        },
      }),
    ])
    expect(screen.getByText(/Failed: sandbox enforcement unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/Rejected/)).toBeInTheDocument()
    expect(screen.getByText(/Decided: approved \(user\)/)).toBeInTheDocument()
    expect(screen.getByText(/Answered: Red/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('grep_files'))
    expect(screen.getByText('{"pattern":"x"}')).toBeInTheDocument()
    expect(screen.getByText('match')).toBeInTheDocument()
  })

  it('folds steps behind one row in Focus view but never a step waiting on the user', () => {
    const waiting = tool({
      id: 'w',
      tool: 'request_user_input',
      args: '{}',
      status: 'inProgress',
      question: {
        userInputId: 'q',
        questions: [
          {
            id: 'c',
            header: 'Colour',
            question: 'Which?',
            selection: { mode: 'single' },
            options: [{ label: 'Red' }],
          },
        ],
      },
    })
    const entries: TranscriptEntry[] = [
      { kind: 'assistant', id: 'a', text: 'plan', isStreaming: false },
      tool({ id: 't1' }),
      { kind: 'reasoning', id: 'r', parts: [], isStreaming: false, startedAt: 0, durationMs: 1 },
      waiting,
      tool({ id: 't2' }),
    ]
    expect(segment(entries, true).map((part) => part.kind)).toEqual([
      'entry',
      'steps',
      'entry',
      'steps',
    ])
    expect(segment(entries, false).every((part) => part.kind === 'entry')).toBe(true)
    renderTranscript(entries, { isFocusView: true })
    expect(screen.getByText('Show 2 steps hidden by Focus view')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Red' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show 2 steps hidden by Focus view'))
    expect(screen.getByText('Hide 2 steps hidden by Focus view')).toBeInTheDocument()
    expect(screen.getAllByText('Read')).toHaveLength(1)
    expect(screen.getByText('Show 1 step hidden by Focus view')).toBeInTheDocument()
  })
})
