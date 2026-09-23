// The menu for a highlighted passage of the chat (M17): right-click text in a
// message or a tool row and choose to ask a question about it or comment on
// it. Rendered inside the row the selection started in, at its top-right,
// like the user card's rewind menu; Escape or a choice closes it.

import { useEffect, useRef } from 'react'
import { CHAT_REFERENCE_INTENTS, UI_TEXT } from '../../shared/constants'
import type { ChatReference } from '../../shared/protocol'

export type QuoteIntent = Exclude<ChatReference['intent'], 'reply'>

export interface QuoteMenuProps {
  readonly onChoose: (intent: QuoteIntent) => void
  readonly onClose: () => void
}

const [, QUESTION, COMMENT] = CHAT_REFERENCE_INTENTS

export function QuoteMenu({ onChoose, onClose }: QuoteMenuProps) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    first.current?.focus()
  }, [])
  return (
    <div
      className="rewind-menu quote-menu"
      role="menu"
      aria-label={UI_TEXT.quoteMenuLabel}
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
