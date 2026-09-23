// A reasoning item: "Thought for 14s" (or "Thinking…" while streaming) that
// expands to the summary parts the provider exposed.

import { useState } from 'react'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import type { TranscriptEntry } from '../state/uiState'
import { ExpandChevron } from './icons'

type ReasoningEntry = Extract<TranscriptEntry, { kind: 'reasoning' }>

export function reasoningLabel(entry: ReasoningEntry): string {
  if (entry.isStreaming || entry.durationMs === undefined) {
    return `${UI_TEXT.thinkingNow}…`
  }
  const seconds = Math.max(1, Math.round(entry.durationMs / MILLISECONDS_PER_SECOND))
  return `${UI_TEXT.thoughtFor} ${String(seconds)}s`
}

export function ReasoningRow({ entry }: { readonly entry: ReasoningEntry }) {
  const [isOpen, setIsOpen] = useState(false)
  const hasBody = entry.parts.some((part) => part !== '')
  return (
    <li className="reasoning" aria-busy={entry.isStreaming}>
      <button
        type="button"
        className="reasoning-header"
        aria-expanded={isOpen}
        disabled={!hasBody}
        onClick={() => {
          setIsOpen(!isOpen)
        }}
      >
        <span className="tool-dot tool-dot-muted" aria-hidden="true" />
        <span>{reasoningLabel(entry)}</span>
        {hasBody ? <ExpandChevron isOpen={isOpen} /> : null}
      </button>
      {isOpen && hasBody ? (
        <div className="reasoning-body">
          {entry.parts.map((part, index) => (
            <p key={String(index)}>{part}</p>
          ))}
        </div>
      ) : null}
    </li>
  )
}
