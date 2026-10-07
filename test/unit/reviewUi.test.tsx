// @vitest-environment jsdom
// M70 (PLAN.md D49): the review in the panel. `/review` and the palette's
// rows become a card and a request; the reply's findings block becomes a
// list whose locations open their file and line; the review pane lists the
// conversation's changes, accepts or reverts each, and sends a comment on a
// line to the agent.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { MarkdownView } from '../../src/webview/components/MarkdownView'
import { initialUiState, reviewHunkKey, uiReducer } from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

function deliver(data: HostToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function renderReady() {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  let ids = 0
  render(
    <App
      postMessage={postMessage}
      newLocalId={() => {
        ids += 1
        return `local-${String(ids)}`
      }}
    />,
  )
  deliver({
    type: 'init',
    emptyStateHint: 'hint',
    composerPlaceholder: 'placeholder',
    settings: testSettings,
  })
  deliver({ type: 'authState', status: 'signedIn' })
  return postMessage
}

function textarea() {
  return screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
}

function submit(text: string) {
  fireEvent.change(textarea(), { target: { value: text } })
  fireEvent.keyDown(textarea(), { key: 'Enter' })
}

const posted = (postMessage: ReturnType<typeof renderReady>, type: WebviewToHostMessage['type']) =>
  postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === type)

/** A completed edit row with its patch, as the host relays it. */
function deliverEdit(itemId: string, turnId: string) {
  deliver({
    type: 'agentEvent',
    event: {
      type: 'itemCompleted',
      item: {
        itemId,
        kind: 'toolCall',
        status: 'completed',
        turnId,
        tool: 'edit_file',
        args: '{"path":"src/a.ts"}',
        patchRef: { id: `tool_patch-${itemId}`, byteLen: 10 },
      },
    },
  })
}

describe('/review in the composer (M70)', () => {
  it('posts the request with a card of what was typed, and clears the prompt', () => {
    const postMessage = renderReady()
    submit('/review security branch main')
    expect(posted(postMessage, 'startReview')).toEqual([
      {
        type: 'startReview',
        localId: 'local-1',
        text: '/review security branch main',
        request: { scope: 'branch', focus: 'security', base: 'main' },
      },
    ])
    expect(posted(postMessage, 'sendMessage')).toEqual([])
    expect(textarea().value).toBe('')
    expect(screen.getByText('/review security branch main')).toBeDefined()
    // The host's refusal marks the card, as for a message.
    deliver({ type: 'sendFailed', localId: 'local-1', reason: UI_TEXT.reviewRestricted })
    expect(document.querySelector('.message-error')?.textContent).toContain(
      UI_TEXT.reviewRestricted,
    )
  })

  it('keeps over-long instructions in the prompt and says why', () => {
    const postMessage = renderReady()
    submit(`/review ${'x'.repeat(9000)}`)
    expect(posted(postMessage, 'startReview')).toEqual([])
    expect(textarea().value.startsWith('/review ')).toBe(true)
    expect(document.querySelector('.notice-warning')?.textContent).toBe(
      UI_TEXT.reviewInstructionsTooLong,
    )
  })

  it('runs a palette preset with the command as its card', async () => {
    const postMessage = renderReady()
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    fireEvent.click(await screen.findByRole('option', { name: /Security review/ }))
    expect(posted(postMessage, 'startReview')).toEqual([
      {
        type: 'startReview',
        localId: 'local-1',
        text: '/review security',
        request: { scope: 'uncommitted', focus: 'security' },
      },
    ])
  })
})

async function openPane() {
  const postMessage = renderReady()
  deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
  submit('change it')
  deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1' })
  deliverEdit('ed1', 't1')
  deliverEdit('ed2', 't1')
  fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
  fireEvent.click(screen.getByRole('option', { name: /Review this conversation’s changes/ }))
  const [request] = posted(postMessage, 'readReviewChanges')
  if (request?.type !== 'readReviewChanges') {
    throw new Error('expected the pane to ask for the changes')
  }
  await screen.findByRole('dialog', { name: UI_TEXT.reviewPaneTitle })
  return { postMessage, request }
}

function deliverChanges(requestId: string) {
  deliver({
    type: 'reviewChanges',
    requestId,
    omittedEdits: 1,
    files: [
      {
        itemId: 'ed1',
        outputRef: 'tool_patch-ed1',
        fileIndex: 0,
        path: 'src/a.ts',
        hunks: [
          { oldStart: 3, newStart: 3, lines: [' keep', '-const x = 1', '+const x = 2'] },
          { oldStart: 20, newStart: 20, lines: ['+added()'] },
        ],
      },
      {
        itemId: 'ed2',
        outputRef: 'tool_patch-ed2',
        fileIndex: 0,
        path: '../outside.ts',
        refusal: '../outside.ts refused: the edited path is outside the workspace.',
        hunks: [{ oldStart: 1, newStart: 1, lines: ['+x'] }],
      },
    ],
  })
}

describe('the review pane (M70)', () => {
  it('asks for the conversation’s edits in the order they landed, and reads while they come', async () => {
    const { request } = await openPane()
    expect(request.edits).toEqual([
      { itemId: 'ed1', outputRef: 'tool_patch-ed1' },
      { itemId: 'ed2', outputRef: 'tool_patch-ed2' },
    ])
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.reviewPaneTitle })
    expect(within(dialog).getByRole('status').textContent).toBe(UI_TEXT.reviewPaneLoading)
  })

  it('lists files and changes; Accept marks one, Revert asks the host and shows its word', async () => {
    const { postMessage, request } = await openPane()
    deliverChanges(request.requestId)
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.reviewPaneTitle })
    expect(within(dialog).getByText('2 files · 3 changes · 0 accepted · 0 reverted')).toBeDefined()
    expect(within(dialog).getByText('Change 1, lines 3–4')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept: change 1 of src/a.ts' }))
    expect(
      within(dialog)
        .getByRole('button', { name: 'Accept: change 1 of src/a.ts' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revert: change 2 of src/a.ts' }))
    expect(posted(postMessage, 'revertReviewHunk')).toEqual([
      {
        type: 'revertReviewHunk',
        itemId: 'ed1',
        outputRef: 'tool_patch-ed1',
        fileIndex: 0,
        hunkIndex: 1,
      },
    ])
    const revert = within(dialog).getByRole<HTMLButtonElement>('button', {
      name: 'Revert: change 2 of src/a.ts',
    })
    expect(revert.disabled).toBe(true)
    deliver({
      type: 'reviewHunkResult',
      itemId: 'ed1',
      fileIndex: 0,
      hunkIndex: 1,
      isReverted: true,
    })
    expect(within(dialog).getByText('2 files · 3 changes · 1 accepted · 1 reverted')).toBeDefined()
    // A change outside the workspace cannot be reverted here, and says why.
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', {
        name: 'Revert: change 1 of ../outside.ts',
      }).disabled,
    ).toBe(true)
    expect(within(dialog).getByText(/1 edit is not listed here/)).toBeDefined()
  })

  it('sends a comment on a line with the lines around it, as the next message', async () => {
    const { postMessage, request } = await openPane()
    deliverChanges(request.requestId)
    deliver({
      type: 'agentEvent',
      event: { type: 'turnCompleted', turnId: 't1', terminal: 'completed' },
    })
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.reviewPaneTitle })
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: `${UI_TEXT.reviewComment}: change 1 of src/a.ts`,
      }),
    )
    fireEvent.change(await within(dialog).findByLabelText(UI_TEXT.reviewCommentLabel), {
      target: { value: 'Keep this at 1' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.reviewSendNext }))
    const [message] = posted(postMessage, 'sendMessage').slice(-1)
    expect(message).toEqual({
      type: 'sendMessage',
      localId: expect.any(String),
      text: 'Keep this at 1',
      attachmentIds: [],
      reference: {
        intent: 'comment',
        role: 'diff',
        // The first line the change added: line 4 of the file as it is now.
        text: 'src/a.ts:4\n keep\n-const x = 1\n+const x = 2',
      },
    })
    expect(within(dialog).queryByLabelText(UI_TEXT.reviewCommentLabel)).toBeNull()
  })

  it('shows omitted edits without falsely claiming that no files changed', async () => {
    const { request } = await openPane()
    deliver({ type: 'reviewChanges', requestId: request.requestId, files: [], omittedEdits: 2 })
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.reviewPaneTitle })
    expect(within(dialog).queryByText(UI_TEXT.reviewPaneEmpty)).toBeNull()
    expect(within(dialog).getByText(/2 edits are not listed here/)).toBeDefined()
  })

  it('offers the comment as a steer while a turn runs, and names a removed line by the line it was', async () => {
    const { postMessage, request } = await openPane()
    deliverChanges(request.requestId)
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.reviewPaneTitle })
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: `${UI_TEXT.reviewComment}: change 1 of src/a.ts`,
      }),
    )
    const line = await within(dialog).findByLabelText<HTMLSelectElement>(UI_TEXT.reviewCommentLine)
    fireEvent.change(line, {
      target: {
        value: [...line.options].find((option) => option.text === 'Removed line 4: const x = 1')
          ?.value,
      },
    })
    fireEvent.change(within(dialog).getByLabelText(UI_TEXT.reviewCommentLabel), {
      target: { value: 'Why was this dropped?' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.reviewSendSteer }))
    expect(posted(postMessage, 'sendMessage').at(-1)).toMatchObject({
      text: 'Why was this dropped?',
      reference: {
        text: 'src/a.ts (a line this change removed; it was line 4)\n keep\n-const x = 1\n+const x = 2',
      },
    })
  })

  it('drops an answer to an older request, and closes with the conversation', async () => {
    const { request } = await openPane()
    deliverChanges('older')
    expect(screen.getByText(UI_TEXT.reviewPaneLoading)).toBeDefined()
    deliverChanges(request.requestId)
    deliver({ type: 'conversationCleared' })
    expect(screen.queryByRole('dialog', { name: UI_TEXT.reviewPaneTitle })).toBeNull()
  })
})

function renderFindings(json: string) {
  const onOpenFile = vi.fn()
  render(
    <MarkdownView
      text={`Summary.\n\n\`\`\`muse-review\n${json}\n\`\`\``}
      onOpenLink={vi.fn()}
      onOpenFile={onOpenFile}
      onCopy={vi.fn()}
      onInsert={vi.fn()}
      onApply={vi.fn()}
    />,
  )
  return onOpenFile
}

describe('a review’s findings (M70)', () => {
  it('lists each finding with its severity; its location opens the file at its lines', () => {
    const onOpenFile = renderFindings(
      JSON.stringify({
        findings: [
          {
            file: 'src/a.ts',
            line: 12,
            endLine: 14,
            severity: 'HIGH',
            title: 'Null deref',
            detail: 'Guard it.',
          },
          { file: 'b.ts', severity: 'nitpick', title: 'Naming' },
          { file: '../etc/passwd', line: 1, title: 'Outside' },
        ],
      }),
    )
    const list = screen.getByRole('region', { name: UI_TEXT.reviewFindingsLabel })
    expect(within(list).getByText('3 findings')).toBeDefined()
    expect(within(list).getByText('High')).toBeDefined()
    expect(within(list).getByText('nitpick')).toBeDefined()
    fireEvent.click(within(list).getByRole('button', { name: 'Open src/a.ts:12-14' }))
    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts', { startLine: 12, endLine: 14 })
    fireEvent.click(within(list).getByRole('button', { name: 'Open b.ts' }))
    expect(onOpenFile).toHaveBeenLastCalledWith('b.ts', undefined)
    // A location that climbs out of the workspace is text, never a link.
    expect(within(list).queryByRole('button', { name: /passwd/ })).toBeNull()
    expect(within(list).getByText('../etc/passwd:1')).toBeDefined()
  })

  it('says when there is nothing, and leaves a block that does not parse a code block', () => {
    renderFindings('{"findings":[]}')
    expect(screen.getByText(UI_TEXT.reviewNoFindings)).toBeDefined()
    renderFindings('{"findings":[{"file":"a"}')
    expect(screen.getAllByRole('region', { name: UI_TEXT.reviewFindingsLabel })).toHaveLength(1)
  })
})

describe('the review pane’s state (M70)', () => {
  const at = 0

  it('says a refused revert out loud with the reason, and lets it be tried again', () => {
    const key = reviewHunkKey('ed1', 0, 0)
    const requested = uiReducer(initialUiState, { type: 'reviewPaneRequested', requestId: 'q1' })
    const reverting = uiReducer(requested, { type: 'reviewHunkReverting', key })
    const failed = uiReducer(reverting, {
      type: 'hostMessage',
      at,
      message: {
        type: 'reviewHunkResult',
        itemId: 'ed1',
        fileIndex: 0,
        hunkIndex: 0,
        isReverted: false,
        reason: 'the file changed',
      },
    })
    expect(failed.reviewHunks[key]).toEqual({ kind: 'failed', reason: 'the file changed' })
    expect(failed.announcement?.text).toBe('change 1 of  not reverted: the file changed')
    // Accept after a failed revert is allowed; a reverted change is past accepting.
    expect(
      uiReducer(failed, { type: 'reviewHunkAccepted', key, isAccepted: true }).reviewHunks[key],
    ).toEqual({
      kind: 'accepted',
    })
    expect(
      uiReducer(reverting, { type: 'reviewHunkAccepted', key, isAccepted: true }).reviewHunks[key],
    ).toEqual({ kind: 'reverting' })
  })

  it('adds a card that is not the composer’s without touching the draft', () => {
    const drafted = uiReducer(initialUiState, { type: 'draftChanged', draft: 'keep me' })
    const next = uiReducer(drafted, {
      type: 'cardSubmitted',
      localId: 'c1',
      text: 'comment',
      reference: { intent: 'comment', role: 'diff', text: 'a.ts:1\n+x' },
      announcement: UI_TEXT.reviewCommentSent,
    })
    expect(next.draft).toBe('keep me')
    expect(next.transcript.at(-1)).toMatchObject({ kind: 'user', id: 'c1', status: 'pending' })
    expect(next.announcement?.text).toBe(UI_TEXT.reviewCommentSent)
  })
})
