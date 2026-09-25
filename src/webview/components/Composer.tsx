// The prompt box: textarea with Claude-Code key semantics (Enter sends,
// Shift+Enter newline, optional Ctrl/Cmd+Enter-to-send, Shift+Tab cycles the
// permission mode, "@" opens the mention menu), attachment chips, paste/drop of images and editor files,
// the attach ("+") and slash buttons, the model pill, the permission-mode
// button and Send/Stop. The "+" button and the mode button open menus the
// parent renders above the composer. Keys an input method is composing with
// (CJK) belong to the composition: Enter commits the candidate, it never
// sends or picks a mention (M25). An image over the host's limits is refused
// before it is read, not encoded and posted to be refused (M25).
//
// "/" (M38): a prompt that is just `/` shows the palette above the box; one
// character more turns it into the slash-command list, narrowed as the name
// is typed. The box keeps the focus and the keys throughout: Up and Down
// move, Enter runs (a skill is completed for its arguments), Tab completes
// the name, Escape closes the list and keeps the text.

import {
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  COMPOSER_MAX_ROWS,
  DICTATION_KEY,
  type DictationAction,
  IME_PROCESS_KEY,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  PERMISSION_MODE_LABELS,
  type PermissionMode,
  UI_TEXT,
} from '../../shared/constants'
import {
  applyMention,
  type MentionQuery,
  mentionQueryAt,
  slashFilterOf,
} from '../../shared/mentions'
import type { AttachmentSummary, MentionItem, SettingsSnapshot } from '../../shared/protocol'
import { rankSlashCommands, type SlashCommand } from '../../shared/slashCommands'
import { blobToBase64, parseUriList } from '../base64'
import { type DictationPress, pressAction, releaseAction } from '../dictationGesture'
import { wrapIndex } from '../listNavigation'
import type { DictationUiState, MentionResults } from '../state/uiState'
import { AttachmentChips } from './AttachmentChips'
import {
  CloseIcon,
  FileIcon,
  MicIcon,
  PlusIcon,
  ReplyIcon,
  SendIcon,
  SlashIcon,
  StopIcon,
} from './icons'
import { MentionMenu, mentionOptionId } from './MentionMenu'
import { modeIcon } from './modeIcons'
import { PALETTE_LISTBOX_ID, type PaletteKeys } from './Palette'
import { SLASH_LISTBOX_ID, SlashMenu, slashOptionId } from './SlashMenu'

export interface ImageData {
  readonly name: string
  readonly mediaType: string
  readonly base64: string
}

/** What the composer hands the attached palette it asks the parent to render (M38). */
export interface SlashPaletteSlot {
  readonly onClose: () => void
  readonly onActiveRowChange: (elementId: string | undefined) => void
}

export interface ComposerProps {
  readonly draft: string
  readonly placeholder: string
  readonly settings: SettingsSnapshot
  readonly canSend: boolean
  readonly isRunning: boolean
  readonly modelLabel: string
  readonly permissionMode: PermissionMode
  /** "12% context" once known; undefined hides the indicator. */
  readonly contextLabel: string | undefined
  readonly contextTitle: string | undefined
  readonly focusRequests: number
  readonly pendingInsert: string | undefined
  readonly attachments: readonly AttachmentSummary[]
  readonly mentionResults: MentionResults | undefined
  /** The open-file chip ("PLAN.md L5-10"); undefined hides it (M5). */
  readonly editorContextLabel: string | undefined
  /** "Replying to: …" / "Asking about: …" (M17); undefined hides the chip. */
  readonly referenceLabel: string | undefined
  readonly onDismissReference: () => void
  /** The microphone button (M9). */
  readonly dictation: DictationUiState
  readonly now: () => number
  readonly onDictation: (action: DictationAction) => void
  readonly onDismissEditorContext: () => void
  readonly onDraftChange: (draft: string) => void
  readonly onInsertApplied: () => void
  readonly onSubmit: () => void
  readonly onStop: () => void
  readonly onFocusChange: (isFocused: boolean) => void
  readonly onOpenPalette: () => void
  readonly onOpenModelPicker: () => void
  /** Shift+Tab. */
  readonly onCyclePermissionMode: () => void
  /** The mode button: the Modes menu. */
  readonly onOpenModeMenu: () => void
  /** The "+" button: the attach menu. */
  readonly onOpenAttachMenu: () => void
  readonly onRemoveAttachment: (id: string) => void
  readonly onSearchMentions: (requestId: number, query: string) => void
  readonly onAttachImage: (image: ImageData) => void
  /** An image refused before it was read (too large, or one too many), M25. */
  readonly onRefuseFile: (name: string, reason: string) => void
  readonly onDroppedUris: (uris: readonly string[]) => void
  /** The context indicator is a button: compact now (M14). */
  readonly onCompact: () => void
  /** The banner above the box (M14): an unsupported upload, until dismissed. */
  readonly banner: string | undefined
  readonly onDismissBanner: () => void
  /** The prompt's "/" list (M38): the palette's slash commands and skills. */
  readonly slashCommands: readonly SlashCommand[]
  /** Another menu or dialog is open: the "/" menus stay closed. */
  readonly isMenuOpen: boolean
  /** The palette, attached above the box, for a prompt that is just `/`. */
  readonly renderSlashPalette: (slot: SlashPaletteSlot) => ReactNode
  /** That palette's keyboard: the box hands it its keys while it shows. */
  readonly slashPaletteKeys: RefObject<PaletteKeys | null>
  /** A command chosen from the "/" list; the parent clears the `/` and runs it. */
  readonly onSlashCommand: (command: SlashCommand) => void
  /** A "/" menu has opened (the parent loads the skills). */
  readonly onSlashMenuOpen: () => void
}

const MIN_ROWS = 1
const URI_LIST_TYPE = 'text/uri-list'
const IMAGE_TYPE_PREFIX = 'image/'
const PASTED_IMAGE_NAME = 'pasted-image'

/** How the box was measured: its content height and the height of one row. */
export interface RowMetrics {
  readonly scrollHeight: number
  readonly rowHeight: number
}

/**
 * Rows the box needs: the wrapped content's height in rows when the box is
 * measurable (a browser), else the newline count (jsdom reports 0 for both).
 * Never below one row, never above COMPOSER_MAX_ROWS: past that the textarea
 * scrolls inside (issue #4).
 */
export function rowsFor(draft: string, metrics?: RowMetrics): number {
  const isMeasured = metrics !== undefined && metrics.rowHeight > 0
  const measured = isMeasured ? Math.round(metrics.scrollHeight / metrics.rowHeight) : 0
  const lines = Math.max(measured, draft.split('\n').length)
  return Math.min(Math.max(lines, MIN_ROWS), COMPOSER_MAX_ROWS)
}

/**
 * Sizes the box to its draft. One row first, so a draft that shrank is
 * measured against its own height rather than the taller box it is leaving.
 */
function fitRows(textarea: HTMLTextAreaElement, draft: string): void {
  textarea.rows = MIN_ROWS
  textarea.rows = rowsFor(draft, {
    scrollHeight: textarea.scrollHeight,
    rowHeight: textarea.clientHeight,
  })
}

/**
 * Whether the key belongs to an input method's composition (M25): Chromium
 * flags it `isComposing` and names the key "Process" (keyCode 229).
 */
function isComposing(event: KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing || event.key === IME_PROCESS_KEY
}

/** Whether this keydown is the configured "send" gesture. */
export function isSendKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  isCtrlEnterMode: boolean,
): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) {
    return false
  }
  const hasModifier = event.ctrlKey || event.metaKey
  return isCtrlEnterMode ? hasModifier : !hasModifier
}

/**
 * A mousedown on a toggle button would blur the open palette or menu (which
 * closes it) before the click could toggle; keeping focus where it is lets the
 * click decide.
 */
function keepMenuFocus(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault()
}

function imageFiles(list: FileList | undefined): readonly File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith(IMAGE_TYPE_PREFIX))
}

/** Ctrl+D (Cmd+D on a Mac): the microphone from the keyboard. */
function isDictationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === DICTATION_KEY
  )
}

/** The keys whose release ends a Ctrl+D hold: the letter or the modifier. */
function isDictationRelease(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    event.key.toLowerCase() === DICTATION_KEY || event.key === 'Control' || event.key === 'Meta'
  )
}

const ACTIVATION_KEYS: ReadonlySet<string> = new Set([' ', 'Enter'])

function dictationTitle(dictation: DictationUiState): string {
  switch (dictation.status) {
    case 'unavailable': {
      return dictation.reason ?? UI_TEXT.dictationUnavailable
    }
    case 'idle': {
      return UI_TEXT.dictationTitle
    }
    case 'starting':
    case 'listening': {
      return UI_TEXT.dictationStopTitle
    }
  }
}

function dictationPlaceholder(dictation: DictationUiState): string | undefined {
  switch (dictation.status) {
    case 'starting': {
      return UI_TEXT.dictationStarting
    }
    case 'listening': {
      return UI_TEXT.dictationListening
    }
    default: {
      return undefined
    }
  }
}

/** What a prompt that is one `/token` shows (M38): the palette for `/` alone, the list after. */
function slashMenuOf(draft: string, caret: number): 'palette' | 'commands' | undefined {
  const query = slashFilterOf(draft)
  if (query === undefined || caret !== draft.length) {
    return undefined
  }
  return query === '' ? 'palette' : 'commands'
}

export function Composer(props: ComposerProps) {
  const {
    draft,
    placeholder,
    settings,
    canSend,
    isRunning,
    modelLabel,
    permissionMode,
    contextLabel,
    contextTitle,
    focusRequests,
    pendingInsert,
    attachments,
    mentionResults,
    editorContextLabel,
    referenceLabel,
    onDismissReference,
    dictation,
    now,
    onDictation,
    onDismissEditorContext,
    onDraftChange,
    onInsertApplied,
    onSubmit,
    onStop,
    onFocusChange,
    onOpenPalette,
    onOpenModelPicker,
    onCyclePermissionMode,
    onOpenModeMenu,
    onOpenAttachMenu,
    onRemoveAttachment,
    onSearchMentions,
    onAttachImage,
    onRefuseFile,
    onDroppedUris,
    onCompact,
    banner,
    onDismissBanner,
    slashCommands,
    isMenuOpen,
    renderSlashPalette,
    slashPaletteKeys,
    onSlashCommand,
    onSlashMenuOpen,
  } = props
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [dismissedMention, setDismissedMention] = useState<number | undefined>(undefined)
  const requestCounter = useRef(0)
  const [activeRequest, setActiveRequest] = useState<number | undefined>(undefined)
  // The "/" menus (M38): open while the focus is in the composer, closed for
  // the draft they were dismissed at.
  const [isFocusWithin, setIsFocusWithin] = useState(false)
  const [dismissedSlash, setDismissedSlash] = useState<string | undefined>(undefined)
  const [slashIndex, setSlashIndex] = useState(0)
  const [paletteRowId, setPaletteRowId] = useState<string | undefined>(undefined)
  // The microphone press in progress (pointer, Space/Enter or Ctrl+D), so
  // its release can tell a tap from a hold.
  const dictationPress = useRef<DictationPress | undefined>(undefined)

  const pressDictation = () => {
    const action = pressAction(dictation.status)
    if (action === undefined) {
      return
    }
    dictationPress.current = { at: now(), action }
    onDictation(action)
  }
  const releaseDictation = () => {
    const action = releaseAction(dictationPress.current, now())
    dictationPress.current = undefined
    if (action !== undefined) {
      onDictation(action)
    }
  }
  const pressDictationWithPointer = (event: PointerEvent<HTMLButtonElement>) => {
    // Keep the caret in the textarea: dictated text lands there, and Ctrl+D
    // keeps working. (jsdom's generic event has no button; that reads as 0.)
    event.preventDefault()
    if (event.button > 0) {
      return
    }
    pressDictation()
  }
  // A held button is released wherever the pointer went.
  useEffect(() => {
    const onPointerUp = () => {
      releaseDictation()
    }
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
    }
  })

  const mention: MentionQuery | undefined = mentionQueryAt(draft, caret)
  const isMentionOpen = mention !== undefined && dismissedMention !== mention.start
  const mentionItems: readonly MentionItem[] =
    isMentionOpen && mentionResults !== undefined && mentionResults.requestId === activeRequest
      ? mentionResults.items
      : []
  // A dismissal holds for the draft it was made at, not for a later `/`: once
  // the draft moves on it is forgotten (adjusted while rendering, as React
  // documents for state derived from a prop).
  if (dismissedSlash !== undefined && dismissedSlash !== draft) {
    setDismissedSlash(undefined)
  }
  const slashMenu =
    isFocusWithin && !isMenuOpen && dismissedSlash !== draft ? slashMenuOf(draft, caret) : undefined
  const slashItems =
    slashMenu === 'commands' ? rankSlashCommands(slashCommands, draft.slice(1)) : []
  const activeSlash = slashIndex < slashItems.length ? slashIndex : 0
  const isSlashMenuOpen = slashMenu !== undefined
  // Escape in the palette's own list (a Tab stop) brings the focus back to
  // the box, where it always is otherwise.
  useEffect(() => {
    if (dismissedSlash !== undefined) {
      textareaRef.current?.focus()
    }
  }, [dismissedSlash])
  useEffect(() => {
    if (isSlashMenuOpen) {
      onSlashMenuOpen()
    }
  }, [isSlashMenuOpen, onSlashMenuOpen])

  useEffect(() => {
    if (focusRequests === 0) {
      return
    }
    textareaRef.current?.focus()
  }, [focusRequests])

  // The box grows with its wrapped content and shrinks back (issue #4),
  // measured before paint so a keystroke never shows a one-row box first.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) {
      return
    }
    fitRows(textarea, draft)
  }, [draft])

  // A resized sidebar rewraps the same draft: fit again when the width moves.
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null || typeof ResizeObserver === 'undefined') {
      return
    }
    let width = textarea.clientWidth
    let frame: number | undefined
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) {
        return
      }
      width = textarea.clientWidth
      // Refit on the next frame: resizing the observed box inside its own
      // callback is a ResizeObserver loop, which the browser reports as an
      // error, and the panel logs every error it sees (M39).
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
      }
      frame = requestAnimationFrame(() => {
        frame = undefined
        fitRows(textarea, textarea.value)
      })
    })
    observer.observe(textarea)
    return () => {
      observer.disconnect()
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
      }
    }
  }, [])

  useEffect(() => {
    if (pendingInsert === undefined) {
      return
    }
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? draft.length
    const end = textarea?.selectionEnd ?? draft.length
    onDraftChange(draft.slice(0, start) + pendingInsert + draft.slice(end))
    onInsertApplied()
    if (textarea === null) {
      return
    }
    const next = start + pendingInsert.length
    // Runs after React commits the new value.
    queueMicrotask(() => {
      textarea.setSelectionRange(next, next)
      setCaret(next)
    })
  }, [pendingInsert, draft, onDraftChange, onInsertApplied])

  // Ask the host for matches whenever the mention token changes.
  const mentionQuery = isMentionOpen ? mention.query : undefined
  useEffect(() => {
    if (mentionQuery === undefined) {
      return
    }
    requestCounter.current += 1
    const requestId = requestCounter.current
    setActiveRequest(requestId)
    setMentionIndex(0)
    onSearchMentions(requestId, mentionQuery)
  }, [mentionQuery, onSearchMentions])

  const syncCaret = () => {
    setCaret(textareaRef.current?.selectionStart ?? 0)
  }

  const selectMention = (item: MentionItem) => {
    if (mention === undefined) {
      return
    }
    const applied = applyMention(draft, mention, item.path)
    onDraftChange(applied.text)
    const textarea = textareaRef.current
    queueMicrotask(() => {
      textarea?.setSelectionRange(applied.caret, applied.caret)
      setCaret(applied.caret)
    })
  }

  const didHandleMentionKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!isMentionOpen) {
      return false
    }
    switch (event.key) {
      case 'ArrowDown': {
        if (mentionItems.length > 0) {
          setMentionIndex((mentionIndex + 1) % mentionItems.length)
        }
        return true
      }
      case 'ArrowUp': {
        if (mentionItems.length > 0) {
          setMentionIndex((mentionIndex - 1 + mentionItems.length) % mentionItems.length)
        }
        return true
      }
      case 'Enter':
      case 'Tab': {
        const item = mentionItems[mentionIndex]
        if (item === undefined) {
          return false
        }
        selectMention(item)
        return true
      }
      case 'Escape': {
        setDismissedMention(mention.start)
        return true
      }
      default: {
        return false
      }
    }
  }

  /** The draft set to `text`, the caret at its end. */
  const replaceDraft = (text: string) => {
    onDraftChange(text)
    const textarea = textareaRef.current
    queueMicrotask(() => {
      textarea?.setSelectionRange(text.length, text.length)
      setCaret(text.length)
    })
  }

  const dismissSlash = () => {
    setDismissedSlash(draft)
  }

  /** Enter runs a command; a skill, or Tab, completes the name instead. */
  const chooseSlash = (command: SlashCommand, isCompleting: boolean) => {
    const { action } = command
    if (action.type === 'insertSkill') {
      replaceDraft(`/${action.selector} `)
    } else if (isCompleting) {
      replaceDraft(`/${command.name}`)
    } else {
      onSlashCommand(command)
    }
  }

  const didHandleSlashKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    // Shift+Enter is still a new line, and Shift+Tab still cycles the mode.
    const isShifted = event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')
    if (slashMenu === undefined || isShifted) {
      return false
    }
    if (slashMenu === 'palette') {
      return slashPaletteKeys.current?.didHandleKey(event) === true
    }
    const active = slashItems[activeSlash]
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setSlashIndex(wrapIndex(activeSlash, delta, slashItems.length))
        break
      }
      case 'Enter':
      case 'Tab': {
        if (active === undefined) {
          return false
        }
        chooseSlash(active, event.key === 'Tab')
        break
      }
      case 'Escape': {
        dismissSlash()
        break
      }
      default: {
        return false
      }
    }
    event.preventDefault()
    return true
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposing(event)) {
      return
    }
    if (didHandleMentionKey(event)) {
      event.preventDefault()
      return
    }
    if (didHandleSlashKey(event)) {
      return
    }
    if (isDictationKey(event)) {
      event.preventDefault()
      if (!event.repeat) {
        pressDictation()
      }
      return
    }
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      onCyclePermissionMode()
      return
    }
    if (!isSendKey(event, settings.useCtrlEnterToSend)) {
      return
    }
    event.preventDefault()
    if (canSend) {
      onSubmit()
    }
  }

  const handleKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    syncCaret()
    if (isDictationRelease(event)) {
      releaseDictation()
    }
  }

  const handleMicKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!ACTIVATION_KEYS.has(event.key)) {
      return
    }
    // Space/Enter would also click; the press/release pair replaces it.
    event.preventDefault()
    if (!event.repeat) {
      pressDictation()
    }
  }

  const handleMicKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (ACTIVATION_KEYS.has(event.key)) {
      releaseDictation()
    }
  }

  function popupAria(): {
    readonly controls: string | undefined
    readonly activeDescendant: string | undefined
  } {
    if (isMentionOpen) {
      const active = mentionItems.length > 0 ? mentionOptionId(mentionIndex) : undefined
      return { controls: 'mention-listbox', activeDescendant: active }
    }
    if (slashMenu === 'palette') {
      return { controls: PALETTE_LISTBOX_ID, activeDescendant: paletteRowId }
    }
    if (slashMenu === 'commands') {
      const active = slashItems.length > 0 ? slashOptionId(activeSlash) : undefined
      return { controls: SLASH_LISTBOX_ID, activeDescendant: active }
    }
    return { controls: undefined, activeDescendant: undefined }
  }

  const attachFiles = (files: readonly File[]) => {
    let count = attachments.length
    for (const file of files) {
      const name = file.name === '' ? PASTED_IMAGE_NAME : file.name
      if (file.size > MAX_IMAGE_BYTES) {
        onRefuseFile(name, UI_TEXT.attachmentTooLarge)
        continue
      }
      if (count >= MAX_ATTACHMENTS_PER_MESSAGE) {
        onRefuseFile(name, UI_TEXT.attachmentLimit)
        continue
      }
      count += 1
      void blobToBase64(file)
        .then((base64) => {
          onAttachImage({ name, mediaType: file.type, base64 })
        })
        .catch((error: unknown) => {
          onRefuseFile(name, UI_TEXT.attachmentUnreadable)
          // Unhandled on purpose: the page reports it to the log (M39).
          throw error
        })
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = imageFiles(event.clipboardData.files)
    if (images.length === 0) {
      return
    }
    event.preventDefault()
    attachFiles(images)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    attachFiles(imageFiles(event.dataTransfer.files))
    const uris = parseUriList(event.dataTransfer.getData(URI_LIST_TYPE))
    if (uris.length > 0) {
      onDroppedUris(uris)
    }
  }

  // What the box's aria-controls and aria-activedescendant point at.
  const popup = popupAria()

  return (
    <footer
      className="composer"
      onFocus={() => {
        setIsFocusWithin(true)
      }}
      onBlur={(event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsFocusWithin(false)
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={handleDrop}
    >
      {banner === undefined ? null : (
        <div className="composer-banner">
          <span>{banner}</span>
          <button
            type="button"
            className="icon-button"
            title={UI_TEXT.bannerDismiss}
            aria-label={UI_TEXT.bannerDismiss}
            onClick={onDismissBanner}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      {slashMenu === 'palette'
        ? renderSlashPalette({
            onClose: dismissSlash,
            onActiveRowChange: setPaletteRowId,
          })
        : null}
      {slashMenu === 'commands' ? (
        <SlashMenu
          items={slashItems}
          activeIndex={activeSlash}
          onSelect={(command) => {
            chooseSlash(command, false)
          }}
          onHover={setSlashIndex}
        />
      ) : null}
      {isMentionOpen ? (
        <MentionMenu
          items={mentionItems}
          activeIndex={mentionIndex}
          onSelect={selectMention}
          onHover={setMentionIndex}
        />
      ) : null}
      <AttachmentChips attachments={attachments} onRemove={onRemoveAttachment} />
      <textarea
        ref={textareaRef}
        className="composer-input"
        dir="auto"
        aria-label={UI_TEXT.composerLabel}
        aria-autocomplete="list"
        aria-controls={popup.controls}
        aria-activedescendant={popup.activeDescendant}
        placeholder={
          dictationPlaceholder(dictation) ??
          (isRunning ? UI_TEXT.composerQueuePlaceholder : placeholder)
        }
        value={draft}
        onChange={(event) => {
          onDraftChange(event.target.value)
          setCaret(event.target.selectionStart)
          setSlashIndex(0)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={syncCaret}
        onPaste={handlePaste}
        onFocus={() => {
          onFocusChange(true)
        }}
        onBlur={() => {
          onFocusChange(false)
        }}
      />
      <div className="composer-toolbar">
        <div className="composer-toolbar-group">
          <button
            type="button"
            className="icon-button"
            title={UI_TEXT.attachTitle}
            aria-label={UI_TEXT.attachTitle}
            onMouseDown={keepMenuFocus}
            onClick={onOpenAttachMenu}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            title={UI_TEXT.commandsTitle}
            aria-label={UI_TEXT.commandsTitle}
            onMouseDown={keepMenuFocus}
            onClick={onOpenPalette}
          >
            <SlashIcon />
          </button>
          <button
            type="button"
            className="pill"
            title={UI_TEXT.modelPillTitle}
            aria-label="Model"
            onMouseDown={keepMenuFocus}
            onClick={onOpenModelPicker}
          >
            {modelLabel}
          </button>
          {editorContextLabel === undefined ? null : (
            <span className="editor-chip" title={UI_TEXT.editorContextTitle}>
              <FileIcon />
              <span className="editor-chip-label">{editorContextLabel}</span>
              <button
                type="button"
                className="chip-remove"
                title={UI_TEXT.editorContextRemove}
                aria-label={`${UI_TEXT.editorContextRemove}: ${editorContextLabel}`}
                onMouseDown={keepMenuFocus}
                onClick={onDismissEditorContext}
              >
                <CloseIcon />
              </button>
            </span>
          )}
          {referenceLabel === undefined ? null : (
            <span className="editor-chip reference-chip" title={UI_TEXT.referenceTitle}>
              <ReplyIcon />
              <span className="editor-chip-label">{referenceLabel}</span>
              <button
                type="button"
                className="chip-remove"
                title={UI_TEXT.referenceRemove}
                aria-label={`${UI_TEXT.referenceRemove}: ${referenceLabel}`}
                onMouseDown={keepMenuFocus}
                onClick={onDismissReference}
              >
                <CloseIcon />
              </button>
            </span>
          )}
        </div>
        <div className="composer-toolbar-group">
          {contextLabel === undefined ? null : (
            <button
              type="button"
              className="context-label context-label-button"
              title={contextTitle}
              onClick={onCompact}
            >
              {contextLabel}
            </button>
          )}
          <button
            type="button"
            className="mode-button"
            title={UI_TEXT.permissionModeTitle}
            aria-label={`Permission mode: ${PERMISSION_MODE_LABELS[permissionMode]}`}
            onMouseDown={keepMenuFocus}
            onClick={onOpenModeMenu}
          >
            {modeIcon(permissionMode)}
            <span>{PERMISSION_MODE_LABELS[permissionMode]}</span>
          </button>
          <button
            type="button"
            className={`icon-button mic-button mic-${dictation.status}`}
            title={dictationTitle(dictation)}
            aria-label={UI_TEXT.dictationLabel}
            aria-pressed={dictation.status === 'listening' || dictation.status === 'starting'}
            aria-disabled={dictation.status === 'unavailable' || undefined}
            onPointerDown={pressDictationWithPointer}
            onKeyDown={handleMicKeyDown}
            onKeyUp={handleMicKeyUp}
          >
            <MicIcon />
          </button>
          {isRunning ? (
            <button
              type="button"
              className="send-button"
              title={UI_TEXT.stopTitle}
              aria-label={UI_TEXT.stopTitle}
              onClick={onStop}
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              title={canSend ? UI_TEXT.sendTitle : UI_TEXT.sendDisabledReason}
              aria-label={UI_TEXT.sendTitle}
              disabled={!canSend}
              onClick={onSubmit}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </footer>
  )
}
