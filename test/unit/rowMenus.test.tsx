// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { renderTranscript, selectPassage, tool } from './helpers/transcriptFixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Every shown pill shows its own label, the icon before it. */
function expectLabelledPills() {
  const pills = screen.getAllByRole('menuitem')
  for (const pill of pills) {
    const name = pill.getAttribute('aria-label') ?? ''
    expect(pill.lastElementChild).toHaveTextContent(name)
    expect(pill.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(within(pill).getByText(name)).toBeVisible()
  }
  return pills
}

const px = (value: string) => Number(value.replace('px', ''))

/** The shown pills, as drawn (capped at their max width), inside 320 × 760 and apart. */
function expectPlacedInNarrowPanel(count: number) {
  const boxes = expectLabelledPills().map((pill) => ({
    left: px(pill.style.left),
    top: px(pill.style.top),
    width: Math.min(pill.offsetWidth, px(pill.style.maxWidth)),
  }))
  expect(boxes).toHaveLength(count)
  for (const [index, box] of boxes.entries()) {
    expect(box.left).toBeGreaterThanOrEqual(8)
    expect(box.left + box.width).toBeLessThanOrEqual(312)
    expect(box.top).toBeGreaterThanOrEqual(8)
    expect(box.top + 40).toBeLessThanOrEqual(752)
    const later = boxes.slice(index + 1)
    for (const other of later) {
      const isApart =
        box.left + box.width <= other.left ||
        other.left + other.width <= box.left ||
        box.top + 40 <= other.top ||
        other.top + 40 <= box.top
      expect(isApart).toBe(true)
    }
  }
}

const user = {
  kind: 'user',
  seq: 1,
  id: 'u',
  turnId: 't',
  text: 'hello',
  status: 'sent',
  attachments: [],
} as const

function opener() {
  return screen.getByRole('button', { name: UI_TEXT.rowMoreActions })
}

function choose(label: string) {
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}

describe('M87 F2 row menus', () => {
  it.each(['pointer', 'F10', 'ContextMenu', 'button'])(
    'opens from %s and returns focus to the sole opener',
    (method) => {
      renderTranscript([user], { onRewind: vi.fn() })
      const button = opener()
      expect(screen.getAllByRole('button')).toHaveLength(1)
      if (method === 'pointer') {
        expect(
          fireEvent.contextMenu(screen.getByText('hello'), { clientX: 100, clientY: 100 }),
        ).toBe(false)
      } else if (method === 'button') {
        fireEvent.click(button)
      } else {
        button.focus()
        expect(fireEvent.keyDown(button, { key: method, shiftKey: method === 'F10' })).toBe(false)
      }
      expect(screen.getByRole('menu')).toBeInTheDocument()
      choose(UI_TEXT.rowRewindGroup)
      expect(screen.getByRole('menu', { name: UI_TEXT.rowRewindGroup })).toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(screen.getByRole('menuitem', { name: UI_TEXT.rowRewindGroup })).toHaveFocus()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(button).toHaveFocus()
    },
  )

  it('routes all offered user actions and keeps checkpoint guards', () => {
    const callbacks = {
      onFork: vi.fn(),
      onForkRewind: vi.fn(),
      onRewind: vi.fn(),
      onRewindConversation: vi.fn(),
      onRestoreFiles: vi.fn(),
      onRestoreBoth: vi.fn(),
    }
    renderTranscript([user], { ...callbacks, checkpointTurnIds: new Set(['t']) })
    fireEvent.click(opener())
    expect(screen.queryByRole('menuitem', { name: UI_TEXT.forkAndRewind })).toBeNull()
    choose(UI_TEXT.forkFromHere)
    expect(callbacks.onFork).toHaveBeenCalledWith('u')
    for (const [label, callback] of [
      [UI_TEXT.rewindConversationToHere, callbacks.onRewindConversation],
      [UI_TEXT.restoreFilesToHere, callbacks.onRestoreFiles],
      [UI_TEXT.rewindCodeToHere, callbacks.onRewind],
      [UI_TEXT.rewindAndRestore, callbacks.onRestoreBoth],
    ] as const) {
      fireEvent.click(opener())
      choose(UI_TEXT.rowRewindGroup)
      choose(label)
      expect(callback).toHaveBeenCalledWith('u')
      expect(screen.queryByRole('menu')).toBeNull()
    }
  })

  it('routes fork and rewind on a card without a checkpoint', () => {
    const onForkRewind = vi.fn()
    renderTranscript([user], { onRewind: vi.fn(), onForkRewind })
    fireEvent.click(opener())
    choose(UI_TEXT.forkAndRewind)
    expect(onForkRewind).toHaveBeenCalledWith('u')
  })

  it('keeps copy and reply handlers on a finished reply', () => {
    const props = renderTranscript(
      [{ kind: 'assistant', id: 'a', text: '**done**', isStreaming: false }],
      { onReply: vi.fn() },
    )
    fireEvent.click(opener())
    choose(UI_TEXT.copyResponse)
    expect(props.onCopy).toHaveBeenCalledWith('**done**')
    fireEvent.click(opener())
    choose(UI_TEXT.replyToOutput)
    expect(props.onReply).toHaveBeenCalledWith('a')
  })

  it('keeps Redo pending and spent guards', () => {
    const onRedo = vi.fn()
    renderTranscript(
      [
        {
          kind: 'notice',
          id: 'n',
          level: 'info',
          text: 'restored',
          redoRestoreId: 'r',
          isRedoPending: true,
        },
      ],
      { onRedo },
    )
    fireEvent.click(opener())
    const redo = screen.getByRole('menuitem', { name: UI_TEXT.redoAction })
    expect(redo).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(redo)
    expect(onRedo).not.toHaveBeenCalled()
  })

  it('routes Redo with the restore id', () => {
    const onRedo = vi.fn()
    renderTranscript(
      [{ kind: 'notice', id: 'n', level: 'info', text: 'restored', redoRestoreId: 'r' }],
      { onRedo },
    )
    fireEvent.click(opener())
    choose(UI_TEXT.redoAction)
    expect(onRedo).toHaveBeenCalledWith('n', 'r')
  })

  it('routes tool output and landed edit review without exposing unfinished edits', () => {
    const props = renderTranscript([
      tool({
        tool: 'edit_file',
        output: 'patch',
        patchRef: { id: 'p', byteLen: 1 },
        outputRef: { id: 'o', byteLen: 1 },
      }),
    ])
    fireEvent.click(opener())
    choose(UI_TEXT.rowOpenOutput)
    expect(props.onOpenOutput).toHaveBeenCalledWith('t', 'Edit', 'patch', 'o')
    fireEvent.click(opener())
    choose(UI_TEXT.diffTallyReview)
    expect(props.onOpenEditDiff).toHaveBeenCalledWith('t', 'p')
  })

  // D66 item 17: an edit row's menu holds Review and Revert (lane W).
  it('routes a landed edit’s Revert with its stored patch', () => {
    const onRevertEdit = vi.fn()
    renderTranscript(
      [
        tool({
          tool: 'edit_file',
          output: 'patch',
          patchRef: { id: 'p', byteLen: 1 },
          outputRef: { id: 'o', byteLen: 1 },
        }),
      ],
      { onRevertEdit },
    )
    fireEvent.click(opener())
    choose(UI_TEXT.rowRevertEdit)
    expect(onRevertEdit).toHaveBeenCalledWith('t', 'p')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    ['while a turn runs', 'completed', { onRevertEdit: vi.fn(), isRunning: true }],
    ['where nothing may write the files', 'completed', {}],
    ['before the edit lands', 'inProgress', { onRevertEdit: vi.fn() }],
  ] as const)('offers no Revert %s', (_case, status, overrides) => {
    renderTranscript(
      [
        tool({
          tool: 'edit_file',
          status,
          output: 'patch',
          patchRef: { id: 'p', byteLen: 1 },
          outputRef: { id: 'o', byteLen: 1 },
        }),
      ],
      overrides,
    )
    fireEvent.click(opener())
    expect(screen.getByRole('menuitem', { name: UI_TEXT.rowOpenOutput })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: UI_TEXT.rowRevertEdit })).toBeNull()
  })

  it('withholds edit review before edits land and offers stored output with no preview', () => {
    renderTranscript([
      tool({
        tool: 'edit_file',
        status: 'inProgress',
        patchRef: { id: 'p', byteLen: 1 },
        outputRef: { id: 'o', byteLen: 1 },
      }),
    ])
    fireEvent.click(opener())
    expect(screen.getByRole('menuitem', { name: UI_TEXT.rowOpenOutput })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: UI_TEXT.diffTallyReview })).toBeNull()
  })

  it('offers the shell output even before the command prints text', () => {
    const props = renderTranscript([
      tool({ tool: 'powershell', args: '{"command":"ls"}', status: 'inProgress' }),
    ])
    fireEvent.click(opener())
    choose(UI_TEXT.rowOpenOutput)
    expect(props.onOpenOutput).toHaveBeenCalledWith('t', 'PowerShell', '', undefined)
  })

  it('shows no opener or menu on rows with no actions', () => {
    renderTranscript(
      [
        user,
        { kind: 'assistant', id: 'a', text: 'stream', isStreaming: true },
        tool({}),
        {
          kind: 'notice',
          id: 'n',
          level: 'info',
          text: 'spent',
          redoRestoreId: 'r',
          isRedoUsed: true,
        },
      ],
      { onRedo: vi.fn() },
    )
    expect(screen.queryByRole('button', { name: UI_TEXT.rowMoreActions })).toBeNull()
    fireEvent.contextMenu(screen.getByText('hello'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows only the quote menu while a row has highlighted-text actions', () => {
    renderTranscript([user], {
      onRewind: vi.fn(),
      quoteMenuEntryId: 'u',
      onQuote: vi.fn(),
      onCopyQuote: vi.fn(),
      onCloseQuoteMenu: vi.fn(),
    })
    fireEvent.click(opener())
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('menu', { name: UI_TEXT.quoteMenuLabel })).toBeInTheDocument()
  })

  // F2 review fixes (lane W), from the independent review of fafa8783.
  it('opens the right-clicked row’s menu while text is selected in another row (P1)', () => {
    renderTranscript([user, { ...user, id: 'u2', seq: 2, turnId: 't2', text: 'world' }], {
      onRewind: vi.fn(),
    })
    const clearSelection = selectPassage(screen.getByText('hello'))
    try {
      const other = screen.getByText('world')
      expect(fireEvent.contextMenu(other, { clientX: 100, clientY: 100 })).toBe(false)
      expect(within(other.closest('li')!).getByRole('menu')).toBeInTheDocument()
    } finally {
      clearSelection()
    }
  })

  it('shows the Copied feedback on the row’s "…" once Copy closes the menu (P2)', () => {
    renderTranscript([{ kind: 'assistant', id: 'a', text: '**done**', isStreaming: false }])
    expect(opener()).toHaveAttribute('title', UI_TEXT.rowMoreActions)
    fireEvent.click(opener())
    choose(UI_TEXT.copyResponse)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(opener()).toHaveAttribute('title', UI_TEXT.copiedCode)
    expect(opener().querySelector('path[d="m3 8.5 3 3 7-7"]')).not.toBeNull()
  })

  it.each(['button', 'pointer'])(
    'keeps one row menu open when another row’s opens by %s (P3)',
    (method) => {
      renderTranscript([user, { ...user, id: 'u2', seq: 2, turnId: 't2', text: 'world' }], {
        onRewind: vi.fn(),
      })
      const [first, second] = screen.getAllByRole('button', { name: UI_TEXT.rowMoreActions })
      fireEvent.click(first!)
      expect(screen.getAllByRole('menu')).toHaveLength(1)
      if (method === 'button') {
        fireEvent.click(second!)
      } else {
        fireEvent.contextMenu(screen.getByText('world'), { clientX: 50, clientY: 50 })
      }
      expect(screen.getAllByRole('menu')).toHaveLength(1)
      expect(within(screen.getByText('world').closest('li')!).getByRole('menu')).toBeInTheDocument()
    },
  )

  it('opens nothing on a bare F10, nor on Shift+F10 or the menu key on a row with no actions (P3)', () => {
    renderTranscript([user, { kind: 'assistant', id: 'a', text: 'stream', isStreaming: true }], {
      onRewind: vi.fn(),
    })
    const button = opener()
    button.focus()
    expect(fireEvent.keyDown(button, { key: 'F10' })).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    const streaming = screen.getByText('stream').closest('li')!
    for (const init of [{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }]) {
      expect(fireEvent.keyDown(streaming, init)).toBe(true)
      expect(screen.queryByRole('menu')).toBeNull()
    }
  })

  it('keeps the Rewind group’s notes in its second burst, present and inert (P3)', () => {
    const onRewind = vi.fn()
    const notes = [UI_TEXT.checkpointsNoGit, UI_TEXT.conversationRewindUnavailable]
    renderTranscript([user], { onRewind, restoreNote: notes[0], conversationNote: notes[1] })
    fireEvent.click(opener())
    choose(UI_TEXT.rowRewindGroup)
    for (const note of notes) {
      const item = screen.getByRole('menuitem', { name: note })
      // A note reads on its own pill now, with no hover (2026-10-04).
      expect(within(item).getByText(note)).toBeVisible()
      expect(item).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(item)
      expect(screen.getByRole('menu', { name: UI_TEXT.rowRewindGroup })).toBeInTheDocument()
    }
    expect(onRewind).not.toHaveBeenCalled()
  })

  // The owner's request of 2026-10-04: pills with labels, laid out by width.
  it('labels every pill of the user, reply and tool menus', () => {
    renderTranscript(
      [
        user,
        { kind: 'assistant', id: 'a', text: 'done', isStreaming: false },
        tool({
          id: 'e',
          tool: 'edit_file',
          output: 'patch',
          patchRef: { id: 'p', byteLen: 1 },
          outputRef: { id: 'o', byteLen: 1 },
        }),
      ],
      { onRewind: vi.fn(), onFork: vi.fn(), onReply: vi.fn(), onRevertEdit: vi.fn() },
    )
    const [userOpener, replyOpener, toolOpener] = screen.getAllByRole('button', {
      name: UI_TEXT.rowMoreActions,
    })
    fireEvent.click(userOpener!)
    expect(expectLabelledPills()).toHaveLength(2)
    choose(UI_TEXT.rowRewindGroup)
    expectLabelledPills()
    fireEvent.click(replyOpener!)
    expect(expectLabelledPills().map((pill) => pill.textContent)).toEqual([
      UI_TEXT.copyResponse,
      UI_TEXT.replyToOutput,
    ])
    fireEvent.click(toolOpener!)
    expect(expectLabelledPills().map((pill) => pill.textContent)).toEqual([
      UI_TEXT.rowOpenOutput,
      UI_TEXT.diffTallyReview,
      UI_TEXT.rowRevertEdit,
    ])
  })

  it('keeps a row menu’s pills inside a 320 px panel and apart, in both bursts', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(760)
    // About 7 px a character plus the icon and padding: the notes are wider
    // than the panel and are capped at it, 304 px.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('role') === 'menuitem' ? 52 + 7 * this.textContent.length : 0
    })
    renderTranscript([user], {
      onRewind: vi.fn(),
      onFork: vi.fn(),
      onForkRewind: vi.fn(),
      onRewindConversation: vi.fn(),
      restoreNote: UI_TEXT.checkpointsNoGit,
      conversationNote: UI_TEXT.conversationRewindUnavailable,
    })
    fireEvent.contextMenu(screen.getByText('hello'), { clientX: 300, clientY: 90 })
    expectPlacedInNarrowPanel(3)
    choose(UI_TEXT.rowRewindGroup)
    expectPlacedInNarrowPanel(4)
  })

  it('leaves selected text to the enclosing quote menu', () => {
    renderTranscript([user], { onRewind: vi.fn() })
    const text = screen.getByText('hello')
    const clearSelection = selectPassage(text)
    try {
      expect(fireEvent.contextMenu(text)).toBe(true)
      expect(within(text.closest('li')!).queryByRole('menu')).toBeNull()
    } finally {
      clearSelection()
    }
  })
})
