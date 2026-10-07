// @vitest-environment jsdom
import { Buffer } from 'node:buffer'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DICTATION_HOLD_MS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'
import type { SlashCommand } from '../../src/shared/slashCommands'
import type { PaletteKeys } from '../../src/webview/components/Palette'
import {
  Composer,
  type ComposerProps,
  rowsFor,
  type SlashPaletteSlot,
} from '../../src/webview/components/Composer'
import { installSurfaceRetry } from '../../src/webview/surfaceRetry'
import { testSettings } from './helpers/fakes'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe = vi.fn()
      public disconnect = vi.fn()
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The "/" list's commands (M38): two commands and a skill. */
const slashCommands: readonly SlashCommand[] = [
  { name: 'compact', detail: 'Summarise older context', action: { type: 'compact' } },
  { name: 'clear', detail: 'Clear conversation', action: { type: 'clearConversation' } },
  {
    name: 'code-review',
    detail: 'Reviews the diff',
    action: { type: 'insertSkill', selector: 'code-review' },
  },
]

const PALETTE_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Escape'])
// Where the composer finds the stand-in palette's keyboard.
const slashKeys: { current: PaletteKeys | null } = { current: null }

/**
 * A stand-in for the attached palette (M38): it takes the keys the real one
 * takes, records them, and closes on Escape.
 */
function slashPalette(seen: string[]) {
  return (slot: SlashPaletteSlot) => {
    slashKeys.current = {
      didHandleKey: (event) => {
        if (!PALETTE_KEYS.has(event.key)) {
          return false
        }
        seen.push(event.key)
        if (event.key === 'Escape') {
          slot.onClose()
        }
        event.preventDefault()
        return true
      },
    }
    return <SlashPaletteRows slot={slot} />
  }
}

function SlashPaletteRows({ slot }: { readonly slot: SlashPaletteSlot }) {
  useEffect(() => {
    slot.onActiveRowChange('test-palette-row')
  }, [slot.onActiveRowChange])
  return (
    <div role="dialog" aria-label="Actions">
      <div id="palette-listbox">
        <p id="test-palette-row">Command</p>
      </div>
    </div>
  )
}

/** The composer's clock (the tap/hold threshold reads it). */
const clock = { now: 1_000_000 }

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  clock.now = 1_000_000
  let nextAttachmentRequestId = 0
  const props: ComposerProps = {
    draft: '',
    placeholder: 'type here',
    settings: testSettings,
    canSend: true,
    isRunning: false,
    modelLabel: 'muse-spark-1.3 High',
    permissionMode: 'manual',
    context: undefined,
    paidBadge: undefined,
    onOpenUsage: vi.fn(),
    focusRequests: 0,
    pendingInsert: undefined,
    attachments: [],
    attachmentEpoch: 0,
    attachmentSettlements: [],
    newAttachmentRequestId: () => `test-attachment-${String(++nextAttachmentRequestId)}`,
    mentionResults: undefined,
    editorContextLabel: undefined,
    referenceLabel: undefined,
    onDismissReference: vi.fn(),
    dictation: { status: 'idle', reason: undefined, engine: 'system' },
    now: () => clock.now,
    onDictation: vi.fn(),
    onDismissEditorContext: vi.fn(),
    onDraftChange: vi.fn(),
    onInsertApplied: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    onFocusChange: vi.fn(),
    onOpenPalette: vi.fn(),
    onOpenModelPicker: vi.fn(),
    onCyclePermissionMode: vi.fn(),
    onOpenModeMenu: vi.fn(),
    onOpenAttachMenu: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSearchMentions: vi.fn(),
    onAttachImage: vi.fn(),
    onRefuseFile: vi.fn(),
    onDroppedUris: vi.fn(),
    onCompact: vi.fn(),
    banner: undefined,
    onDismissBanner: vi.fn(),
    slashCommands,
    isMenuOpen: false,
    renderSlashPalette: slashPalette([]),
    slashPaletteKeys: slashKeys,
    onSlashCommand: vi.fn(),
    onSlashMenuOpen: vi.fn(),
    ...overrides,
  }
  const view = render(<Composer {...props} />)
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
  return { props, view, textarea }
}

function largePdf(name: string): File {
  const file = new File([Uint8Array.from([1])], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: MAX_DOCUMENT_BYTES })
  return file
}

function openPromptMenu(gesture: 'toolbar' | 'context', textarea: HTMLTextAreaElement): void {
  if (gesture === 'toolbar') {
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptLibrary }))
  } else {
    expect(fireEvent.contextMenu(textarea, { clientX: 120, clientY: 140 })).toBe(false)
  }
}

it.each(['toolbar', 'context'] as const)(
  'offers exact composer prompt text through the %s menu without sending',
  async (gesture) => {
    const onSavePrompt = vi.fn(),
      onSharePrompt = vi.fn(),
      onUseSavedPrompt = vi.fn()
    const { props, textarea } = renderComposer({
      draft: 'Exact\r\ncomposer text',
      onSavePrompt,
      onSharePrompt,
      onUseSavedPrompt,
    })
    const context = textarea.closest('footer')?.dataset['vscodeContext']
    expect(context === undefined ? undefined : JSON.parse(context)).toEqual({
      'museSpark.promptSource': 'composer',
      'museSpark.promptText': 'Exact\r\ncomposer text',
      'museSpark.composerHasText': true,
      'museSpark.chatAvailable': true,
    })
    // One compact menu button, never a row of prompt buttons above the box.
    for (const name of [UI_TEXT.promptSave, UI_TEXT.sharePrompt, UI_TEXT.promptUseSaved]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    const openMenu = () => {
      openPromptMenu(gesture, textarea)
    }
    openMenu()
    const menu = await screen.findByRole('menu', { name: UI_TEXT.promptLibrary })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([UI_TEXT.promptSave, UI_TEXT.sharePrompt, UI_TEXT.promptUseSaved])
    fireEvent.click(within(menu).getByRole('menuitem', { name: UI_TEXT.promptSave }))
    expect(screen.queryByRole('menu', { name: UI_TEXT.promptLibrary })).toBeNull()
    expect(document.activeElement).toBe(textarea)
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: UI_TEXT.sharePrompt }))
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: UI_TEXT.promptUseSaved }))
    expect(onSavePrompt).toHaveBeenCalledWith('Exact\r\ncomposer text')
    expect(onSharePrompt).toHaveBeenCalledWith('Exact\r\ncomposer text')
    expect(onUseSavedPrompt).toHaveBeenCalledTimes(1)
    expect(props.onSubmit).not.toHaveBeenCalled()
  },
)

it.each(['toolbar', 'context'] as const)(
  'keeps save and share out of the %s menu while the draft is empty',
  async (gesture) => {
    const { textarea } = renderComposer({
      draft: '  ',
      onSavePrompt: vi.fn(),
      onSharePrompt: vi.fn(),
      onUseSavedPrompt: vi.fn(),
    })
    openPromptMenu(gesture, textarea)
    const menu = await screen.findByRole('menu', { name: UI_TEXT.promptLibrary })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([UI_TEXT.promptUseSaved])
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: UI_TEXT.promptLibrary })).toBeNull()
    expect(document.activeElement).toBe(textarea)
  },
)

it('leaves VS Code right-click native and keeps its toolbar prompt menu', async () => {
  document.body.dataset['nativeContextMenu'] = 'true'
  try {
    const { textarea } = renderComposer({ onUseSavedPrompt: vi.fn() })
    expect(fireEvent.contextMenu(textarea)).toBe(true)
    expect(screen.queryByRole('menu', { name: UI_TEXT.promptLibrary })).toBeNull()
    openPromptMenu('toolbar', textarea)
    expect(await screen.findByRole('menu', { name: UI_TEXT.promptLibrary })).toBeInTheDocument()
  } finally {
    delete document.body.dataset['nativeContextMenu']
  }
})

it('keeps the browser clipboard menu reachable with Shift-right-click', async () => {
  const { textarea } = renderComposer({ onUseSavedPrompt: vi.fn() })
  openPromptMenu('context', textarea)
  await screen.findByRole('menu', { name: UI_TEXT.promptLibrary })
  expect(fireEvent.contextMenu(textarea, { shiftKey: true })).toBe(true)
  expect(screen.queryByRole('menu', { name: UI_TEXT.promptLibrary })).toBeNull()
})

it('shows no prompt menu button when no prompt action is available', () => {
  const { textarea } = renderComposer({ draft: 'Text' })
  expect(screen.queryByRole('button', { name: UI_TEXT.promptLibrary })).toBeNull()
  expect(fireEvent.contextMenu(textarea)).toBe(true)
})

it('returns focus to the input when the prompt button closes its menu', async () => {
  const { textarea } = renderComposer({ draft: 'Text', onSavePrompt: vi.fn() })
  const button = screen.getByRole('button', { name: UI_TEXT.promptLibrary })
  fireEvent.click(button)
  await screen.findByRole('menu', { name: UI_TEXT.promptLibrary })
  expect(button).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(button)
  expect(screen.queryByRole('menu', { name: UI_TEXT.promptLibrary })).toBeNull()
  expect(document.activeElement).toBe(textarea)
})

it('closes the attached slash list while the prompt menu is open', async () => {
  const { props, view, textarea } = renderComposer({ onUseSavedPrompt: vi.fn() })
  textarea.focus()
  const typed = type(view, props, '/co')
  expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptLibrary }))
  await screen.findByRole('menu', { name: UI_TEXT.promptLibrary })
  expect(screen.queryByRole('listbox', { name: 'Slash commands' })).toBeNull()
  expect(typed).not.toHaveAttribute('aria-controls')
})

function pasteOrDropFile(
  gesture: 'paste' | 'drop',
  textarea: HTMLTextAreaElement,
  file: File,
): void {
  if (gesture === 'paste') {
    fireEvent.paste(textarea, { clipboardData: { files: [file], getData: () => '' } })
  } else {
    fireEvent.drop(screen.getByRole('contentinfo'), {
      dataTransfer: { files: [file], getData: () => '' },
    })
  }
}

/**
 * Simulates the parent applying `text` as the draft and the caret landing at
 * its end (the composer is controlled, so the draft arrives as a prop).
 */
function type(
  view: ReturnType<typeof render>,
  props: ComposerProps,
  text: string,
  extra: Partial<ComposerProps> = {},
): HTMLTextAreaElement {
  view.rerender(<Composer {...props} draft={text} {...extra} />)
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
  textarea.setSelectionRange(text.length, text.length)
  fireEvent.keyUp(textarea, { key: 'a' })
  return textarea
}

const attachment = {
  id: 'att-1',
  name: 'shot.png',
  mediaType: 'image/png',
  width: 686,
  height: 695,
  sizeBytes: 24,
}

describe('Composer keyboard semantics', () => {
  it('sends on Enter and suppresses the newline', () => {
    const { props, textarea } = renderComposer()
    const wasDefaultAllowed = fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(wasDefaultAllowed).toBe(false)
    expect(props.onSubmit).toHaveBeenCalledOnce()
  })

  it('inserts a newline on Shift+Enter without sending', () => {
    const { props, textarea } = renderComposer()
    const wasDefaultAllowed = fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(wasDefaultAllowed).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('requires Ctrl/Cmd+Enter when useCtrlEnterToSend is on', () => {
    const { props, textarea } = renderComposer({
      settings: { ...testSettings, useCtrlEnterToSend: true },
    })
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })).toBe(false)
    expect(fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })).toBe(false)
    expect(props.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('swallows the send gesture but does not submit while sending is disabled', () => {
    const { props, textarea } = renderComposer({ canSend: false })
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false)
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Send')).toBeDisabled()
  })

  it('ignores other keys', () => {
    const { props, textarea } = renderComposer()
    expect(fireEvent.keyDown(textarea, { key: 'a' })).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('cycles the permission mode on Shift+Tab', () => {
    const { props, textarea } = renderComposer()
    expect(fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(props.onCyclePermissionMode).toHaveBeenCalledOnce()
    expect(fireEvent.keyDown(textarea, { key: 'Tab' })).toBe(true)
  })

  it('lets Shift+Tab move focus when side chat locks Plan mode (M53)', () => {
    const { textarea } = renderComposer({
      permissionMode: 'plan',
      onCyclePermissionMode: undefined,
      onOpenModeMenu: undefined,
    })
    expect(fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(screen.getByRole('button', { name: UI_TEXT.sideChatPlanOnly })).toBeDisabled()
  })
})

describe('Composer focus and insertion', () => {
  it('reports focus changes', () => {
    const onFocusChange = vi.fn<(isFocused: boolean) => void>()
    const { textarea } = renderComposer({ onFocusChange })
    fireEvent.focus(textarea)
    fireEvent.blur(textarea)
    expect(onFocusChange.mock.calls).toEqual([[true], [false]])
  })

  it('focuses the textarea when a focus request arrives', () => {
    const { view, textarea, props } = renderComposer()
    expect(document.activeElement).not.toBe(textarea)
    view.rerender(<Composer {...props} focusRequests={1} />)
    expect(document.activeElement).toBe(textarea)
  })

  it('inserts pending text at the caret and reports it applied', () => {
    const { view, props, textarea } = renderComposer({ draft: 'hello world' })
    textarea.setSelectionRange(5, 5)
    view.rerender(<Composer {...props} pendingInsert=" @a.ts#1" />)
    expect(props.onDraftChange).toHaveBeenCalledWith('hello @a.ts#1 world')
    expect(props.onInsertApplied).toHaveBeenCalledOnce()
  })

  it('replaces a selection with the pending text', () => {
    const { view, props, textarea } = renderComposer({ draft: 'hello world' })
    textarea.setSelectionRange(6, 11)
    view.rerender(<Composer {...props} pendingInsert="there" />)
    expect(props.onDraftChange).toHaveBeenCalledWith('hello there')
  })

  it('reports the draft as the user types', () => {
    const { props, textarea } = renderComposer()
    fireEvent.change(textarea, { target: { value: 'typed' } })
    expect(props.onDraftChange).toHaveBeenCalledWith('typed')
  })
})

function withResults(paths: readonly string[], requestId = 1) {
  return { requestId, items: paths.map((path) => ({ path, isFolder: path.endsWith('/') })) }
}

describe('Composer mention menu', () => {
  it('asks the host for matches while typing an @ token and lists them', () => {
    const { props, view } = renderComposer()
    type(view, props, 'see @ap')
    expect(props.onSearchMentions).toHaveBeenLastCalledWith(1, 'ap')
    type(view, props, 'see @ap', { mentionResults: withResults(['src/app.ts', 'src/']) })
    const options = screen.getAllByRole('option')
    expect(options.map((node) => node.textContent)).toEqual(['src/app.ts', 'src/'])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('navigates with the arrows and applies the choice on Enter or Tab', () => {
    const { props, view } = renderComposer()
    type(view, props, '@a')
    const textarea = type(view, props, '@a', { mentionResults: withResults(['a.ts', 'b/a.ts']) })
    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(false)
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    expect(fireEvent.keyDown(textarea, { key: 'Tab' })).toBe(false)
    expect(props.onDraftChange).toHaveBeenLastCalledWith('@a.ts ')
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('selects a row by click and dismisses on Escape', () => {
    const { props, view } = renderComposer()
    type(view, props, '@a')
    const textarea = type(view, props, '@a', { mentionResults: withResults(['a.ts']) })
    fireEvent.click(screen.getByRole('option'))
    expect(props.onDraftChange).toHaveBeenLastCalledWith('@a.ts ')
    expect(fireEvent.keyDown(textarea, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('searches a quoted name with its space and inserts a spaced path quoted (D27)', () => {
    const { props, view } = renderComposer()
    type(view, props, 'see @"my no')
    expect(props.onSearchMentions).toHaveBeenLastCalledWith(1, 'my no')
    type(view, props, 'see @"my no', { mentionResults: withResults(['my notes/a b.md']) })
    fireEvent.click(screen.getByRole('option'))
    expect(props.onDraftChange).toHaveBeenLastCalledWith('see @"my notes/a b.md" ')
  })

  // The box keeps the focus (aria-activedescendant), so the list never
  // scrolls by itself: the active row must be brought into view (WCAG 2.1.1).
  it('scrolls the active match into view as the arrows move', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      const { props, view } = renderComposer()
      type(view, props, '@a')
      const textarea = type(view, props, '@a', {
        mentionResults: withResults(['a.ts', 'b/a.ts', 'c/a.ts']),
      })
      expect(scroll.mock.contexts.at(-1)).toBe(screen.getAllByRole('option')[0])
      // Up wraps to the last row, the one a short list hides first.
      fireEvent.keyDown(textarea, { key: 'ArrowUp' })
      const options = screen.getAllByRole('option')
      expect(options[2]).toHaveAttribute('aria-selected', 'true')
      expect(scroll.mock.contexts.at(-1)).toBe(options[2])
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
    } finally {
      scroll.mockRestore()
    }
  })

  it('ignores stale results and shows the empty state for no matches', () => {
    const { props, view } = renderComposer()
    type(view, props, '@zz')
    const textarea = type(view, props, '@zz', { mentionResults: withResults(['old'], 99) })
    expect(screen.getByText('No matching files')).toBeInTheDocument()
    expect(textarea).not.toHaveAttribute('aria-controls')
    expect(textarea).not.toHaveAttribute('aria-activedescendant')
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false)
    expect(props.onSubmit).toHaveBeenCalledOnce()
  })
})

describe('Composer attachments', () => {
  it('renders chips with dimensions and removes them', () => {
    const { props } = renderComposer({ attachments: [attachment] })
    expect(screen.getByText('shot.png')).toBeInTheDocument()
    expect(screen.getByText('686×695')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Remove shot.png'))
    expect(props.onRemoveAttachment).toHaveBeenCalledWith('att-1')
  })

  it('renders a PDF as a file chip with its name', () => {
    renderComposer({
      attachments: [
        {
          id: 'pdf-1',
          name: 'report.pdf',
          mediaType: 'application/pdf',
          sizeBytes: 512,
          pageCount: 2,
        },
        {
          id: 'text-1',
          name: 'notes.md',
          mediaType: 'text/plain',
          sizeBytes: 8,
        },
      ],
    })
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getByText('notes.md')).toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.textFileLabel)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove report.pdf' })).toBeInTheDocument()
  })

  it('attaches a pasted PDF and refuses one over the limit before encoding it', async () => {
    const { props, textarea } = renderComposer()
    const pdf = new File([new TextEncoder().encode('%PDF-1.4')], 'report.pdf', {
      type: 'application/pdf',
    })
    expect(fireEvent.paste(textarea, { clipboardData: { files: [pdf] } })).toBe(false)
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onAttachImage).toHaveBeenCalledWith({
      name: 'report.pdf',
      mediaType: 'application/pdf',
      base64: Buffer.from('%PDF-1.4').toString('base64'),
      requestId: expect.any(String),
      attachmentEpoch: 0,
    })
    const huge = new File([new Uint8Array([1])], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(huge, 'size', { value: MAX_DOCUMENT_BYTES + 1 })
    fireEvent.paste(textarea, { clipboardData: { files: [huge] } })
    expect(props.onRefuseFile).toHaveBeenCalledWith('huge.pdf', UI_TEXT.documentTooLarge)
  })

  it.each(['paste', 'drop'] as const)(
    'admits a real 20 MiB PDF with misleading image metadata by %s',
    async (gesture) => {
      const { props, textarea } = renderComposer()
      const header = new TextEncoder().encode(
        '%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n',
      )
      const bytes = new Uint8Array(MAX_IMAGE_BYTES * 2)
      bytes.set(header)
      const file = new File([bytes], 'report.png', { type: 'image/png' })
      const fullRead = vi.spyOn(file, 'arrayBuffer')
      pasteOrDropFile(gesture, textarea, file)
      await vi.waitFor(() => {
        expect(props.onAttachImage).toHaveBeenCalledOnce()
      })
      const posted = vi.mocked(props.onAttachImage).mock.calls[0]?.[0]
      expect(posted?.mediaType).toBe('application/pdf')
      expect(posted?.base64.startsWith('JVBER')).toBe(true)
      expect(fullRead).toHaveBeenCalledOnce()
      expect(props.onRefuseFile).not.toHaveBeenCalled()
    },
  )

  it('peeks an 11 MiB real PNG but never encodes its full bytes', async () => {
    const { props, textarea } = renderComposer()
    const bytes = new Uint8Array(MAX_IMAGE_BYTES + 1)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    const file = new File([bytes], 'oversize.png', { type: 'image/png' })
    const headerRead = vi.spyOn(file, 'slice')
    const fullRead = vi.spyOn(file, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [file] } })
    await vi.waitFor(() => {
      expect(props.onRefuseFile).toHaveBeenCalledWith('oversize.png', UI_TEXT.attachmentTooLarge)
    })
    expect(headerRead).toHaveBeenCalledOnce()
    expect(fullRead).not.toHaveBeenCalled()
    expect(props.onAttachImage).not.toHaveBeenCalled()
  })

  it.each(['paste', 'drop'] as const)(
    'admits a 20 MiB PDF with a text name and MIME by %s',
    async (gesture) => {
      const { props, textarea } = renderComposer()
      const bytes = new Uint8Array(MAX_IMAGE_BYTES * 2)
      bytes.set(new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n'))
      const file = new File([bytes], 'report.txt', { type: 'text/plain' })
      pasteOrDropFile(gesture, textarea, file)
      await vi.waitFor(() => {
        expect(props.onAttachImage).toHaveBeenCalledOnce()
      })
      expect(vi.mocked(props.onAttachImage).mock.calls[0]?.[0].mediaType).toBe('application/pdf')
      expect(props.onRefuseFile).not.toHaveBeenCalled()
    },
  )

  it('leaves an ordinary text-file paste and its clipboard text to the browser', () => {
    const { props, textarea } = renderComposer()
    const file = new File(['ordinary text'], 'notes.txt', { type: 'text/plain' })
    const read = vi.spyOn(file, 'arrayBuffer')
    expect(
      fireEvent.paste(textarea, {
        clipboardData: { files: [file], getData: () => 'ordinary text' },
      }),
    ).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(props.onAttachImage).not.toHaveBeenCalled()
    expect(props.onRefuseFile).not.toHaveBeenCalled()
  })

  it('refuses a private text name before reading a disguised PDF', () => {
    const { props } = renderComposer()
    const file = new File(['%PDF-1.4'], '.env.txt', { type: 'text/plain' })
    const read = vi.spyOn(file, 'slice')
    fireEvent.drop(screen.getByRole('contentinfo'), {
      dataTransfer: { files: [file], getData: () => '' },
    })
    expect(props.onRefuseFile).toHaveBeenCalledWith('.env.txt', UI_TEXT.textFilePrivate)
    expect(read).not.toHaveBeenCalled()
    expect(props.onAttachImage).not.toHaveBeenCalled()
  })

  it.each(['.crt', '.cert', '.keystore'])(
    'refuses a PDF dropped as %s before reading bytes',
    (name) => {
      const { props } = renderComposer()
      const file = new File(['%PDF-1.4'], name, { type: 'application/pdf' })
      const peek = vi.spyOn(file, 'slice')
      const read = vi.spyOn(file, 'arrayBuffer')
      fireEvent.drop(screen.getByRole('contentinfo'), {
        dataTransfer: { files: [file], getData: () => '' },
      })
      expect(props.onRefuseFile).toHaveBeenCalledWith(name, UI_TEXT.textFilePrivate)
      expect(peek).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
      expect(props.onAttachImage).not.toHaveBeenCalled()
    },
  )

  it('reserves aggregate media at header completion across rapid paste and drop', async () => {
    const { props, textarea } = renderComposer()
    const header = new TextEncoder().encode('%PDF-1.4')
    const first = new File([header], 'first.png', { type: 'image/png' })
    const second = new File([header], 'second.png', { type: 'image/png' })
    const firstPeek = Promise.withResolvers<ArrayBuffer>()
    const secondPeek = Promise.withResolvers<ArrayBuffer>()
    const firstHeader = new Blob([header])
    const secondHeader = new Blob([header])
    vi.spyOn(firstHeader, 'arrayBuffer').mockImplementation(() => firstPeek.promise)
    vi.spyOn(secondHeader, 'arrayBuffer').mockImplementation(() => secondPeek.promise)
    vi.spyOn(first, 'slice').mockReturnValue(firstHeader)
    vi.spyOn(second, 'slice').mockReturnValue(secondHeader)
    Object.defineProperty(first, 'size', { value: MAX_DOCUMENT_BYTES })
    Object.defineProperty(second, 'size', { value: MAX_DOCUMENT_BYTES })
    const secondFullRead = vi.spyOn(second, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [first] } })
    fireEvent.drop(screen.getByRole('contentinfo'), {
      dataTransfer: { files: [second], getData: () => '' },
    })
    firstPeek.resolve(header.buffer)
    await vi.waitFor(() => {
      expect(props.onAttachImage).toHaveBeenCalledOnce()
    })
    secondPeek.resolve(header.buffer)
    await vi.waitFor(() => {
      expect(props.onRefuseFile).toHaveBeenCalledWith('second.png', UI_TEXT.mediaTotalTooLarge)
    })
    expect(secondFullRead).not.toHaveBeenCalled()
  })

  it('drops a PDF header read from a cleared conversation before full encoding', async () => {
    const { props, view, textarea } = renderComposer()
    const file = new File([new TextEncoder().encode('%PDF-1.4')], 'report.png', {
      type: 'image/png',
    })
    Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES * 2 })
    const peek = Promise.withResolvers<ArrayBuffer>()
    const header = new Blob([new TextEncoder().encode('%PDF-1.4')])
    vi.spyOn(header, 'arrayBuffer').mockImplementation(() => peek.promise)
    vi.spyOn(file, 'slice').mockReturnValue(header)
    const fullRead = vi.spyOn(file, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [file] } })
    view.rerender(<Composer {...props} attachmentEpoch={1} />)
    peek.resolve(new TextEncoder().encode('%PDF-1.4').buffer)
    await act(async () => {
      await peek.promise
    })
    expect(fullRead).not.toHaveBeenCalled()
    expect(props.onAttachImage).not.toHaveBeenCalled()
    expect(props.onRefuseFile).not.toHaveBeenCalled()
  })

  it('refuses aggregate PDF paste and drop before reading rejected bytes', async () => {
    const { props, textarea } = renderComposer()
    const first = new File([Uint8Array.from([1])], 'first.pdf', { type: 'application/pdf' })
    const second = new File([Uint8Array.from([2])], 'second.pdf', { type: 'application/pdf' })
    const third = new File([Uint8Array.from([3])], 'third.pdf', { type: 'application/pdf' })
    const fourth = new File([Uint8Array.from([4])], 'fourth.pdf', { type: 'application/pdf' })
    for (const file of [first, second, third, fourth]) {
      Object.defineProperty(file, 'size', { value: MAX_DOCUMENT_BYTES })
    }
    const heldRead = Promise.withResolvers<ArrayBuffer>()
    vi.spyOn(first, 'arrayBuffer').mockImplementation(() => heldRead.promise)
    const secondRead = vi.spyOn(second, 'arrayBuffer')
    const thirdRead = vi.spyOn(third, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [first, second] } })
    fireEvent.drop(screen.getByRole('contentinfo'), {
      dataTransfer: { files: [third], getData: () => '' },
    })
    expect(secondRead).not.toHaveBeenCalled()
    expect(thirdRead).not.toHaveBeenCalled()
    expect(props.onRefuseFile).toHaveBeenCalledWith('second.pdf', UI_TEXT.mediaTotalTooLarge)
    expect(props.onRefuseFile).toHaveBeenCalledWith('third.pdf', UI_TEXT.mediaTotalTooLarge)
    heldRead.resolve(Uint8Array.from([1]).buffer)
    await act(async () => {
      await heldRead.promise
      await Promise.resolve()
    })
    const fourthRead = vi.spyOn(fourth, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [fourth] } })
    expect(fourthRead).not.toHaveBeenCalled()
    expect(props.onRefuseFile).toHaveBeenCalledWith('fourth.pdf', UI_TEXT.mediaTotalTooLarge)
  })

  it('reads only the admitted PDF from a twenty-file paste', async () => {
    const { props, textarea } = renderComposer()
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, index) => {
      const file = new File([Uint8Array.from([index])], `report-${String(index)}.pdf`, {
        type: 'application/pdf',
      })
      Object.defineProperty(file, 'size', { value: MAX_DOCUMENT_BYTES })
      return file
    })
    const rejectedReads = files.slice(1).map((file) => vi.spyOn(file, 'arrayBuffer'))
    fireEvent.paste(textarea, { clipboardData: { files } })
    expect(rejectedReads.every((read) => read.mock.calls.length === 0)).toBe(true)
    expect(props.onRefuseFile).toHaveBeenCalledTimes(MAX_ATTACHMENTS_PER_MESSAGE - 1)
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onAttachImage).toHaveBeenCalledTimes(1)
  })

  it('counts an existing PDF before reading another pasted PDF', () => {
    const { props, textarea } = renderComposer({
      attachments: [
        {
          id: 'prior-pdf',
          name: 'prior.pdf',
          mediaType: 'application/pdf',
          sizeBytes: MAX_DOCUMENT_BYTES,
          pageCount: 1,
        },
      ],
    })
    const next = new File([Uint8Array.from([1])], 'next.pdf', { type: 'application/pdf' })
    Object.defineProperty(next, 'size', { value: MAX_DOCUMENT_BYTES })
    const read = vi.spyOn(next, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [next] } })
    expect(read).not.toHaveBeenCalled()
    expect(props.onRefuseFile).toHaveBeenCalledWith('next.pdf', UI_TEXT.mediaTotalTooLarge)
  })

  it('releases a posted media reservation after the host refuses the file', async () => {
    const { props, view, textarea } = renderComposer()
    const first = new File([Uint8Array.from([1])], 'first.pdf', { type: 'application/pdf' })
    Object.defineProperty(first, 'size', { value: MAX_DOCUMENT_BYTES })
    fireEvent.paste(textarea, { clipboardData: { files: [first] } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onAttachImage).toHaveBeenCalledTimes(1)
    const firstRequest = vi.mocked(props.onAttachImage).mock.calls[0]?.[0]
    if (firstRequest === undefined) {
      throw new Error('expected browser attachment request')
    }
    view.rerender(
      <Composer
        {...props}
        banner="first.pdf: unsupported"
        attachmentSettlements={[firstRequest.requestId]}
      />,
    )
    const next = new File([Uint8Array.from([2])], 'next.pdf', { type: 'application/pdf' })
    Object.defineProperty(next, 'size', { value: MAX_DOCUMENT_BYTES })
    fireEvent.paste(textarea, { clipboardData: { files: [next] } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onAttachImage).toHaveBeenCalledTimes(2)
  })

  it('does not release a posted file when a same-name paste is refused locally', async () => {
    const { props, view, textarea } = renderComposer()
    fireEvent.paste(textarea, { clipboardData: { files: [largePdf('same.pdf')] } })
    await act(async () => {
      await Promise.resolve()
    })
    const refused = largePdf('same.pdf')
    const refusedRead = vi.spyOn(refused, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [refused] } })
    expect(refusedRead).not.toHaveBeenCalled()
    view.rerender(<Composer {...props} banner={`same.pdf: ${UI_TEXT.mediaTotalTooLarge}`} />)
    const third = largePdf('third.pdf')
    const thirdRead = vi.spyOn(third, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [third] } })
    expect(thirdRead).not.toHaveBeenCalled()
  })

  it('releases both same-name reservations when their host refusals share a banner', async () => {
    const { props, view, textarea } = renderComposer()
    const image = () => {
      const file = new File([Uint8Array.from([1])], 'same.png', { type: 'image/png' })
      Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES })
      return file
    }
    fireEvent.paste(textarea, { clipboardData: { files: [image(), image()] } })
    await act(async () => {
      await Promise.resolve()
    })
    const requests = vi.mocked(props.onAttachImage).mock.calls.map(([data]) => data.requestId)
    expect(requests).toHaveLength(2)
    view.rerender(
      <Composer {...props} banner="same.png: unsupported" attachmentSettlements={requests} />,
    )
    const next = new File([Uint8Array.from([2])], 'next.pdf', { type: 'application/pdf' })
    Object.defineProperty(next, 'size', { value: MAX_DOCUMENT_BYTES })
    const read = vi.spyOn(next, 'arrayBuffer')
    fireEvent.paste(textarea, { clipboardData: { files: [next] } })
    expect(read).toHaveBeenCalledOnce()
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onAttachImage).toHaveBeenCalledTimes(3)
  })

  it('attaches pasted images and lets text pastes through', async () => {
    const { props, textarea } = renderComposer()
    const image = new File([Uint8Array.from([1, 2, 3])], 'clip.png', { type: 'image/png' })
    const isDefaultAllowed = fireEvent.paste(textarea, { clipboardData: { files: [image] } })
    expect(isDefaultAllowed).toBe(false)
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onAttachImage).toHaveBeenCalledWith({
      name: 'clip.png',
      mediaType: 'image/png',
      base64: 'AQID',
      requestId: expect.any(String),
      attachmentEpoch: 0,
    })
    expect(fireEvent.paste(textarea, { clipboardData: { files: [] } })).toBe(true)
  })

  it('accepts dropped images and editor resources', async () => {
    const { props } = renderComposer()
    const footer = screen.getByRole('contentinfo')
    const image = new File([Uint8Array.from([9])], '', { type: 'image/jpeg' })
    fireEvent.drop(footer, {
      dataTransfer: {
        files: [image],
        getData: () => 'file:///ws/src/a.ts\r\n# comment\r\n',
      },
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onAttachImage).toHaveBeenCalledWith({
      name: 'pasted-image',
      mediaType: 'image/jpeg',
      base64: 'CQ==',
      requestId: expect.any(String),
      attachmentEpoch: 0,
    })
    expect(props.onDroppedUris).toHaveBeenCalledWith(['file:///ws/src/a.ts'])
  })

  it('compacts from the context indicator and shows a dismissible banner (M14)', () => {
    const { props } = renderComposer({
      context: { usedTokens: 120_000, windowTokens: 1_000_000, pressure: 'normal' },
      banner: 'Unsupported file type: audio.node. Supported as uploads: images.',
    })
    fireEvent.click(screen.getByRole('button', { name: /^Context 12% used/ }))
    expect(props.onCompact).toHaveBeenCalledTimes(1)
    // Read out by the app's live region, not by an alert of its own (M25).
    expect(screen.getByText(/Unsupported file type: audio\.node/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(props.onDismissBanner).toHaveBeenCalledTimes(1)
  })

  // M25: an image the host would refuse was read and base64-encoded first,
  // then posted, only to come back refused.
  it('refuses an image over the size limit, or one too many, before reading it (M25)', async () => {
    const { props, view, textarea } = renderComposer()
    const huge = new File([Uint8Array.from([1])], 'huge.png', { type: 'image/png' })
    Object.defineProperty(huge, 'size', { value: MAX_IMAGE_BYTES + 1 })
    fireEvent.paste(textarea, { clipboardData: { files: [huge] } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(props.onRefuseFile).toHaveBeenCalledWith('huge.png', UI_TEXT.attachmentTooLarge)
    expect(props.onAttachImage).not.toHaveBeenCalled()
    view.unmount()
    const full = renderComposer({
      attachments: Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, index) => ({
        ...attachment,
        id: `att-${String(index)}`,
      })),
    })
    const extra = new File([Uint8Array.from([2])], 'extra.png', { type: 'image/png' })
    fireEvent.paste(full.textarea, { clipboardData: { files: [extra] } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(full.props.onRefuseFile).toHaveBeenCalledWith('extra.png', UI_TEXT.attachmentLimit)
    expect(full.props.onAttachImage).not.toHaveBeenCalled()
  })
})

describe('Composer input methods (M25)', () => {
  it('leaves the keys of an IME composition alone: Enter commits the candidate, not the message', () => {
    const { props, textarea } = renderComposer()
    expect(fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(textarea, { key: 'Process' })).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSubmit).toHaveBeenCalledOnce()
  })

  it('does not pick a mention with the Enter that ends a composition', () => {
    const { props, view } = renderComposer()
    type(view, props, '@a')
    const textarea = type(view, props, '@a', { mentionResults: withResults(['a.ts']) })
    expect(fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })).toBe(true)
    expect(props.onDraftChange).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
})

describe('Composer chrome', () => {
  it('routes the toolbar buttons without blurring an open menu', () => {
    const { props } = renderComposer({ permissionMode: 'auto' })
    for (const label of ['Attach', 'Commands', 'Model', 'Permission mode: Auto']) {
      expect(fireEvent.mouseDown(screen.getByLabelText(label))).toBe(false)
      fireEvent.click(screen.getByLabelText(label))
    }
    expect(props.onOpenAttachMenu).toHaveBeenCalledOnce()
    expect(props.onOpenPalette).toHaveBeenCalledOnce()
    expect(props.onOpenModelPicker).toHaveBeenCalledOnce()
    expect(props.onOpenModeMenu).toHaveBeenCalledOnce()
    expect(props.onCyclePermissionMode).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Model')).toHaveTextContent('muse-spark-1.3 High')
  })

  it('swaps Send for Stop and the placeholder while a turn is running', () => {
    const { props, textarea } = renderComposer({ isRunning: true })
    expect(screen.queryByLabelText('Send')).toBeNull()
    expect(textarea).toHaveAttribute('placeholder', 'Queue another message…')
    expect(screen.getByLabelText('Stop')).toHaveClass('send-button-stop')
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(props.onStop).toHaveBeenCalledOnce()
  })

  it('shows the context indicator only when known', () => {
    const { view, props } = renderComposer()
    expect(screen.queryByTitle(/tokens/)).toBeNull()
    view.rerender(
      <Composer
        {...props}
        context={{ usedTokens: 120_000, windowTokens: 1_000_000, pressure: 'normal' }}
      />,
    )
    expect(
      screen.getByTitle(
        'Context 12% used · 120K of 1M tokens · pressure normal · Click to compact now',
      ),
    ).toHaveTextContent('12')
  })

  it('uses the reported context ring and keeps compact available (M87)', () => {
    const { props } = renderComposer({
      context: { usedTokens: 42, windowTokens: 100, pressure: 'normal' },
    })
    const meter = screen.getByRole('button', { name: /Context 42% used/ })
    expect(meter).toHaveTextContent('42')
    fireEvent.click(meter)
    expect(props.onCompact).toHaveBeenCalledOnce()
  })

  it('gives slash rows the same pointer and accessible tip (M87)', () => {
    const { view, props, textarea } = renderComposer({
      slashCommands: [
        {
          name: 'compact',
          detail: 'Compact context',
          tip: 'Free context now.',
          action: { type: 'compact' },
        },
      ],
    })
    textarea.focus()
    type(view, props, '/co')
    const row = screen.getByRole('option', { name: /compact/ })
    expect(row).toHaveAttribute('title', 'Free context now.')
    expect(row).toHaveAttribute('aria-describedby', 'slash-option-0-tip')
    expect(row).toHaveAccessibleDescription('Free context now.')
  })

  it('grows with the draft', () => {
    const { textarea } = renderComposer({ draft: 'a\nb\nc' })
    expect(textarea).toHaveAttribute('rows', '3')
  })

  it('caps the row count', () => {
    const { textarea } = renderComposer({
      draft: Array.from({ length: 40 }, () => 'x').join('\n'),
    })
    expect(textarea).toHaveAttribute('rows', '10')
  })

  // Issue #4: a long line that wraps counted as one row, so the box stayed a
  // single line however much it held.
  it('grows with the wrapped lines it measures, shrinks back, and caps at ten', () => {
    const { view, props, textarea } = renderComposer({ draft: 'one line' })
    let contentHeight = 20
    Object.defineProperties(textarea, {
      clientHeight: { configurable: true, get: () => 20 },
      scrollHeight: { configurable: true, get: () => contentHeight },
    })
    contentHeight = 60
    view.rerender(<Composer {...props} draft="a line long enough to wrap three times" />)
    expect(textarea).toHaveAttribute('rows', '3')
    contentHeight = 20
    view.rerender(<Composer {...props} draft="short" />)
    expect(textarea).toHaveAttribute('rows', '1')
    contentHeight = 400
    view.rerender(<Composer {...props} draft="a wall of text" />)
    expect(textarea).toHaveAttribute('rows', '10')
  })

  it('counts rows from the measurement when there is one, else from the newlines', () => {
    expect(rowsFor('a\nb', { scrollHeight: 0, rowHeight: 0 })).toBe(2)
    expect(rowsFor('x', { scrollHeight: 59, rowHeight: 20 })).toBe(3)
    expect(rowsFor('a\nb\nc', { scrollHeight: 20, rowHeight: 20 })).toBe(3)
    expect(rowsFor('')).toBe(1)
  })
})

describe('Composer open-file chip (M5)', () => {
  it('shows the label beside the model pill and closes on its ×', () => {
    const { props } = renderComposer({ editorContextLabel: 'App.tsx L5-10' })
    const chip = screen.getByText('App.tsx L5-10')
    expect(chip.closest('.editor-chip')).toHaveAttribute(
      'title',
      'Shared with Muse as context; × leaves it out',
    )
    expect(chip.closest('.composer-toolbar-group')).toContainElement(screen.getByLabelText('Model'))
    fireEvent.click(screen.getByLabelText('Leave the open file out: App.tsx L5-10'))
    expect(props.onDismissEditorContext).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without a label', () => {
    renderComposer()
    expect(document.querySelector('.editor-chip')).toBeNull()
  })
})

const mic = () => screen.getByLabelText('Record voice')

describe('Composer microphone (M9)', () => {
  it('shows the Claude Code tooltip and starts on a tap', () => {
    const { props } = renderComposer()
    expect(mic()).toHaveAttribute('title', 'Tap or hold to record (Ctrl+D)')
    expect(mic()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.pointerDown(mic())
    expect(props.onDictation).toHaveBeenCalledWith('start')
    // A tap (released within the hold threshold) keeps recording.
    clock.now += DICTATION_HOLD_MS - 1
    fireEvent.pointerUp(window)
    expect(props.onDictation).toHaveBeenCalledTimes(1)
  })

  it('a hold records while held and stops on release, wherever the pointer went', () => {
    const { props } = renderComposer()
    fireEvent.pointerDown(mic())
    clock.now += DICTATION_HOLD_MS
    fireEvent.pointerUp(window)
    expect(vi.mocked(props.onDictation).mock.calls).toEqual([['start'], ['stop']])
  })

  it('a press while listening stops, and the button reads pressed with the stop title', () => {
    const { props } = renderComposer({
      dictation: { status: 'listening', reason: undefined, engine: 'system' },
    })
    expect(mic()).toHaveAttribute('aria-pressed', 'true')
    expect(mic()).toHaveAttribute('title', 'Stop recording (Ctrl+D)')
    expect(screen.getByLabelText('Message Muse')).toHaveAttribute('placeholder', 'Listening…')
    fireEvent.pointerDown(mic())
    clock.now += DICTATION_HOLD_MS
    fireEvent.pointerUp(window)
    expect(vi.mocked(props.onDictation).mock.calls).toEqual([['stop']])
  })

  it('shows the starting placeholder and stops from that state too', () => {
    const { props } = renderComposer({
      dictation: { status: 'starting', reason: undefined, engine: 'system' },
    })
    expect(screen.getByLabelText('Message Muse')).toHaveAttribute(
      'placeholder',
      'Starting the microphone…',
    )
    fireEvent.pointerDown(mic())
    expect(vi.mocked(props.onDictation).mock.calls).toEqual([['stop']])
  })

  it('keeps the caret in the textarea: the press is default-prevented', () => {
    renderComposer()
    expect(fireEvent.pointerDown(mic())).toBe(false)
  })

  it('ignores secondary buttons', () => {
    const { props } = renderComposer()
    fireEvent.pointerDown(mic(), { button: 2 })
    expect(props.onDictation).not.toHaveBeenCalled()
  })

  it('is dimmed with the reason as its tooltip when unavailable, and inert', () => {
    const { props } = renderComposer({
      dictation: { status: 'unavailable', reason: 'No recogniser on Linux.', engine: 'system' },
    })
    expect(mic()).toHaveAttribute('aria-disabled', 'true')
    expect(mic()).toHaveAttribute('title', 'No recogniser on Linux.')
    fireEvent.pointerDown(mic())
    fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'd', ctrlKey: true })
    expect(props.onDictation).not.toHaveBeenCalled()
  })

  it('Ctrl+D in the composer taps or holds like the button, ignoring key repeat', () => {
    const { props, textarea } = renderComposer()
    expect(fireEvent.keyDown(textarea, { key: 'd', ctrlKey: true })).toBe(false)
    expect(fireEvent.keyDown(textarea, { key: 'd', ctrlKey: true, repeat: true })).toBe(false)
    clock.now += DICTATION_HOLD_MS
    fireEvent.keyUp(textarea, { key: 'd', ctrlKey: true })
    expect(vi.mocked(props.onDictation).mock.calls).toEqual([['start'], ['stop']])
    // Cmd+D on a Mac, released via the modifier: a tap this time.
    fireEvent.keyDown(textarea, { key: 'D', metaKey: true })
    fireEvent.keyUp(textarea, { key: 'Meta' })
    expect(vi.mocked(props.onDictation).mock.calls).toEqual([['start'], ['stop'], ['start']])
    // Alt+D and plain d are typing.
    expect(fireEvent.keyDown(textarea, { key: 'd', ctrlKey: true, altKey: true })).toBe(true)
    expect(fireEvent.keyDown(textarea, { key: 'd' })).toBe(true)
  })

  it('Space or Enter on the focused button presses and releases it', () => {
    const { props } = renderComposer()
    expect(fireEvent.keyDown(mic(), { key: ' ' })).toBe(false)
    fireEvent.keyDown(mic(), { key: ' ', repeat: true })
    clock.now += DICTATION_HOLD_MS
    fireEvent.keyUp(mic(), { key: ' ' })
    expect(vi.mocked(props.onDictation).mock.calls).toEqual([['start'], ['stop']])
    expect(fireEvent.keyDown(mic(), { key: 'Tab' })).toBe(true)
    fireEvent.keyUp(mic(), { key: 'Tab' })
    expect(props.onDictation).toHaveBeenCalledTimes(2)
  })
})

describe('Composer reference chip (M17)', () => {
  it('shows what the next message replies to or quotes, and its × drops it', () => {
    const onDismissReference = vi.fn()
    renderComposer({ referenceLabel: 'Replying to: Use pnpm.', onDismissReference })
    const chip = screen.getByText('Replying to: Use pnpm.').closest('.reference-chip')
    expect(chip).toHaveAttribute('title', 'Goes to the agent with your message as context')
    fireEvent.click(screen.getByLabelText('Remove: Replying to: Use pnpm.'))
    expect(onDismissReference).toHaveBeenCalledOnce()
  })
})

/** The "/" list's command names, in order. */
function slashNames(): readonly (string | undefined)[] {
  const list = screen.getByRole('listbox', { name: 'Slash commands' })
  return within(list)
    .getAllByRole('option')
    .map((option) => option.querySelector('.palette-item-label')?.textContent)
}

// M38: "/" alone shows the palette; a character more, the slash commands.
describe('Composer "/" menus (M38)', () => {
  it('announces loading without exposing stale commands or dangling listbox references', () => {
    const { props, view, textarea } = renderComposer({ slashLoadState: 'loading' })
    textarea.focus()
    const typed = type(view, props, '/co')
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(typed).not.toHaveAttribute('aria-controls')
    expect(typed).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(typed, { key: 'Tab' })
    expect(props.onSlashCommand).not.toHaveBeenCalled()
    view.rerender(<Composer {...props} draft="/co" slashLoadState="ready" />)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(slashNames()).toContain('/compact')
  })
  it('announces a failed registry load and retries after saving the draft', () => {
    const save = vi.fn()
    const rebuild = vi.fn()
    installSurfaceRetry(save, rebuild)
    try {
      const { props, view, textarea } = renderComposer({ slashLoadState: 'failed' })
      textarea.focus()
      type(view, props, '/co')
      expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
      expect(save).toHaveBeenCalledOnce()
      expect(rebuild).toHaveBeenCalledOnce()
      expect(props.onSubmit).not.toHaveBeenCalled()
      expect(props.onSlashCommand).not.toHaveBeenCalled()
    } finally {
      installSurfaceRetry(vi.fn(), vi.fn())
    }
  })

  it('types the "/" and shows the palette above the box while the prompt is just "/"', () => {
    const seen: string[] = []
    const { props, view, textarea } = renderComposer({ renderSlashPalette: slashPalette(seen) })
    textarea.focus()
    expect(fireEvent.keyDown(textarea, { key: '/' })).toBe(true)
    expect(props.onOpenPalette).not.toHaveBeenCalled()
    const typed = type(view, props, '/')
    expect(screen.getByRole('dialog', { name: 'Actions' })).toBeInTheDocument()
    expect(props.onSlashMenuOpen).toHaveBeenCalledOnce()
    expect(typed).toHaveAttribute('aria-controls', 'palette-listbox')
    // The box keeps the focus and hands the palette its keys.
    expect(fireEvent.keyDown(typed, { key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(typed, { key: 'Enter' })).toBe(false)
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(typed, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(typed, { key: 'b' })).toBe(true)
    expect(seen).toEqual(['ArrowDown', 'Enter'])
    // Escape closes it and keeps the text; the box has the focus.
    fireEvent.keyDown(typed, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(props.onDraftChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(typed)
  })

  it('turns into the command list once a character follows, ranked as the name is typed', () => {
    const { props, view, textarea } = renderComposer()
    textarea.focus()
    const typed = type(view, props, '/co')
    expect(screen.queryByRole('dialog')).toBeNull()
    // Name matches first; "Clear conversation" holds "co" in its description.
    expect(slashNames()).toEqual(['/code-review', '/compact', '/clear'])
    expect(typed).toHaveAttribute('aria-controls', 'slash-listbox')
    expect(typed).toHaveAttribute('aria-activedescendant', 'slash-option-0')
    type(view, props, '/com')
    expect(slashNames()).toEqual(['/compact'])
    type(view, props, '/cl')
    expect(slashNames()).toEqual(['/clear'])
  })

  it('runs a command with Enter, completes a skill for its arguments, and completes a name with Tab', () => {
    const { props, view, textarea } = renderComposer()
    textarea.focus()
    const typed = type(view, props, '/co')
    // Enter on a skill completes it; nothing runs and nothing is sent.
    expect(fireEvent.keyDown(typed, { key: 'Enter' })).toBe(false)
    expect(props.onDraftChange).toHaveBeenLastCalledWith('/code-review ')
    expect(props.onSlashCommand).not.toHaveBeenCalled()
    // Down to /compact: Tab completes the name, Enter runs it.
    fireEvent.keyDown(typed, { key: 'ArrowDown' })
    expect(typed).toHaveAttribute('aria-activedescendant', 'slash-option-1')
    expect(fireEvent.keyDown(typed, { key: 'Tab' })).toBe(false)
    expect(props.onDraftChange).toHaveBeenLastCalledWith('/compact')
    fireEvent.keyDown(typed, { key: 'Enter' })
    expect(props.onSlashCommand).toHaveBeenCalledWith(slashCommands[0])
    // Up wraps to the last row; a click runs it.
    fireEvent.keyDown(typed, { key: 'ArrowUp' })
    fireEvent.keyDown(typed, { key: 'ArrowUp' })
    expect(typed).toHaveAttribute('aria-activedescendant', 'slash-option-2')
    const clear = screen.getByRole('option', { name: /clear/ })
    expect(fireEvent.mouseDown(clear)).toBe(false)
    fireEvent.click(clear)
    expect(props.onSlashCommand).toHaveBeenLastCalledWith(slashCommands[1])
    expect(props.onSubmit).not.toHaveBeenCalled()
    // Shift+Tab still cycles the permission mode.
    fireEvent.keyDown(typed, { key: 'Tab', shiftKey: true })
    expect(props.onCyclePermissionMode).toHaveBeenCalledOnce()
  })

  // The list outgrows its height (M70 added /review): the box keeps the
  // focus, so the active command is scrolled into view (WCAG 2.1.1).
  it('scrolls the active command into view as the arrows move, and only then', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      const { props, view, textarea } = renderComposer()
      textarea.focus()
      const typed = type(view, props, '/co')
      expect(scroll.mock.contexts.at(-1)).toBe(screen.getAllByRole('option')[0])
      // Up wraps to the last row, the one a full list hides first.
      fireEvent.keyDown(typed, { key: 'ArrowUp' })
      expect(typed).toHaveAttribute('aria-activedescendant', 'slash-option-2')
      expect(scroll.mock.contexts.at(-1)).toBe(screen.getAllByRole('option')[2])
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
      // A render with the same rows leaves a list the user scrolled alone.
      const calls = scroll.mock.calls.length
      type(view, props, '/co')
      expect(scroll).toHaveBeenCalledTimes(calls)
    } finally {
      scroll.mockRestore()
    }
  })

  it('leaves `/handoff ` in the prompt for its goal (M74)', () => {
    const commands: readonly SlashCommand[] = [
      { name: 'handoff', detail: 'Distil this conversation', action: { type: 'startHandoff' } },
    ]
    const { props, view, textarea } = renderComposer({ slashCommands: commands })
    textarea.focus()
    const typed = type(view, props, '/han')
    expect(slashNames()).toEqual(['/handoff'])
    // Enter and Tab both ready the command for its goal; nothing runs.
    expect(fireEvent.keyDown(typed, { key: 'Enter' })).toBe(false)
    expect(props.onDraftChange).toHaveBeenLastCalledWith('/handoff ')
    expect(props.onSlashCommand).not.toHaveBeenCalled()
    type(view, props, '/han')
    expect(fireEvent.keyDown(typed, { key: 'Tab' })).toBe(false)
    expect(props.onDraftChange).toHaveBeenLastCalledWith('/handoff ')
    expect(props.onSlashCommand).not.toHaveBeenCalled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('closes on Escape keeping the text, and with no match Enter sends the text', () => {
    const { props, view, textarea } = renderComposer()
    textarea.focus()
    let typed = type(view, props, '/co')
    fireEvent.keyDown(typed, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(props.onDraftChange).not.toHaveBeenCalled()
    fireEvent.keyDown(typed, { key: 'Enter' })
    expect(props.onSubmit).toHaveBeenCalledOnce()
    // Typing on brings it back.
    type(view, props, '/com')
    expect(slashNames()).toEqual(['/compact'])
    // A dismissal holds for its draft only: the same "/com" later opens again.
    fireEvent.keyDown(typed, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    type(view, props, '')
    type(view, props, '/com')
    expect(slashNames()).toEqual(['/compact'])
    typed = type(view, props, '/zzz')
    expect(
      screen.getByText('No matching commands; Enter sends the text as it is'),
    ).toBeInTheDocument()
    expect(typed).not.toHaveAttribute('aria-controls')
    expect(typed).not.toHaveAttribute('aria-activedescendant')
    expect(fireEvent.keyDown(typed, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(typed, { key: 'Enter' })
    expect(props.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('stays closed without the focus, under another menu, with the caret inside, or with text after the name', () => {
    const { props, view, textarea } = renderComposer()
    type(view, props, '/co')
    expect(screen.queryByRole('listbox')).toBeNull()
    textarea.focus()
    type(view, props, '/co', { isMenuOpen: true })
    expect(screen.queryByRole('listbox')).toBeNull()
    const typed = type(view, props, '/co')
    typed.setSelectionRange(1, 1)
    fireEvent.keyUp(typed, { key: 'ArrowLeft' })
    expect(screen.queryByRole('listbox')).toBeNull()
    type(view, props, '/compact now')
    expect(screen.queryByRole('listbox')).toBeNull()
    type(view, props, '/co')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.blur(typed, { relatedTarget: document.body })
    expect(screen.queryByRole('listbox')).toBeNull()
    // Each opening says so (the list opened twice above); App asks for the
    // skills only while it has none.
    expect(props.onSlashMenuOpen).toHaveBeenCalledTimes(2)
  })
})

describe('Composer: the paid badge (M33, PLAN.md D30)', () => {
  it('names the paid features that are on, prices them in its tooltip, and opens the tally', () => {
    const { props } = renderComposer({
      paidBadge: { label: 'Paid: Web search', title: 'Billed to your Model API key: …' },
    })
    const badge = screen.getByRole('button', { name: 'Paid: Web search' })
    expect(badge).toHaveAttribute('title', 'Billed to your Model API key: …')
    fireEvent.click(badge)
    expect(props.onOpenUsage).toHaveBeenCalledTimes(1)
  })

  it('shows no badge while no paid feature is on', () => {
    renderComposer()
    expect(screen.queryByRole('button', { name: /^Paid:/ })).toBeNull()
  })
})

describe('Composer: the microphone on Muse Voice (M35, PLAN.md D30)', () => {
  it('names the paid engine and its price, and marks the button', () => {
    renderComposer({ dictation: { status: 'idle', reason: undefined, engine: 'museVoice' } })
    const button = screen.getByRole('button', { name: 'Record voice with Muse Voice (paid)' })
    expect(button).toHaveAttribute(
      'title',
      'Muse Voice, paid: $0.18 per hour of audio, billed to your Model API key. Tap or hold to record (Ctrl+D)',
    )
    expect(button).toHaveClass('mic-paid')
  })

  it('keeps the free engine’s name and look', () => {
    renderComposer()
    const button = screen.getByRole('button', { name: 'Record voice' })
    expect(button).not.toHaveClass('mic-paid')
  })
})
