// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OUTPUT_PREVIEW_CHARS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
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
    isBackground: false,
    backgroundInitiator: undefined,
    approval: undefined,
    approvalOutcome: undefined,
    question: undefined,
    questionOutcome: undefined,
    completedSeq: undefined,
    ...overrides,
  }
}

function transcriptProps(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps>,
): TranscriptProps {
  return {
    entries,
    isRunning: false,
    isFocusView: false,
    outputPages: {},
    onOpenLink: vi.fn(),
    onCopy: vi.fn(),
    onInsert: vi.fn(),
    onReadOutput: vi.fn(),
    onOpenOutput: vi.fn(),
    onDecide: vi.fn(),
    onAnswer: vi.fn(),
    onCancelQuestion: vi.fn(),
    onApply: vi.fn(),
    onOpenEditDiff: vi.fn(),
    onOpenFile: vi.fn(),
    ...overrides,
  }
}

function renderTranscript(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps> = {},
) {
  const props = transcriptProps(entries, overrides)
  render(<Transcript {...props} />)
  return props
}

/** A transcript that can be rendered again with changed props, as the app does. */
function mountTranscript(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps> = {},
) {
  const props = transcriptProps(entries, overrides)
  const view = render(<Transcript {...props} />)
  return {
    props,
    rerender: (changes: Partial<TranscriptProps>) => {
      view.rerender(<Transcript {...props} {...changes} />)
    },
  }
}

const longOutput = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join('\n')

describe('Transcript', () => {
  it('renders every entry kind', () => {
    renderTranscript([
      { kind: 'user', seq: 0, id: 'u1', text: 'hello', status: 'sent', attachments: [attachment] },
      {
        kind: 'user',
        seq: 0,
        id: 'u2',
        text: 'lost',
        status: 'failed',
        reason: 'nope',
        attachments: [],
      },
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
    // Shown, but not alerts: the app's one live region reads them out (M25).
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(screen.queryAllByRole('status')).toEqual([])
    for (const text of ['nope', 'The turn failed.', 'Could not switch model.']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByText('Thought for 14s')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Explorer done')).toBeInTheDocument()
    expect(document.querySelector('.tool-dot-running')).not.toBeNull()
  })

  it('shows the status line while a turn runs', () => {
    renderTranscript([{ kind: 'assistant', id: 'a', text: 'x', isStreaming: true }], {
      isRunning: true,
    })
    expect(screen.getByText('Thinking…').closest('.status-line')).not.toBeNull()
  })

  it('streams the summary while thinking and leaves a plain "Thought for" line after (M16)', () => {
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
        parts: ['still going', ''],
        isStreaming: true,
        startedAt: 0,
        durationMs: undefined,
      },
    ])
    expect(screen.getByText('Thought for 1s')).toBeInTheDocument()
    expect(screen.queryByText('second part')).toBeNull()
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(screen.getByText('still going')).toBeInTheDocument()
    expect(document.querySelectorAll('.reasoning button')).toHaveLength(0)
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
    // Shell rows show their body from the start (M16).
    expect(screen.getByText('IN')).toBeInTheDocument()
    expect(screen.getByText('Get-ChildItem')).toBeInTheDocument()
    expect(screen.getByText('OUT')).toBeInTheDocument()
    expect(screen.queryByText(/line 20/)).toBeNull()
    fireEvent.click(screen.getByText('Show more'))
    expect(screen.getByText(/line 20/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show less'))
    expect(screen.queryByText(/line 20/)).toBeNull()
  })

  // M39: one line of minified output can be megabytes.
  it('clips a long single line by characters, with Show more for the rest', () => {
    const line = `${'a'.repeat(OUTPUT_PREVIEW_CHARS)}TAIL`
    renderTranscript([
      tool({
        id: 'min',
        tool: 'powershell',
        args: '{"command":"Get-Content app.min.js","description":"Read it"}',
        output: line,
      }),
    ])
    expect(screen.queryByText(/TAIL/)).toBeNull()
    expect(screen.getByText(`${'a'.repeat(OUTPUT_PREVIEW_CHARS)}…`)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show more'))
    expect(screen.getByText(/TAIL/)).toBeInTheDocument()
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
    // Edit rows open from the start and fetch their stored patch once (M16).
    expect(props.onReadOutput).toHaveBeenCalledWith('ed', 'tool_patch-1', 0)
    expect(props.onReadOutput).toHaveBeenCalledTimes(1)
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
    expect(screen.getByText('old').closest('tr')?.querySelector('.diff-gutter')).toHaveTextContent(
      '3',
    )
    expect(screen.getByText('Added 1 line')).toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
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

  it('counts the hidden steps in the display language’s plural forms (M40)', () => {
    setUiText(
      {
        ...EN,
        showHiddenSteps: {
          one: 'Pokaż {count} krok',
          few: 'Pokaż {count} kroki',
          many: 'Pokaż {count} kroków',
          other: 'Pokaż {count} kroku',
        },
        hideHiddenSteps: {
          one: 'Ukryj {count} krok',
          few: 'Ukryj {count} kroki',
          many: 'Ukryj {count} kroków',
          other: 'Ukryj {count} kroku',
        },
      },
      'pl',
    )
    try {
      const steps = (count: number) =>
        Array.from({ length: count }, (_, index) => tool({ id: `t${String(index)}` }))
      const two = render(<Transcript {...transcriptProps(steps(2), { isFocusView: true })} />)
      fireEvent.click(screen.getByText('Pokaż 2 kroki'))
      expect(screen.getByText('Ukryj 2 kroki')).toBeInTheDocument()
      two.unmount()
      renderTranscript(steps(5), { isFocusView: true })
      expect(screen.getByText('Pokaż 5 kroków')).toBeInTheDocument()
    } finally {
      setUiText(EN, 'en')
    }
  })
})

describe('Transcript editor integration (M5)', () => {
  it('shows the open-file chip on the user card that carried it', () => {
    renderTranscript([
      {
        kind: 'user',
        seq: 0,
        id: 'u1',
        text: 'explain',
        status: 'sent',
        attachments: [],
        contextLabel: 'App.tsx L5-10',
      },
      { kind: 'user', seq: 0, id: 'u2', text: 'bare', status: 'sent', attachments: [] },
    ])
    expect(screen.getByText('App.tsx L5-10')).toBeInTheDocument()
    expect(screen.getAllByRole('list', { name: 'Attachments' })).toHaveLength(1)
  })

  it('links the path of an edit or read row to the file at its change, with no review buttons (M16)', () => {
    const props = renderTranscript(
      [
        tool({
          id: 'ed',
          tool: 'edit_file',
          args: '{"find":"a","path":"notes.md","replace":"b"}',
          patchRef: { id: 'tool_patch-1', byteLen: 300 },
        }),
        tool({ id: 'rd', tool: 'read_file', args: '{"path":"src/a.ts"}' }),
        tool({
          id: 'sh',
          tool: 'powershell',
          args: '{"command":"ls","description":"List files"}',
          output: 'x',
        }),
      ],
      {
        outputPages: {
          'ed:tool_patch-1': {
            content: JSON.stringify({
              files: [
                {
                  path: 'notes.md',
                  hunks: [{ oldStart: 3, newStart: 3, lines: [' keep', '-old', '+new', '+newer'] }],
                },
              ],
            }),
            isEof: true,
            nextOffset: 1,
          },
        },
      },
    )
    expect(screen.queryByText('Open diff')).toBeNull()
    expect(screen.queryByText('Revert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
    expect(props.onOpenFile).toHaveBeenLastCalledWith('notes.md', { startLine: 4, endLine: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts' }))
    expect(props.onOpenFile).toHaveBeenLastCalledWith('src/a.ts', undefined)
    // A shell row's description is text, not a path.
    expect(screen.queryByRole('button', { name: 'List files' })).toBeNull()
    expect(screen.getByText('List files')).toHaveClass('tool-summary')
  })

  it('routes a code block Apply to the host', () => {
    const props = renderTranscript([
      { kind: 'assistant', id: 'a', text: '```ts\nlet a = 1\n```', isStreaming: false },
    ])
    fireEvent.click(screen.getByText('Apply'))
    expect(props.onApply).toHaveBeenCalledWith('let a = 1')
  })
})

/** A unified diff with more rows than the preview shows. */
const LONG_DIFF = [
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1,15 +1,15 @@',
  ...Array.from({ length: 15 }, (_, index) => ` line ${String(index + 1)}`),
].join('\n')

/** The toggle (dot + label) of the nth tool row. */
function toggle(index: number): HTMLButtonElement {
  const found = document.querySelectorAll<HTMLButtonElement>('.tool-toggle')[index]
  if (found === undefined) {
    throw new Error(`no tool toggle ${String(index)}`)
  }
  return found
}

/** The chevron of the nth tool row's header, if it has one. */
function chevronOf(index: number): Element | null {
  return document.querySelectorAll('.tool-header')[index]?.querySelector('.chevron') ?? null
}

describe('Transcript rows (M15, M16)', () => {
  it('marks rows that open with a chevron that turns, and disables rows with nothing to show', () => {
    renderTranscript([
      tool({ id: 'rd', tool: 'read_file', args: '{"path":"a.ts"}', output: 'a\nb' }),
      tool({ id: 'empty', tool: 'read_file', output: '' }),
    ])
    expect(chevronOf(0)).not.toBeNull()
    expect(chevronOf(0)).not.toHaveClass('chevron-open')
    expect(toggle(0).disabled).toBe(false)
    fireEvent.click(toggle(0))
    expect(chevronOf(0)).toHaveClass('chevron-open')
    expect(chevronOf(1)).toBeNull()
    expect(toggle(1).disabled).toBe(true)
  })

  it('copies a finished response and offers no copy while it streams', () => {
    const props = renderTranscript([
      { kind: 'assistant', id: 'a1', text: 'first **bold**', isStreaming: false },
      { kind: 'assistant', id: 'a2', text: 'partial', isStreaming: true },
    ])
    const copy = screen.getByRole('button', { name: 'Copy response' })
    expect(copy).toHaveAttribute('title', 'Copy response')
    fireEvent.click(copy)
    expect(props.onCopy).toHaveBeenCalledWith('first **bold**')
    expect(copy).toHaveAttribute('title', 'Copied')
  })

  it('opens a shell or read output in an editor on click or Enter, with the stored ref when there is one', () => {
    const props = renderTranscript([
      tool({
        id: 'sh',
        tool: 'powershell',
        args: '{"command":"ls"}',
        output: 'out',
        outputRef: { id: 'ref-1', byteLen: 3 },
      }),
      tool({ id: 'rd', tool: 'read_file', args: '{"path":"a.ts"}', output: 'const a = 1' }),
    ])
    // The shell row is open from the start; the read row opens on click.
    fireEvent.click(toggle(1))
    const [shellOut, readOut] = screen.getAllByTitle('Click to open the output in an editor')
    expect(shellOut).toBeDefined()
    expect(readOut).toBeDefined()
    fireEvent.click(shellOut!)
    expect(props.onOpenOutput).toHaveBeenLastCalledWith('sh', 'PowerShell', 'out', 'ref-1')
    fireEvent.keyDown(readOut!, { key: 'Enter' })
    expect(props.onOpenOutput).toHaveBeenLastCalledWith('rd', 'Read', 'const a = 1', undefined)
    fireEvent.keyDown(readOut!, { key: 'a' })
    expect(props.onOpenOutput).toHaveBeenCalledTimes(2)
  })

  it('offers Click to expand on every diff with a stored patch (the diff editor) and clips long ones inline otherwise', () => {
    const props = renderTranscript([
      tool({
        id: 'e1',
        tool: 'edit_file',
        args: '{"path":"x.ts"}',
        output: '--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
        patchRef: { id: 'p1', byteLen: 10 },
      }),
      tool({ id: 'e2', tool: 'edit_file', args: '{"path":"y.ts"}', output: LONG_DIFF }),
      tool({
        id: 'e3',
        tool: 'edit_file',
        args: '{"path":"z.ts"}',
        output: '--- a/z.ts\n+++ b/z.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
      }),
    ])
    // A short diff with a stored patch still offers the editor; a short one without does not.
    expect(document.querySelectorAll('.diff tr')).toHaveLength(2 + 12 + 2)
    const [stored, inline] = screen.getAllByText('Click to expand')
    expect(screen.getAllByText('Click to expand')).toHaveLength(2)
    fireEvent.click(stored!)
    expect(props.onOpenEditDiff).toHaveBeenCalledWith('e1', 'p1')
    fireEvent.click(inline!)
    expect(document.querySelectorAll('.diff tr')).toHaveLength(2 + 15 + 2)
    expect(screen.getAllByText('Click to expand')).toHaveLength(1)
  })
})

describe('Transcript chat references (M17)', () => {
  it("offers Reply to this output in a reply's actions menu", () => {
    const onReply = vi.fn()
    renderTranscript([{ kind: 'assistant', id: 'a1', text: 'done', isStreaming: false }], {
      onReply,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Message actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply to this output' }))
    expect(onReply).toHaveBeenCalledWith('a1')
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('shows the highlighted-text menu on the row that owns it and relays the choice', () => {
    const onQuote = vi.fn()
    const onCopyQuote = vi.fn()
    const onCloseQuoteMenu = vi.fn()
    renderTranscript(
      [
        { kind: 'assistant', id: 'a1', text: 'done', isStreaming: false },
        { kind: 'user', seq: 0, id: 'u1', text: 'hello', status: 'sent', attachments: [] },
        tool({ id: 't1', tool: 'powershell', args: '{"command":"ls"}', output: 'x' }),
      ],
      { quoteMenuEntryId: 'u1', onQuote, onCopyQuote, onCloseQuoteMenu },
    )
    const menu = screen.getByRole('menu', { name: 'Highlighted text' })
    // Our menu replaces the browser's, so Copy comes first and has the focus (M25).
    const copy = screen.getByRole('menuitem', { name: 'Copy' })
    expect(document.activeElement).toBe(copy)
    fireEvent.click(copy)
    expect(onCopyQuote).toHaveBeenCalledOnce()
    expect(menu.closest('[data-entry-id]')).toHaveAttribute('data-entry-id', 'u1')
    expect(menu.closest('[data-entry-id]')).toHaveAttribute('data-role', 'user')
    expect(document.querySelector('[data-entry-id="t1"]')).toHaveAttribute('data-role', 'tool')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask about this' }))
    expect(onQuote).toHaveBeenCalledWith('question')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Comment on this' }))
    expect(onQuote).toHaveBeenCalledWith('comment')
    fireEvent.keyDown(menu, { key: 'a' })
    expect(onCloseQuoteMenu).not.toHaveBeenCalled()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onCloseQuoteMenu).toHaveBeenCalledOnce()
  })

  it('labels a sent message with what it replied to', () => {
    renderTranscript([
      {
        kind: 'user',
        seq: 0,
        id: 'u',
        text: 'why',
        status: 'sent',
        attachments: [],
        referenceLabel: 'Replying to: Use pnpm.',
      },
    ])
    expect(screen.getByText('Replying to: Use pnpm.')).toBeInTheDocument()
  })
})

/** One page (or the whole) of the `ed` row's patch document. */
function pages(content: string, isEof: boolean, nextOffset: number) {
  return { outputPages: { 'ed:p': { content, isEof, nextOffset } } }
}

/** A stage of a two-command approval whose Reject takes feedback. */
function stage(sourceIndex: number) {
  return {
    approvalId: 'a1',
    requirementId: { approvalId: 'a1', sourceIndex },
    subject: { kind: 'shell', command: 'a; b' },
    rawArgs: '{}',
    availableChoices: [
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
}

function stagedRow(sourceIndex: number) {
  return tool({ id: 'sh', tool: 'powershell', status: 'inProgress', approval: stage(sourceIndex) })
}

function box() {
  return screen.getByPlaceholderText(/what to do instead/)
}

describe('Transcript rows (M25)', () => {
  it('marks a row its turn cut off as interrupted, without an alert', () => {
    renderTranscript([tool({ id: 'sh', tool: 'powershell', status: 'interrupted' })])
    expect(screen.getByText('Interrupted')).toHaveClass('tool-failure')
    expect(document.querySelector('.tool-dot-muted')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads "Thought" for a replayed thought with no measured time, never "Thinking…"', () => {
    renderTranscript([
      { kind: 'reasoning', id: 'r', parts: ['why'], isStreaming: false, startedAt: 0 },
    ])
    expect(screen.getByText('Thought')).toBeInTheDocument()
    expect(screen.queryByText('Thinking…')).toBeNull()
  })

  it('fetches a patch past one page in full, then numbers it; within the page budget', () => {
    const edit = tool({
      id: 'ed',
      tool: 'edit_file',
      args: '{"path":"notes.md"}',
      output: '@@\n-old\n+new',
      patchRef: { id: 'p', byteLen: 600_000 },
    })
    const document_ = JSON.stringify({
      files: [{ path: 'notes.md', hunks: [{ oldStart: 7, newStart: 7, lines: ['-old', '+new'] }] }],
    })
    const view = mountTranscript([edit])
    expect(view.props.onReadOutput).toHaveBeenLastCalledWith('ed', 'p', 0)
    view.rerender(pages(document_.slice(0, 10), false, 262_144))
    expect(view.props.onReadOutput).toHaveBeenLastCalledWith('ed', 'p', 262_144)
    // A partial document is not parsed: the visible diff shows meanwhile.
    expect(document.querySelector('.diff-gutter')?.textContent).toBe('')
    view.rerender(pages(document_, true, 600_000))
    expect(document.querySelector('.diff-gutter')?.textContent).toBe('7')
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
  })

  it('stops fetching a document that never ends at the host page budget', () => {
    const view = mountTranscript([
      tool({ id: 'ed', tool: 'edit_file', args: '{}', patchRef: { id: 'p', byteLen: 1 } }),
    ])
    for (let offset = 1; offset < 20; offset += 1) {
      view.rerender({ outputPages: { 'ed:p': { content: 'x', isEof: false, nextOffset: offset } } })
    }
    const offsets = vi.mocked(view.props.onReadOutput).mock.calls.map((call) => call[2])
    expect(offsets).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('starts the feedback box empty on every stage of a multi-command approval', () => {
    const view = mountTranscript([stagedRow(0)])
    fireEvent.change(box(), { target: { value: 'not the first one' } })
    view.rerender({ entries: [stagedRow(0)] })
    expect(box()).toHaveValue('not the first one')
    view.rerender({ entries: [stagedRow(1)] })
    expect(box()).toHaveValue('')
  })

  it('locks a question card once it was answered or cancelled', () => {
    renderTranscript([
      tool({
        id: 'q',
        tool: 'request_user_input',
        status: 'inProgress',
        question: {
          userInputId: 'u1',
          isSubmitted: true,
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
      }),
    ])
    expect(screen.getByRole('radio', { name: 'Red' })).toBeDisabled()
    expect(screen.getByText('Submit')).toBeDisabled()
    expect(screen.getByText('Cancel')).toBeDisabled()
  })
})

describe('Transcript replies (M25)', () => {
  it('shows a fence still streaming as plain text, and highlights it once closed', () => {
    const streaming = '```ts\nconst a = 1'
    const view = mountTranscript([
      { kind: 'assistant', id: 'a', text: streaming, isStreaming: true },
    ])
    expect(screen.getByText('const a = 1')).toBeInTheDocument()
    expect(screen.getByText('typescript')).toBeInTheDocument()
    expect(document.querySelector('.hljs-keyword')).toBeNull()
    view.rerender({
      entries: [{ kind: 'assistant', id: 'a', text: `${streaming}\n\`\`\``, isStreaming: false }],
    })
    expect(document.querySelector('.hljs-keyword')).not.toBeNull()
  })

  it('opens a relative link as a workspace file and refuses one outside it', () => {
    const onRefuseLink = vi.fn()
    const props = renderTranscript(
      [
        {
          kind: 'assistant',
          id: 'a',
          text: 'See [the parser](src/parser.ts#L12) and [this](../x.txt).',
          isStreaming: false,
        },
      ],
      { onRefuseLink },
    )
    fireEvent.click(screen.getByRole('link', { name: 'the parser' }))
    expect(props.onOpenFile).toHaveBeenCalledWith('src/parser.ts', { startLine: 12, endLine: 12 })
    fireEvent.click(screen.getByRole('link', { name: 'this' }))
    expect(onRefuseLink).toHaveBeenCalledOnce()
    expect(props.onOpenLink).not.toHaveBeenCalled()
  })

  it('takes the text direction from the text itself', () => {
    renderTranscript([
      { kind: 'user', seq: 1, id: 'u', text: 'مرحبا', status: 'sent', attachments: [] },
      { kind: 'assistant', id: 'a', text: 'שלום', isStreaming: false },
    ])
    expect(screen.getByText('مرحبا')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('שלום')).toHaveAttribute('dir', 'auto')
  })

  it('closes the message menus on a press outside them or when the focus leaves', () => {
    renderTranscript(
      [
        { kind: 'user', seq: 1, id: 'u', text: 'hello', status: 'sent', attachments: [] },
        { kind: 'assistant', id: 'a', text: 'done', isStreaming: false },
      ],
      { onFork: vi.fn(), onRewind: vi.fn(), onReply: vi.fn() },
    )
    fireEvent.click(screen.getByLabelText('Fork or rewind'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Message actions' }))
    const item = screen.getByRole('menuitem', { name: 'Reply to this output' })
    fireEvent.pointerDown(item)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.blur(item, { relatedTarget: screen.getByLabelText('Fork or rewind') })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers the rewind alone where the host cannot fork (D26)', () => {
    const onRewind = vi.fn()
    renderTranscript(
      [{ kind: 'user', seq: 1, id: 'u', text: 'hello', status: 'sent', attachments: [] }],
      { onRewind },
    )
    fireEvent.click(screen.getByLabelText('Fork or rewind'))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rewind code to here',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind code to here' }))
    expect(onRewind).toHaveBeenCalledWith('u')
  })
})
