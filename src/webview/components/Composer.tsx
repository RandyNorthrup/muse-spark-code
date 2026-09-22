// The prompt box: textarea with Claude-Code key semantics (Enter sends,
// Shift+Enter newline, optional Ctrl/Cmd+Enter-to-send, Shift+Tab cycles the
// permission mode, "/" on an empty draft opens the palette, "@" opens the
// mention menu), attachment chips, paste/drop of images and editor files,
// the attach ("+") and slash buttons, the model pill, the permission-mode
// button and Send/Stop. The "+" button and the mode button open menus the
// parent renders above the composer.

import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  COMPOSER_MAX_ROWS,
  PERMISSION_MODE_LABELS,
  type PermissionMode,
  UI_TEXT,
} from '../../shared/constants'
import { applyMention, type MentionQuery, mentionQueryAt } from '../../shared/mentions'
import type { AttachmentSummary, MentionItem, SettingsSnapshot } from '../../shared/protocol'
import { blobToBase64, parseUriList } from '../base64'
import type { MentionResults } from '../state/uiState'
import { AttachmentChips } from './AttachmentChips'
import { PlusIcon, SendIcon, SlashIcon, StopIcon } from './icons'
import { MentionMenu, mentionOptionId } from './MentionMenu'
import { modeIcon } from './modeIcons'

export interface ImageData {
  readonly name: string
  readonly mediaType: string
  readonly base64: string
}

export interface ComposerProps {
  readonly draft: string
  readonly placeholder: string
  readonly settings: SettingsSnapshot
  readonly canSend: boolean
  readonly isRunning: boolean
  readonly modelLabel: string
  readonly permissionMode: PermissionMode
  readonly focusRequests: number
  readonly pendingInsert: string | undefined
  readonly attachments: readonly AttachmentSummary[]
  readonly mentionResults: MentionResults | undefined
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
  readonly onDroppedUris: (uris: readonly string[]) => void
}

const MIN_ROWS = 1
const URI_LIST_TYPE = 'text/uri-list'
const IMAGE_TYPE_PREFIX = 'image/'
const PASTED_IMAGE_NAME = 'pasted-image'

function rowsFor(draft: string): number {
  const lines = draft.split('\n').length
  return Math.min(Math.max(lines, MIN_ROWS), COMPOSER_MAX_ROWS)
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

export function Composer(props: ComposerProps) {
  const {
    draft,
    placeholder,
    settings,
    canSend,
    isRunning,
    modelLabel,
    permissionMode,
    focusRequests,
    pendingInsert,
    attachments,
    mentionResults,
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
    onDroppedUris,
  } = props
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [dismissedMention, setDismissedMention] = useState<number | undefined>(undefined)
  const requestCounter = useRef(0)
  const [activeRequest, setActiveRequest] = useState<number | undefined>(undefined)

  const mention: MentionQuery | undefined = mentionQueryAt(draft, caret)
  const isMentionOpen = mention !== undefined && dismissedMention !== mention.start
  const mentionItems: readonly MentionItem[] =
    isMentionOpen && mentionResults !== undefined && mentionResults.requestId === activeRequest
      ? mentionResults.items
      : []

  useEffect(() => {
    if (focusRequests === 0) {
      return
    }
    textareaRef.current?.focus()
  }, [focusRequests])

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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (didHandleMentionKey(event)) {
      event.preventDefault()
      return
    }
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      onCyclePermissionMode()
      return
    }
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey
    if (draft === '' && !hasModifier && event.key === '/') {
      event.preventDefault()
      onOpenPalette()
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

  const attachFiles = (files: readonly File[]) => {
    for (const file of files) {
      void blobToBase64(file).then((base64) => {
        onAttachImage({
          name: file.name === '' ? PASTED_IMAGE_NAME : file.name,
          mediaType: file.type,
          base64,
        })
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

  return (
    <footer
      className="composer"
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={handleDrop}
    >
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
        aria-label={UI_TEXT.composerLabel}
        aria-autocomplete="list"
        aria-controls={isMentionOpen ? 'mention-listbox' : undefined}
        aria-activedescendant={
          isMentionOpen && mentionItems.length > 0 ? mentionOptionId(mentionIndex) : undefined
        }
        placeholder={isRunning ? UI_TEXT.composerQueuePlaceholder : placeholder}
        rows={rowsFor(draft)}
        value={draft}
        onChange={(event) => {
          onDraftChange(event.target.value)
          setCaret(event.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
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
        </div>
        <div className="composer-toolbar-group">
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
