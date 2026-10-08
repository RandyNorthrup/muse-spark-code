import { Usd } from '../../src/shared/usd'
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OUTPUT_PREVIEW_CHARS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { segment, Transcript } from '../../src/webview/components/Transcript'
import { QuestionSurface } from '../../src/webview/components/QuestionSurface'
import type { TranscriptEntry } from '../../src/webview/state/uiState'
import {
  mountTranscript,
  renderSteps,
  renderTranscript,
  selectPassage,
  tool,
  warmRowMenus,
  transcriptProps,
} from './helpers/transcriptFixtures'
import { warmDeferredSurfaces } from './helpers/warmDeferredSurfaces'

beforeAll(warmDeferredSurfaces)

const attachment = {
  id: 'att-1',
  name: 'shot.png',
  mediaType: 'image/png',
  width: 695,
  height: 1032,
  sizeBytes: 24,
}

const longOutput = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join('\n')

/** A question card waiting on the user: a step that never folds. */
function waitingQuestion() {
  return tool({
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
}

beforeAll(warmRowMenus)

describe('Transcript', () => {
  it('marks a MessageDisplay hook’s rewrite and keeps the original one click away (M91)', () => {
    const copied: string[] = []
    renderTranscript(
      [
        {
          kind: 'assistant',
          id: 'a1',
          text: 'the model wrote this',
          displayText: 'a hook wrote this',
          isStreaming: false,
        },
        { kind: 'assistant', id: 'a2', text: 'same', displayText: 'same', isStreaming: false },
      ],
      {
        onCopy: (text: string) => {
          copied.push(text)
        },
      },
    )
    expect(screen.getByText('a hook wrote this')).toBeTruthy()
    expect(screen.queryByText('the model wrote this')).toBeNull()
    expect(screen.getAllByRole('note')).toHaveLength(1)
    expect(screen.getByRole('note').textContent).toContain(UI_TEXT.hookMessageEdited)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.hookMessageShowOriginal }))
    expect(screen.getByText('the model wrote this')).toBeTruthy()
    expect(screen.queryByText('a hook wrote this')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.hookMessageShowEdited }))
    expect(screen.getByText('a hook wrote this')).toBeTruthy()
    // Copy takes the original, whichever version shows.
    // Copy lives in each row's actions menu (0.13.0).
    const menus = screen.getAllByRole('button', { name: UI_TEXT.rowMoreActions })
    expect(menus).toHaveLength(2)
    fireEvent.click(menus[0] ?? document.body)
    fireEvent.click(screen.getByRole('menuitem', { name: UI_TEXT.copyResponse }))
    expect(copied).toEqual(['the model wrote this'])
  })

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

  it('labels a reply’s dollar amount estimated and shows it only while the setting is on (M82)', async () => {
    setUiText(EN, 'en')
    const reply: TranscriptEntry = {
      kind: 'assistant',
      id: 'a',
      text: 'done',
      isStreaming: false,
      usage: { inputTokens: 12_300, outputTokens: 678, cachedTokens: 10_000, reasoningTokens: 0 },
      costUsd: Usd.from(0.018).toAmount(),
    }
    const { rerender } = mountTranscript([reply])
    expect(screen.queryByText('12.3K in · 678 out · estimated $0.0180')).toBeNull()
    rerender({ showReplyUsage: true })
    // The exact cost arrives with the lazy money chunk (STARTUP017): the
    // line is absent, never guessed, then states the same amount.
    expect(screen.queryByText('12.3K in · 678 out · estimated $0.0180')).toBeNull()
    expect(await screen.findByText('12.3K in · 678 out · estimated $0.0180')).toBeInTheDocument()
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
    renderSteps(
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

  it('names the Auto reviewer and its reason under a call it allowed (M90)', () => {
    renderTranscript([
      tool({
        id: 'r',
        tool: 'powershell',
        args: '{"command":"Get-Content notes.md"}',
        status: 'completed',
        approvalOutcome: {
          decision: 'approved',
          resolvedBy: 'Auto reviewer',
          reason: 'Allowed: reads workspace file to fulfill line-count request',
        },
      }),
    ])
    expect(screen.getByText(/Decided: approved \(Auto reviewer\)/)).toBeInTheDocument()
    expect(
      screen.getByText('Allowed: reads workspace file to fulfill line-count request'),
    ).toBeInTheDocument()
  })

  it('shows failures, generic bodies, and decided or answered outcomes', async () => {
    renderSteps([
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
    await act(async () => {
      await import('../../src/webview/components/QuestionUi')
    })
    expect(screen.getByText(/Failed: sandbox enforcement unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/Rejected/)).toBeInTheDocument()
    expect(screen.getByText(/Decided: approved \(user\)/)).toBeInTheDocument()
    expect(screen.getByText(/Answered: Red/)).toBeInTheDocument()
    // Only an approval the Auto reviewer allowed carries its reason (M90).
    expect(screen.queryByText(/^Allowed:/)).toBeNull()
    fireEvent.click(screen.getByText('grep_files'))
    // Indented as data (M43).
    expect(screen.getByText('{ "pattern": "x" }')).toBeInTheDocument()
    expect(screen.getByText('match')).toBeInTheDocument()
  })

  it('folds steps under one summary in Focus view but never a step waiting on the user', async () => {
    const entries: TranscriptEntry[] = [
      { kind: 'assistant', id: 'a', text: 'plan', isStreaming: false },
      tool({ id: 't1' }),
      { kind: 'reasoning', id: 'r', parts: [], isStreaming: false, startedAt: 0, durationMs: 1 },
      waitingQuestion(),
      tool({ id: 't2' }),
    ]
    expect(segment(entries, true).map((part) => part.kind)).toEqual([
      'entry',
      'steps',
      'entry',
      'steps',
    ])
    renderTranscript(entries, { isFocusView: true })
    await act(async () => {
      await import('../../src/webview/components/QuestionUi')
    })
    // Focus view folds a single step too, as before, now under its summary (M87).
    const summaries = screen.getAllByRole('button', { name: 'Read a file' })
    expect(summaries).toHaveLength(2)
    const marker = screen.getByRole('button', { name: 'Answer Open question Colour' })
    expect(marker.closest('.steps')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    fireEvent.click(summaries[0]!)
    expect(summaries[0]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText('Read')).toHaveLength(1)
    expect(summaries[1]).toHaveAttribute('aria-expanded', 'false')
  })

  it('counts each part in the display language’s plural forms (M40, M87)', () => {
    setUiText(
      {
        ...EN,
        stepSummary: {
          ...EN.stepSummary,
          read: {
            one: 'odczytano {count} plik',
            few: 'odczytano {count} pliki',
            many: 'odczytano {count} plików',
            other: 'odczytano {count} pliku',
          },
        },
      },
      'pl',
    )
    try {
      const steps = (count: number) =>
        Array.from({ length: count }, (_, index) =>
          tool({ id: `t${String(index)}`, args: `{"path":"f${String(index)}.ts"}` }),
        )
      const two = render(<Transcript {...transcriptProps(steps(2), {})} />)
      expect(screen.getByRole('button', { name: 'Odczytano 2 pliki' })).toBeInTheDocument()
      two.unmount()
      renderTranscript(steps(5))
      expect(screen.getByRole('button', { name: 'Odczytano 5 plików' })).toBeInTheDocument()
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
    const props = renderSteps(
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

const STORED_EDIT = tool({
  id: 'ed',
  tool: 'edit_file',
  args: '{}',
  patchRef: { id: 'p', byteLen: 1 },
})

/** A finished edit row with a stored patch, open as edit rows start: it has asked for page one. */
function mountEditRow() {
  const view = mountTranscript([STORED_EDIT])
  expect(view.props.onReadOutput).toHaveBeenCalledTimes(1)
  return view
}

/** That row's whole patch, as the host's one page of it. */
const WHOLE_PATCH = { 'ed:p': { content: '{"files":[]}', isEof: true, nextOffset: 12 } }

/** The chevron of the nth tool row's header, if it has one. */
function chevronOf(index: number): Element | null {
  return document.querySelectorAll('.tool-header')[index]?.querySelector('.chevron') ?? null
}

describe('Transcript rows (M15, M16)', () => {
  it('marks rows that open with a chevron that turns, and disables rows with nothing to show', () => {
    renderSteps([
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
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.rowMoreActions }))
    const copy = screen.getByRole('menuitem', { name: 'Copy response' })
    expect(copy).toHaveAttribute('title', 'Copy response')
    fireEvent.click(copy)
    expect(props.onCopy).toHaveBeenCalledWith('first **bold**')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.rowMoreActions }))
    expect(screen.getByRole('menuitem', { name: 'Copy response' })).toHaveAttribute(
      'title',
      'Copied',
    )
  })

  it('opens a shell or read output in an editor on click or Enter, with the stored ref when there is one', () => {
    const props = renderSteps([
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
    const props = renderSteps([
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

  it('offers the editor for a rename stopped partway, and for no other failed edit (M67)', () => {
    const diff = '--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-old\n+new'
    const props = renderSteps([
      tool({
        id: 'r1',
        tool: 'rename_symbol',
        args: '{"path":"x.ts"}',
        output: diff,
        status: 'failed',
        patchRef: { id: 'p1', byteLen: 10 },
      }),
      tool({
        id: 'e1',
        tool: 'edit_file',
        args: '{"path":"y.ts"}',
        output: diff,
        status: 'failed',
        patchRef: { id: 'p2', byteLen: 10 },
      }),
    ])
    const offered = screen.getAllByText('Click to expand')
    expect(offered).toHaveLength(1)
    fireEvent.click(offered[0]!)
    expect(props.onOpenEditDiff).toHaveBeenCalledWith('r1', 'p1')
  })
})

describe('Transcript chat references (M17)', () => {
  it("offers Reply to this output in a reply's actions menu", () => {
    const onReply = vi.fn()
    renderTranscript([{ kind: 'assistant', id: 'a1', text: 'done', isStreaming: false }], {
      onReply,
    })
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.rowMoreActions }).at(-1)!)
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

  it('reads an edit’s patch once the edit has finished, not while it runs (D26)', () => {
    const running = tool({
      id: 'ed',
      tool: 'edit_file',
      args: '{"path":"notes.md"}',
      status: 'inProgress',
      patchRef: { id: 'p', byteLen: 300 },
    })
    const view = mountTranscript([running])
    // 1.4.2 names the patch mid-edit; a read then can find nothing.
    expect(view.props.onReadOutput).not.toHaveBeenCalled()
    view.rerender({ entries: [{ ...running, status: 'completed' }] })
    expect(view.props.onReadOutput).toHaveBeenCalledWith('ed', 'p', 0)
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(1)
  })

  it('asks again for a page that never came when its row is collapsed and expanded (D26)', () => {
    const view = mountEditRow()
    // A re-render alone asks nothing more of a busy host.
    view.rerender({ isRunning: true })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(1)
    fireEvent.click(toggle(0))
    fireEvent.click(toggle(0))
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
    expect(view.props.onReadOutput).toHaveBeenLastCalledWith('ed', 'p', 0)
    // A page that came is not asked for again.
    view.rerender({ outputPages: WHOLE_PATCH })
    fireEvent.click(toggle(0))
    fireEvent.click(toggle(0))
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
  })

  it('defers a finished edit row’s automatic read while the turn runs (READS)', () => {
    const edit = tool({
      id: 'ed',
      tool: 'edit_file',
      args: '{"path":"notes.md"}',
      output: '@@\n-old\n+new',
      patchRef: { id: 'p', byteLen: 1 },
    })
    const view = mountTranscript([{ ...edit, status: 'inProgress' }], { isRunning: true })
    view.rerender({ entries: [edit], isRunning: true })
    expect(view.props.onReadOutput).not.toHaveBeenCalled()
    expect(screen.getByText('new')).toBeInTheDocument()
    expect(document.querySelector('.diff-gutter')?.textContent).toBe('')
    fireEvent.click(toggle(0))
    expect(view.props.onReadOutput).not.toHaveBeenCalled()
    fireEvent.click(toggle(0))
    expect(view.props.onReadOutput).toHaveBeenCalledExactlyOnceWith('ed', 'p', 0)
    view.rerender({ entries: [edit], isRunning: true })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(1)
  })

  it('loads a finished write row once when the turn ends (READS)', () => {
    const edit = tool({
      id: 'ed',
      tool: 'write_file',
      args: '{"path":"notes.md","content":"written content"}',
      patchRef: { id: 'p', byteLen: 1 },
    })
    const view = mountTranscript([edit], { isRunning: true })
    expect(view.props.onReadOutput).not.toHaveBeenCalled()
    expect(screen.getByText('written content')).toBeInTheDocument()
    view.rerender({ isRunning: false })
    expect(view.props.onReadOutput).toHaveBeenCalledExactlyOnceWith('ed', 'p', 0)
    view.rerender({ isRunning: false })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(1)
  })

  it('keeps a loaded patch without another read when the turn ends (READS)', () => {
    const view = mountTranscript([STORED_EDIT], { isRunning: true, outputPages: WHOLE_PATCH })
    view.rerender({ isRunning: false, outputPages: WHOLE_PATCH })
    expect(view.props.onReadOutput).not.toHaveBeenCalled()
  })

  it('pages a patch opened by the user during a turn, then defers again in a new turn (READS)', () => {
    const view = mountTranscript([STORED_EDIT], { isRunning: true })
    fireEvent.click(toggle(0))
    fireEvent.click(toggle(0))
    view.rerender({ ...pages('{', false, 1), isRunning: true })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
    expect(view.props.onReadOutput).toHaveBeenLastCalledWith('ed', 'p', 1)
    view.rerender({ isRunning: false, outputPages: WHOLE_PATCH })
    // A new turn must not reuse an earlier turn's manual-open permission.
    view.rerender({ isRunning: true, outputPages: {} })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
  })

  it('retries a read that failed during the turn exactly once at turn end (READS)', () => {
    const view = mountTranscript([STORED_EDIT], { isRunning: true })
    fireEvent.click(toggle(0))
    fireEvent.click(toggle(0))
    expect(view.props.onReadOutput).toHaveBeenCalledExactlyOnceWith('ed', 'p', 0)
    // The host reports a failure as a notice, leaving no page in outputPages.
    const entries: TranscriptEntry[] = [
      STORED_EDIT,
      { kind: 'notice', id: 'n', level: 'warning', text: 'Could not load the output' },
    ]
    view.rerender({ entries, isRunning: true })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(1)
    view.rerender({ entries, isRunning: false })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
    expect(view.props.onReadOutput).toHaveBeenLastCalledWith('ed', 'p', 0)
    view.rerender({ entries, isRunning: false })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
  })

  it('keeps a collapsed row unread at turn end until it is reopened (READS)', () => {
    const view = mountTranscript([STORED_EDIT], { isRunning: true })
    fireEvent.click(toggle(0))
    view.rerender({ isRunning: false })
    expect(view.props.onReadOutput).not.toHaveBeenCalled()
    fireEvent.click(toggle(0))
    expect(view.props.onReadOutput).toHaveBeenCalledExactlyOnceWith('ed', 'p', 0)
  })

  it('reads a collapsed edit row’s patch only once it is expanded, after a resume too (D26)', () => {
    const view = mountEditRow()
    view.rerender({ outputPages: WHOLE_PATCH })
    fireEvent.click(toggle(0))
    // A resume drops the fetched pages: the collapsed row asks nothing of the host.
    view.rerender({ outputPages: {} })
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(1)
    fireEvent.click(toggle(0))
    expect(view.props.onReadOutput).toHaveBeenCalledTimes(2)
    expect(view.props.onReadOutput).toHaveBeenLastCalledWith('ed', 'p', 0)
  })

  it('offers a fault notice’s way on as buttons (D26)', () => {
    const onNoticeAction = vi.fn()
    renderTranscript(
      [
        {
          kind: 'notice',
          id: 'n1',
          level: 'error',
          text: 'Muse Code refuses every message',
          actions: ['restartMuseCode', 'newConversation'],
        },
      ],
      { onNoticeAction },
    )
    const restart = screen.getByRole('button', { name: 'Restart now' })
    act(() => {
      // All arrive before React commits the disabled state.
      fireEvent.click(restart)
      fireEvent.click(restart)
      fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    })
    expect(onNoticeAction.mock.calls).toEqual([['n1', 'restartMuseCode']])
    expect(restart).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled()
    expect(screen.getByText('Muse Code refuses every message')).toBeInTheDocument()
  })

  it('shows how many times a notice was said after its text, read out in words (D26)', () => {
    renderTranscript(
      [
        { kind: 'notice', id: 'n1', level: 'warning', text: 'Could not switch model' },
        {
          kind: 'notice',
          id: 'n2',
          level: 'warning',
          text: 'Reasoning effort could not be applied',
          repeatCount: 7,
        },
        {
          kind: 'notice',
          id: 'n3',
          level: 'error',
          text: 'Muse Code refuses every message',
          actions: ['newConversation'],
          repeatCount: 2,
        },
      ],
      { onNoticeAction: vi.fn() },
    )
    const once = screen.getByText('Could not switch model')
    expect(once.querySelector('.notice-repeat')).toBeNull()
    expect(once).toHaveTextContent(/^Could not switch model$/)
    const repeated = screen.getByText('Reasoning effort could not be applied')
    const badge = repeated.querySelector('.notice-repeat')
    expect(badge).toHaveTextContent('7×')
    // The glyph is hidden from screen readers; the words stand in for it.
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    expect(badge).toHaveAttribute('title', 'Shown 7 times')
    expect(repeated.querySelector('.sr-only')).toHaveTextContent('Shown 7 times')
    const fault = screen.getByText('Muse Code refuses every message')
    expect(fault.querySelector('.notice-repeat')).toHaveTextContent('2×')
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled()
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

  it('keeps a compact record of a waiting approval; the card is in the dock (D26)', () => {
    renderTranscript([stagedRow(0)])
    expect(screen.getByText(UI_TEXT.approvalDockedNote)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Muse wants to / })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  })

  it('locks the transcript Answer marker while an answer or cancellation is submitted', async () => {
    const row = waitingQuestion()
    const mount = (isSubmitted: boolean) => (
      <QuestionSurface sessionId="s1" navigation={undefined} onDismiss={vi.fn()}>
        <Transcript
          {...transcriptProps([{ ...row, question: { ...row.question!, isSubmitted } }], {})}
        />
      </QuestionSurface>
    )
    const view = render(mount(false))
    await act(async () => {
      await import('../../src/webview/components/QuestionUi')
    })
    expect(screen.getByRole('button', { name: 'Answer Open question Colour' })).toBeEnabled()
    view.rerender(mount(true))
    expect(screen.getByRole('button', { name: 'Answer Open question Colour' })).toBeDisabled()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})

describe('Transcript replies (M25)', () => {
  it('shows a fence still streaming as plain text, and highlights it once closed', async () => {
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
    await screen.findByText('const', { selector: '.hljs-keyword' })
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
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.rowMoreActions })[0]!)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.rowMoreActions }).at(-1)!)
    const item = screen.getByRole('menuitem', { name: 'Reply to this output' })
    fireEvent.pointerDown(item)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.blur(item, {
      relatedTarget: screen.getAllByRole('button', { name: UI_TEXT.rowMoreActions })[0]!,
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers the rewind alone where the host cannot fork (D26)', () => {
    const onRewind = vi.fn()
    renderTranscript(
      [{ kind: 'user', seq: 1, id: 'u', text: 'hello', status: 'sent', attachments: [] }],
      { onRewind },
    )
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.rowMoreActions })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: UI_TEXT.rowRewindGroup }))
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Rewind code to here',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind code to here' }))
    expect(onRewind).toHaveBeenCalledWith('u')
  })
})

describe('Transcript: paid rows and cited sources (M33)', () => {
  it('marks a paid row, with its price in the tooltip, and shows the search query', async () => {
    renderSteps([
      tool({
        id: 'ws',
        tool: 'web_search',
        args: JSON.stringify({ query: 'vite 7 release' }),
        output: 'Vite 7\nhttps://vite.dev/blog',
        paid: 'webSearch',
      }),
      tool({ id: 'free' }),
    ])
    expect(screen.getByText('Web search')).toBeInTheDocument()
    expect(screen.getByText('vite 7 release')).toBeInTheDocument()
    const badges = screen.getAllByText('paid')
    expect(badges).toHaveLength(1)
    // The badge paints at once; its exact price tooltip arrives with the
    // lazy money chunk (STARTUP017), never guessed.
    expect(badges[0]).not.toHaveAttribute('title')
    const titled = await screen.findByTitle(
      'Billed to your Model API key: $2.50 per 1,000 searches',
    )
    expect(titled).toBe(badges[0])
  })

  it('lists a finished reply’s sources, each opening like the reply’s own links', () => {
    const props = renderTranscript([
      {
        kind: 'assistant',
        id: 'a',
        text: 'Vite 7 shipped.',
        isStreaming: false,
        citations: [
          { url: 'https://vite.dev/blog', title: 'Vite 7 is out' },
          { url: 'https://example.com/untitled' },
        ],
      },
    ])
    const sources = screen.getByRole('navigation', { name: 'Sources' })
    expect(sources).toHaveTextContent('Vite 7 is out')
    // A source without a title is named by its host.
    expect(sources).toHaveTextContent('example.com')
    fireEvent.click(screen.getByText('Vite 7 is out'))
    expect(props.onOpenLink).toHaveBeenCalledWith('https://vite.dev/blog')
  })

  it('shows no sources while the reply streams, or when it cites none', () => {
    renderTranscript([
      {
        kind: 'assistant',
        id: 'a',
        text: 'Still',
        isStreaming: true,
        citations: [{ url: 'https://vite.dev/blog', title: 'Vite' }],
      },
      { kind: 'assistant', id: 'b', text: 'Plain', isStreaming: false, citations: [] },
    ])
    expect(screen.queryByRole('navigation', { name: 'Sources' })).toBeNull()
  })
})

/** A user card as the reducer leaves it once accepted. */
function userCard(overrides: Partial<Extract<TranscriptEntry, { kind: 'user' }>> = {}) {
  return {
    kind: 'user' as const,
    id: 'l2',
    seq: 1,
    text: 'queued text',
    status: 'queued' as const,
    disposition: 'queued',
    turnId: 't2',
    attachments: [],
    ...overrides,
  }
}

describe('Transcript: the step summary in the default view (M87, PLAN.md D66)', () => {
  const run: TranscriptEntry[] = [
    { kind: 'user', id: 'u', seq: 0, text: 'go', status: 'sent', attachments: [] },
    tool({ id: 'e1', tool: 'edit_file', args: '{"path":"a.ts"}' }),
    tool({ id: 's1', tool: 'powershell', args: '{"command":"ls"}' }),
    { kind: 'reasoning', id: 'r', parts: ['x'], isStreaming: false, startedAt: 0, durationMs: 1 },
    tool({ id: 'e2', tool: 'write_file', args: '{"path":"b.ts","content":"x"}' }),
    tool({ id: 'e3', tool: 'edit_file', args: '{"path":"a.ts"}' }),
    tool({ id: 'r1', args: '{"path":"x.ts"}' }),
    tool({ id: 'r2', args: '{"path":"y.ts"}' }),
    tool({ id: 'r3', args: '{"path":"z.ts"}' }),
    { kind: 'assistant', id: 'a', text: 'done', isStreaming: false },
  ]

  it('folds two or more finished steps under what they did, in first-seen order', () => {
    expect(segment(run, false).map((part) => part.kind)).toEqual(['entry', 'steps', 'entry'])
    renderTranscript(run)
    const summary = screen.getByRole('button', {
      name: 'Edited 2 files, ran a command, and read 3 files',
    })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Read')).toBeNull()
    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    const list = document.querySelector(
      `#${CSS.escape(summary.getAttribute('aria-controls') ?? '')}`,
    )
    expect(list?.querySelectorAll(':scope > li')).toHaveLength(8)
  })

  it('leaves one finished step alone, and a run broken by a message as two', () => {
    const lone: TranscriptEntry[] = [
      tool({ id: 'r1' }),
      { kind: 'assistant', id: 'a', text: 'between', isStreaming: false },
      tool({ id: 'r2' }),
    ]
    expect(segment(lone, false).every((part) => part.kind === 'entry')).toBe(true)
    renderTranscript(lone)
    expect(screen.getAllByText('Read')).toHaveLength(2)
  })

  it('never folds a step waiting on the user, and keeps a running one below the group', () => {
    const entries: TranscriptEntry[] = [
      tool({ id: 'r1' }),
      tool({
        id: 'live',
        tool: 'powershell',
        args: '{"command":"npm test"}',
        status: 'inProgress',
      }),
      tool({ id: 'r2', args: '{"path":"b.ts"}' }),
      // Waiting, whatever status the wire gives the row (D36): never folded.
      { ...waitingQuestion(), status: 'awaitingInput' },
    ]
    const parts = segment(entries, false)
    expect(parts.map((part) => (part.kind === 'steps' ? 'steps' : part.entry.id))).toEqual([
      'steps',
      'live',
      'w',
    ])
    renderTranscript(entries)
    expect(screen.getByRole('button', { name: 'Read 2 files' })).toBeInTheDocument()
    const marker = screen.getByRole('button', { name: 'Answer Open question Colour' })
    expect(marker.closest('.steps')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(document.querySelector('.tool-dot-running')).not.toBeNull()
    // Two finished steps and nothing else: a run of thoughts alone reads as a thought.
    const thoughts: TranscriptEntry[] = [
      { kind: 'reasoning', id: 'x', parts: [], isStreaming: false, startedAt: 0, durationMs: 1 },
      { kind: 'reasoning', id: 'y', parts: [], isStreaming: false, startedAt: 0, durationMs: 1 },
    ]
    renderTranscript(thoughts)
    expect(screen.getByRole('button', { name: UI_TEXT.thoughtDone })).toBeInTheDocument()
  })

  it('names a failure in the summary and carries the failure dot, never hiding it', () => {
    renderTranscript([
      tool({ id: 's1', tool: 'powershell', args: '{"command":"a"}', status: 'failed' }),
      tool({ id: 's2', tool: 'powershell', args: '{"command":"b"}' }),
      tool({ id: 's3', tool: 'powershell', args: '{"command":"c"}', status: 'interrupted' }),
    ])
    const summary = screen.getByRole('button', { name: 'Ran 3 commands and 1 failed' })
    expect(summary.querySelector('.tool-dot-failed')).not.toBeNull()
    renderTranscript([tool({ id: 'r1' }), tool({ id: 'r2', args: '{"path":"b.ts"}' })])
    expect(
      screen.getByRole('button', { name: 'Read 2 files' }).querySelector('.tool-dot-failed'),
    ).toBeNull()
  })
})

/** A time as the card formats it in English, the zone the test set. */
function timeOf(atMs: number): string {
  return new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(atMs)
}

function dateTimeOf(atMs: number): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(atMs)
}

function fullOf(atMs: number): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' }).format(atMs)
}

describe('Transcript: message times (M87, PLAN.md D66)', () => {
  const zone = process.env['TZ']
  // Local noon on 4 October 2026 in New York (16:00 UTC).
  const NOW = Date.UTC(2026, 9, 4, 16, 0)
  const TODAY = Date.UTC(2026, 9, 4, 14, 5)
  // 23:59 on the 3rd in New York: 03:59 UTC on the 4th, so a UTC check would call it today.
  const LATE_YESTERDAY = Date.UTC(2026, 9, 4, 3, 59)

  beforeAll(() => {
    process.env['TZ'] = 'America/New_York'
    setUiText(EN, 'en')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterAll(() => {
    vi.useRealTimers()
    if (zone === undefined) {
      delete process.env['TZ']
    } else {
      process.env['TZ'] = zone
    }
    setUiText(EN, 'en')
  })

  it('shows today’s time alone and an older one with its date, the full date in the title', () => {
    renderTranscript([
      { kind: 'user', id: 'u1', seq: 0, text: 'now', status: 'sent', attachments: [], atMs: TODAY },
      {
        kind: 'user',
        id: 'u2',
        seq: 1,
        text: 'late',
        status: 'sent',
        attachments: [],
        atMs: LATE_YESTERDAY,
      },
      { kind: 'assistant', id: 'a', text: 'reply', isStreaming: false, atMs: TODAY },
    ])
    const [today, yesterday, reply] = document.querySelectorAll('time')
    expect(today).toHaveTextContent(timeOf(TODAY))
    expect(today).toHaveAttribute('dateTime', new Date(TODAY).toISOString())
    expect(today).toHaveAttribute('title', `Sent ${fullOf(TODAY)}`)
    expect(yesterday).toHaveTextContent(dateTimeOf(LATE_YESTERDAY))
    expect(yesterday).toHaveAttribute('title', `Sent ${fullOf(LATE_YESTERDAY)}`)
    expect(fullOf(LATE_YESTERDAY)).toContain('October 3')
    expect(reply).toHaveAttribute('title', `Received ${fullOf(TODAY)}`)
  })

  it('makes the time a keyboard stop only on a card with no button of its own', () => {
    renderTranscript(
      [
        // Imported or not yet in a session: no rewind, so the time is the stop.
        {
          kind: 'user',
          id: 'u1',
          seq: 0,
          text: 'mine',
          status: 'sent',
          attachments: [],
          atMs: TODAY,
        },
        { kind: 'assistant', id: 'a1', text: 'streaming', isStreaming: true, atMs: TODAY },
        { kind: 'assistant', id: 'a2', text: 'done', isStreaming: false, atMs: TODAY },
      ],
      {},
    )
    const [user, streaming, done] = document.querySelectorAll('time')
    expect(user).toHaveAttribute('tabindex', '0')
    expect(streaming).toHaveAttribute('tabindex', '0')
    expect(done).not.toHaveAttribute('tabindex')
  })

  it('gives a card with its rewind menu or its queued menu no extra stop', () => {
    renderTranscript(
      [
        { kind: 'user', id: 'u1', seq: 0, text: 'a', status: 'sent', attachments: [], atMs: TODAY },
        userCard({ atMs: TODAY }),
      ],
      { onRewind: vi.fn(), onEditQueued: vi.fn() },
    )
    for (const time of document.querySelectorAll('time')) {
      expect(time).not.toHaveAttribute('tabindex')
    }
  })

  // RV87C finding 3, closed by lane F2's one "…" per row: an ordinary sent
  // card and a finished reply reveal their time through a real Tab stop of
  // their own (the "…"); a card without one has the time itself.
  it('reveals every card’s time from a Tab stop inside the card', () => {
    renderTranscript(
      [
        {
          kind: 'user',
          id: 'u1',
          seq: 0,
          turnId: 't1',
          text: 'sent',
          status: 'sent',
          attachments: [],
          atMs: TODAY,
        },
        { kind: 'assistant', id: 'a1', text: 'done', isStreaming: false, atMs: TODAY },
        { kind: 'assistant', id: 'a2', text: 'streaming', isStreaming: true, atMs: TODAY },
      ],
      { onRewind: vi.fn() },
    )
    const times = [...document.querySelectorAll('time')]
    expect(times).toHaveLength(3)
    for (const time of times) {
      const card = time.closest('li')
      if (card === null) {
        throw new Error('A time outside a card')
      }
      const stops = [
        ...card.querySelectorAll<HTMLElement>('button, [tabindex]:not(button)'),
      ].filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.hasAttribute('disabled') &&
          !element.hasAttribute('hidden') &&
          element.closest('[inert], [aria-hidden="true"]') === null,
      )
      expect(stops.length).toBeGreaterThan(0)
      stops[0]?.focus()
      expect(card.matches(':focus-within')).toBe(true)
    }
    // What the focus inside a card turns on.
    // jsdom's import.meta.url is not a file URL; vitest runs from the repository root.
    const css = readFileSync(path.join(process.cwd(), 'src/webview/styles.css'), 'utf8')
    expect(css).toContain('.message-assistant:focus-within > .message-time')
    expect(css).toContain('.message-user:focus-within > .message-time')
  })

  it('shows no time where none was recorded', () => {
    renderTranscript([
      { kind: 'user', id: 'u1', seq: 0, text: 'old', status: 'sent', attachments: [] },
      { kind: 'assistant', id: 'a', text: 'old', isStreaming: false },
    ])
    expect(document.querySelectorAll('time')).toHaveLength(0)
  })
})

/** A queued card's "…" button. */
function menuButton(): HTMLElement {
  return screen.getByRole('button', { name: UI_TEXT.rowMoreActions })
}

describe('Transcript: Edit on a queued message (M87, PLAN.md D66)', () => {
  it('marks a queued card and offers Edit from its "…", passing the ids the host gave it', () => {
    const onEditQueued = vi.fn()
    renderTranscript([userCard({ replayItemId: 'u2' })], { onEditQueued })
    expect(screen.getByText(UI_TEXT.queuedLabel)).toBeInTheDocument()
    fireEvent.click(menuButton())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
    const edit = screen.getByRole('menuitem', { name: UI_TEXT.queuedEdit })
    expect(edit).toHaveAttribute('title', UI_TEXT.queuedEditTitle)
    expect(edit).toHaveFocus()
    fireEvent.click(edit)
    expect(onEditQueued).toHaveBeenCalledWith({ localId: 'l2', turnId: 't2', userMessageId: 'u2' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu on a right-click, Shift+F10 or the context-menu key', () => {
    renderTranscript([userCard()], { onEditQueued: vi.fn() })
    const card = screen.getByText('queued text')
    const isDefaultKept = fireEvent.contextMenu(card)
    // The panel's own menu, not the webview's.
    expect(isDefaultKept).toBe(false)
    expect(screen.getByRole('menu', { name: UI_TEXT.queuedMenuLabel })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(menuButton()).toHaveFocus()
    fireEvent.keyDown(menuButton(), { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' })
    fireEvent.keyDown(menuButton(), { key: 'ContextMenu' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('leaves a right-click on selected text to the quote menu', () => {
    renderTranscript([userCard()], { onEditQueued: vi.fn() })
    const text = screen.getByText('queued text')
    const clearSelection = selectPassage(text)
    try {
      expect(fireEvent.contextMenu(text)).toBe(true)
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      clearSelection()
    }
  })

  it('says a Muse Code steer was delivered instead of offering Edit, and lets a Model API one be edited', () => {
    const steered = userCard({ disposition: 'steered', turnId: 't1' })
    const view = mountTranscript([steered], { onEditQueued: vi.fn() })
    expect(screen.queryByText(UI_TEXT.queuedLabel)).toBeNull()
    fireEvent.click(menuButton())
    expect(screen.getByRole('menuitem', { name: UI_TEXT.queuedDelivered })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByRole('menuitem', { name: UI_TEXT.queuedEdit })).toBeNull()
    view.rerender({ canEditSteered: true })
    expect(screen.getByText(UI_TEXT.queuedLabel)).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: UI_TEXT.queuedEdit })).toBeInTheDocument()
  })

  it('offers no menu where nothing can take a message back, nor on a sent card', () => {
    renderTranscript([userCard()])
    expect(screen.queryByRole('button', { name: UI_TEXT.rowMoreActions })).toBeNull()
    expect(fireEvent.contextMenu(screen.getByText('queued text'))).toBe(true)
    renderTranscript([userCard({ id: 's', status: 'sent', text: 'sent text' })], {
      onEditQueued: vi.fn(),
    })
    expect(screen.queryByRole('button', { name: UI_TEXT.rowMoreActions })).toBeNull()
  })
})
