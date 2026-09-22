// The conversation so far. M2 renders plain text with preserved whitespace;
// markdown, code blocks and tool rows arrive in M4.

import { UI_TEXT } from '../../shared/constants'
import type { TranscriptEntry } from '../state/uiState'

export interface TranscriptProps {
  readonly entries: readonly TranscriptEntry[]
}

function Entry({ entry }: { readonly entry: TranscriptEntry }) {
  switch (entry.kind) {
    case 'user': {
      return (
        <li className={`message message-user message-${entry.status}`}>
          <div className="message-text">{entry.text}</div>
          {entry.status === 'failed' ? (
            <div className="message-error" role="alert">
              {entry.reason}
            </div>
          ) : null}
        </li>
      )
    }
    case 'assistant': {
      return (
        <li className="message message-assistant" aria-busy={entry.isStreaming}>
          <div className="message-text">
            {entry.text}
            {entry.isStreaming ? <span className="cursor" aria-hidden="true" /> : null}
          </div>
        </li>
      )
    }
    case 'activity': {
      return (
        <li className="activity" data-status={entry.status}>
          <span className="activity-kind">{entry.itemKind}</span>
          <span className="activity-status">
            {entry.status === 'inProgress' ? UI_TEXT.working : entry.status}
          </span>
        </li>
      )
    }
    case 'error': {
      return (
        <li className="message message-error-card" role="alert">
          {entry.text}
        </li>
      )
    }
    case 'notice': {
      return (
        <li
          className={`notice notice-${entry.level}`}
          role={entry.level === 'error' ? 'alert' : 'status'}
        >
          {entry.text}
        </li>
      )
    }
  }
}

export function Transcript({ entries }: TranscriptProps) {
  return (
    <ol className="transcript" aria-label="Conversation">
      {entries.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
    </ol>
  )
}
