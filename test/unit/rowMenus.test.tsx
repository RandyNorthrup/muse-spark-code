// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { renderTranscript, selectPassage, tool } from './helpers/transcriptFixtures'

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
