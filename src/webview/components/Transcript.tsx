// The conversation: user cards with their image chips, assistant markdown,
// reasoning rows, tool rows (with approval / question cards), generic items,
// errors and notices, and the status line while a turn runs. Focus view
// collapses tool and reasoning rows behind one expandable row per run.

import { useDeferredValue, useState } from 'react'
import type { QuestionAnswer } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { type OutputPage, outputPageKey, type TranscriptEntry } from '../state/uiState'
import { splitForStreaming } from '../streamSplit'
import type { ApprovalDecisionInput } from './ApprovalCard'
import { ImageIcon } from './icons'
import { MarkdownView } from './MarkdownView'
import { ReasoningRow } from './ReasoningRow'
import { StatusLine } from './StatusLine'
import { ToolRow } from './ToolRow'

export interface TranscriptProps {
  readonly entries: readonly TranscriptEntry[]
  readonly isRunning: boolean
  readonly isFocusView: boolean
  readonly outputPages: Readonly<Record<string, OutputPage>>
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
  readonly onReadOutput: (itemId: string, outputRef: string, offsetBytes: number) => void
  readonly onDecide: (decision: ApprovalDecisionInput) => void
  readonly onAnswer: (userInputId: string, answers: readonly QuestionAnswer[]) => void
}

type StepEntry = Extract<TranscriptEntry, { kind: 'tool' | 'reasoning' }>

/** Consecutive tool/reasoning rows folded into one group for Focus view. */
type Segment =
  | { readonly kind: 'entry'; readonly entry: TranscriptEntry }
  | { readonly kind: 'steps'; readonly id: string; readonly steps: readonly StepEntry[] }

function isStep(entry: TranscriptEntry): entry is StepEntry {
  return entry.kind === 'tool' || entry.kind === 'reasoning'
}

/** A step waiting on the user is never hidden, whatever the view. */
function isWaiting(entry: StepEntry): boolean {
  return entry.kind === 'tool' && (entry.approval !== undefined || entry.question !== undefined)
}

export function segment(entries: readonly TranscriptEntry[], isFocusView: boolean): Segment[] {
  const segments: Segment[] = []
  for (const entry of entries) {
    const last = segments.at(-1)
    if (isFocusView && isStep(entry) && !isWaiting(entry)) {
      if (last?.kind === 'steps') {
        segments[segments.length - 1] = { ...last, steps: [...last.steps, entry] }
      } else {
        segments.push({ kind: 'steps', id: `steps:${entry.id}`, steps: [entry] })
      }
      continue
    }
    segments.push({ kind: 'entry', entry })
  }
  return segments
}

function UserCard({ entry }: { readonly entry: Extract<TranscriptEntry, { kind: 'user' }> }) {
  return (
    <li className={`message message-user message-${entry.status}`}>
      {entry.attachments.length === 0 ? null : (
        <ul className="chips chips-strip" aria-label={UI_TEXT.attachmentsLabel}>
          {entry.attachments.map((attachment) => (
            <li key={attachment.id} className="chip">
              <ImageIcon />
              <span className="chip-name">{attachment.name}</span>
              <span className="chip-size">
                {attachment.width}×{attachment.height}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="message-text">{entry.text}</div>
      {entry.status === 'failed' ? (
        <div className="message-error" role="alert">
          {entry.reason}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Assistant text. While a reply streams it is rendered in two parts: a
 * stable head (memoised, re-rendered only when the split point moves) and a
 * tail that re-parses per delta, so the per-delta cost stays that of one
 * paragraph rather than the whole reply (docs/certification/m4.md). The
 * value is also deferred so React never blocks input on that render.
 */
function AssistantRow({
  entry,
  onOpenLink,
  onCopy,
  onInsert,
}: {
  readonly entry: Extract<TranscriptEntry, { kind: 'assistant' }>
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
}) {
  const text = useDeferredValue(entry.text)
  const { head, tail } = entry.isStreaming ? splitForStreaming(text) : { head: '', tail: text }
  return (
    <li className="message message-assistant" aria-busy={entry.isStreaming}>
      <span className="tool-dot tool-dot-muted" aria-hidden="true" />
      <div className="message-body">
        {head === '' ? null : (
          <MarkdownView text={head} onOpenLink={onOpenLink} onCopy={onCopy} onInsert={onInsert} />
        )}
        <MarkdownView text={tail} onOpenLink={onOpenLink} onCopy={onCopy} onInsert={onInsert} />
        {entry.isStreaming ? <span className="cursor" aria-hidden="true" /> : null}
      </div>
    </li>
  )
}

function StepsGroup({
  group,
  render,
}: {
  readonly group: Extract<Segment, { kind: 'steps' }>
  readonly render: (entry: StepEntry) => React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const count = group.steps.length
  return (
    <li className="steps">
      <button
        type="button"
        className="steps-toggle"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen(!isOpen)
        }}
      >
        {isOpen ? UI_TEXT.hideSteps : UI_TEXT.showSteps} {String(count)}{' '}
        {count === 1 ? UI_TEXT.focusHiddenOne : UI_TEXT.focusHiddenMany}
      </button>
      {isOpen ? <ul className="steps-list">{group.steps.map((step) => render(step))}</ul> : null}
    </li>
  )
}

export function Transcript(props: TranscriptProps) {
  const {
    entries,
    isRunning,
    isFocusView,
    outputPages,
    onOpenLink,
    onCopy,
    onInsert,
    onReadOutput,
    onDecide,
    onAnswer,
  } = props
  const renderStep = (entry: StepEntry) =>
    entry.kind === 'reasoning' ? (
      <ReasoningRow key={entry.id} entry={entry} />
    ) : (
      <ToolRow
        key={entry.id}
        entry={entry}
        patchPage={
          entry.patchRef === undefined
            ? undefined
            : outputPages[outputPageKey(entry.id, entry.patchRef.id)]
        }
        onReadOutput={onReadOutput}
        onDecide={onDecide}
        onAnswer={onAnswer}
      />
    )
  const renderEntry = (entry: TranscriptEntry) => {
    switch (entry.kind) {
      case 'user': {
        return <UserCard key={entry.id} entry={entry} />
      }
      case 'assistant': {
        return (
          <AssistantRow
            key={entry.id}
            entry={entry}
            onOpenLink={onOpenLink}
            onCopy={onCopy}
            onInsert={onInsert}
          />
        )
      }
      case 'reasoning':
      case 'tool': {
        return renderStep(entry)
      }
      case 'item': {
        return (
          <li key={entry.id} className="activity" data-status={entry.status}>
            <span className="activity-kind">{entry.itemKind}</span>
            <span className="activity-status">{entry.text ?? entry.status}</span>
          </li>
        )
      }
      case 'error': {
        return (
          <li key={entry.id} className="message message-error-card" role="alert">
            {entry.text}
          </li>
        )
      }
      case 'notice': {
        return (
          <li
            key={entry.id}
            className={`notice notice-${entry.level}`}
            role={entry.level === 'error' ? 'alert' : 'status'}
          >
            {entry.text}
          </li>
        )
      }
    }
  }
  return (
    <ol className="transcript" aria-label="Conversation">
      {segment(entries, isFocusView).map((part) =>
        part.kind === 'steps' ? (
          <StepsGroup key={part.id} group={part} render={renderStep} />
        ) : (
          renderEntry(part.entry)
        ),
      )}
      {isRunning ? <StatusLine /> : null}
    </ol>
  )
}
