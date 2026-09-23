// The menu for a highlighted passage of the chat (M17): right-click text in a
// message or a tool row and choose to ask a question about it or comment on
// it. Rendered inside the row the selection started in, at its top-right,
// like the user card's rewind menu. It replaces the browser's own menu, so
// it offers the browser's Copy first (M25); Escape, a choice, a press
// outside it or focus leaving it closes it.

import { useEffect, useRef } from 'react'
import { CHAT_REFERENCE_INTENTS, UI_TEXT } from '../../shared/constants'
import type { ChatReference } from '../../shared/protocol'
import { useDismiss } from '../useDismiss'

export type QuoteIntent = Exclude<ChatReference['intent'], 'reply'>

export interface QuoteMenuProps {
  readonly onChoose: (intent: QuoteIntent) => void
  /** Copy the highlighted text to the clipboard (M25). */
  readonly onCopy: () => void
  readonly onClose: () => void
}

const [, QUESTION, COMMENT] = CHAT_REFERENCE_INTENTS

export function QuoteMenu({ onChoose, onCopy, onClose }: QuoteMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    first.current?.focus()
  }, [])
  const onBlur = useDismiss(menu, true, onClose)
  return (
    <div
      ref={menu}
      className="rewind-menu quote-menu"
      role="menu"
      aria-label={UI_TEXT.quoteMenuLabel}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') {
          return
        }
        event.stopPropagation()
        onClose()
      }}
    >
      <button
        ref={first}
        type="button"
        role="menuitem"
        className="rewind-menu-item"
        onClick={onCopy}
      >
        {UI_TEXT.quoteCopy}
      </button>
      <button
        type="button"
        role="menuitem"
        className="rewind-menu-item"
        onClick={() => {
          onChoose(QUESTION)
        }}
      >
        {UI_TEXT.askAboutThis}
      </button>
      <button
        type="button"
        role="menuitem"
        className="rewind-menu-item"
        onClick={() => {
          onChoose(COMMENT)
        }}
      >
        {UI_TEXT.commentOnThis}
      </button>
    </div>
  )
}
