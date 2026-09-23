// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DICTATION_HOLD_MS } from '../../src/shared/constants'
import { Composer, type ComposerProps } from '../../src/webview/components/Composer'
import { testSettings } from './helpers/fakes'

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
    focusRequests: 0,
    pendingInsert: undefined,
    attachments: [],
    mentionResults: undefined,
    editorContextLabel: undefined,
    dictation: { status: 'idle', reason: undefined },
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
    onDroppedUris: vi.fn(),
    onCompact: vi.fn(),
    banner: undefined,
    onDismissBanner: vi.fn(),
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

  it('opens the palette on "/" only when the draft is empty', () => {
    const { props, view, textarea } = renderComposer()
    expect(fireEvent.keyDown(textarea, { key: '/' })).toBe(false)
    expect(props.onOpenPalette).toHaveBeenCalledOnce()
    const typed = type(view, props, 'a')
    expect(fireEvent.keyDown(typed, { key: '/' })).toBe(true)
    expect(props.onOpenPalette).toHaveBeenCalledOnce()
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
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported file type: audio.node')
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(props.onDismissBanner).toHaveBeenCalledTimes(1)
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
    const { props } = renderComposer({ dictation: { status: 'listening', reason: undefined } })
    expect(mic()).toHaveAttribute('aria-pressed', 'true')
    expect(mic()).toHaveAttribute('title', 'Stop recording (Ctrl+D)')
    expect(screen.getByLabelText('Message Muse')).toHaveAttribute('placeholder', 'Listening…')
    fireEvent.pointerDown(mic())
    clock.now += DICTATION_HOLD_MS
    fireEvent.pointerUp(window)
    expect(vi.mocked(props.onDictation).mock.calls).toEqual([['stop']])
  })

  it('shows the starting placeholder and stops from that state too', () => {
    const { props } = renderComposer({ dictation: { status: 'starting', reason: undefined } })
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
      dictation: { status: 'unavailable', reason: 'No recogniser on Linux.' },
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
