// A reasoning item, as Claude Code shows one (M16): "Thinking…" with the
// summary parts streaming beneath it while the model thinks, then a plain
// "Thought for 14s" line once it is done. Nothing to expand afterwards.

import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import type { TranscriptEntry } from '../state/uiState'

type ReasoningEntry = Extract<TranscriptEntry, { kind: 'reasoning' }>

export function reasoningLabel(entry: ReasoningEntry): string {
  if (entry.isStreaming || entry.durationMs === undefined) {
    return `${UI_TEXT.thinkingNow}…`
  }
  const seconds = Math.max(1, Math.round(entry.durationMs / MILLISECONDS_PER_SECOND))
  return `${UI_TEXT.thoughtFor} ${String(seconds)}s`
}

export function ReasoningRow({ entry }: { readonly entry: ReasoningEntry }) {
  const liveParts = entry.isStreaming ? entry.parts.filter((part) => part !== '') : []
  return (
    <li className="reasoning" aria-busy={entry.isStreaming}>
      <div className="reasoning-header">
        <span className="tool-dot tool-dot-muted" aria-hidden="true" />
        <span>{reasoningLabel(entry)}</span>
      </div>
      {liveParts.length === 0 ? null : (
        <div className="reasoning-body">
          {liveParts.map((part, index) => (
            <p key={String(index)}>{part}</p>
          ))}
        </div>
      )}
    </li>
  )
}
