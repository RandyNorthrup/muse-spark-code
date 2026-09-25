// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DICTATION_HOLD_MS,
  MAX_ATTACHMENTS_PER_MESSAGE,
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
import { testSettings } from './helpers/fakes'

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
    return <div role="dialog" aria-label="Actions" />
  }
}

/** The composer's clock (the tap/hold threshold reads it). */
const clock = { now: 1_000_000 }

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  clock.now = 1_000_000
  const props: ComposerProps = {
    draft: '',
    placeholder: 'type here',
    settings: testSettings,
    canSend: true,
    isRunning: false,
    modelLabel: 'muse-spark-1.3 High',
    permissionMode: 'manual',
    contextLabel: undefined,
    contextTitle: undefined,
    paidBadge: undefined,
    onOpenUsage: vi.fn(),
    focusRequests: 0,
    pendingInsert: undefined,
    attachments: [],
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

  it('ignores stale results and shows the empty state for no matches', () => {
    const { props, view } = renderComposer()
    type(view, props, '@zz')
    const textarea = type(view, props, '@zz', { mentionResults: withResults(['old'], 99) })
    expect(screen.getByText('No matching files')).toBeInTheDocument()
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
    })
    expect(props.onDroppedUris).toHaveBeenCalledWith(['file:///ws/src/a.ts'])
  })

  it('compacts from the context indicator and shows a dismissible banner (M14)', () => {
    const { props } = renderComposer({
      contextLabel: '12% context',
      contextTitle: '120K of 1M tokens · pressure normal · Click to compact now',
      banner: 'Unsupported file type: audio.node. Supported as uploads: images.',
    })
    fireEvent.click(screen.getByRole('button', { name: '12% context' }))
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
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(props.onStop).toHaveBeenCalledOnce()
  })

  it('shows the context indicator only when known', () => {
    const { view, props } = renderComposer()
    expect(screen.queryByTitle(/tokens/)).toBeNull()
    view.rerender(
      <Composer {...props} contextLabel="12% context" contextTitle="120K of 1M tokens (normal)" />,
    )
    expect(screen.getByTitle('120K of 1M tokens (normal)')).toHaveTextContent('12% context')
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
