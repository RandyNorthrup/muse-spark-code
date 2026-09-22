// The prompt box: textarea with Claude-Code key semantics (Enter sends,
// Shift+Enter newline, optional Ctrl/Cmd+Enter-to-send), the attach and
// slash buttons, the model pill, the permission-mode button and Send.
// Sending is disabled until a backend exists (M2); the key handling is already
// final so the tests pin it now.

import { type KeyboardEvent, useEffect, useRef } from 'react'
import { COMPOSER_MAX_ROWS, PERMISSION_MODE_LABELS, UI_TEXT } from '../../shared/constants'
import type { SettingsSnapshot } from '../../shared/protocol'
import { CodeIcon, PlusIcon, SendIcon, SlashIcon } from './icons'

export interface ComposerProps {
  readonly draft: string
  readonly placeholder: string
  readonly settings: SettingsSnapshot
  readonly canSend: boolean
  readonly focusRequests: number
  readonly pendingInsert: string | undefined
  readonly onDraftChange: (draft: string) => void
  readonly onInsertApplied: () => void
  readonly onSubmit: () => void
  readonly onFocusChange: (isFocused: boolean) => void
}

const MIN_ROWS = 1

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

export function Composer(props: ComposerProps) {
  const {
    draft,
    placeholder,
    settings,
    canSend,
    focusRequests,
    pendingInsert,
    onDraftChange,
    onInsertApplied,
    onSubmit,
    onFocusChange,
  } = props
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    const caret = start + pendingInsert.length
    // Runs after React commits the new value.
    queueMicrotask(() => {
      textarea.setSelectionRange(caret, caret)
    })
  }, [pendingInsert, draft, onDraftChange, onInsertApplied])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSendKey(event, settings.useCtrlEnterToSend)) {
      return
    }
    event.preventDefault()
    if (canSend) {
      onSubmit()
    }
  }

  const modeLabel = PERMISSION_MODE_LABELS[settings.initialPermissionMode]

  return (
    <footer className="composer">
      <textarea
        ref={textareaRef}
        className="composer-input"
        aria-label={UI_TEXT.composerLabel}
        placeholder={placeholder}
        rows={rowsFor(draft)}
        value={draft}
        onChange={(event) => {
          onDraftChange(event.target.value)
        }}
        onKeyDown={handleKeyDown}
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
            title={UI_TEXT.attachDisabledReason}
            aria-label="Attach"
            disabled
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            title={UI_TEXT.commandsDisabledReason}
            aria-label="Commands"
            disabled
          >
            <SlashIcon />
          </button>
          <button type="button" className="pill" title={UI_TEXT.notSignedIn} disabled>
            {UI_TEXT.notSignedIn}
          </button>
        </div>
        <div className="composer-toolbar-group">
          <button
            type="button"
            className="mode-button"
            title="Permission mode"
            aria-label={`Permission mode: ${modeLabel}`}
            disabled
          >
            <CodeIcon />
            <span>{modeLabel}</span>
          </button>
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
        </div>
      </div>
    </footer>
  )
}
