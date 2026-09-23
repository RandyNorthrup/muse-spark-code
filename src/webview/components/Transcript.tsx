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
import { formatDurationMs } from './AgentMap'
import { useCopiedFlag } from '../useCopiedFlag'
import { CheckIcon, CopyIcon, FileIcon, ImageIcon, RewindIcon } from './icons'
import { MarkdownView } from './MarkdownView'
import { ReasoningRow } from './ReasoningRow'
import { StatusLine } from './StatusLine'
import { ToolRow, type ToolRowProps } from './ToolRow'

export interface TranscriptProps {
  readonly entries: readonly TranscriptEntry[]
  readonly isRunning: boolean
  readonly isFocusView: boolean
  readonly outputPages: Readonly<Record<string, OutputPage>>
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
  readonly onReadOutput: (itemId: string, outputRef: string, offsetBytes: number) => void
  /** A tool output as an editor tab (M15). */
  readonly onOpenOutput: ToolRowProps['onOpenOutput']
  readonly onDecide: (decision: ApprovalDecisionInput) => void
  readonly onAnswer: (userInputId: string, answers: readonly QuestionAnswer[]) => void
  /** Code block Apply and edit review (M5). */
  readonly onApply: (text: string) => void
  readonly onOpenEditDiff: (itemId: string, outputRef: string) => void
  readonly onRevertEdit: (itemId: string, outputRef: string) => void
  /** The user card's menu (M6, M13); absent while no session exists. */
  readonly onFork?: ((entryId: string) => void) | undefined
  readonly onRewind?: ((entryId: string) => void) | undefined
}

/** The rows of the user card's menu, in Claude Code's order. */
const REWIND_MENU = [
  { id: 'fork', label: UI_TEXT.forkFromHere },
  { id: 'rewind', label: UI_TEXT.rewindCodeToHere },
  { id: 'both', label: UI_TEXT.forkAndRewind },
] as const
type RewindChoice = (typeof REWIND_MENU)[number]['id']

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

function UserCard({
  entry,
  onFork,
  onRewind,
}: {
  readonly entry: Extract<TranscriptEntry, { kind: 'user' }>
  readonly onFork: ((entryId: string) => void) | undefined
  readonly onRewind: ((entryId: string) => void) | undefined
}) {
  const hasChips = entry.attachments.length > 0 || entry.contextLabel !== undefined
  const [isMenuOpen, setMenuOpen] = useState(false)
  const hasMenu = onFork !== undefined && onRewind !== undefined && entry.status === 'sent'
  const choose = (choice: RewindChoice) => {
    setMenuOpen(false)
    if (choice !== 'fork') {
      onRewind?.(entry.id)
    }
    if (choice !== 'rewind') {
      onFork?.(entry.id)
    }
  }
  return (
    <li
      className={`message message-user message-${entry.status}`}
      onKeyDown={(event) => {
        if (!isMenuOpen || event.key !== 'Escape') {
          return
        }
        event.stopPropagation()
        setMenuOpen(false)
      }}
    >
      {hasChips ? (
        <ul className="chips chips-strip" aria-label={UI_TEXT.attachmentsLabel}>
          {entry.contextLabel === undefined ? null : (
            <li className="chip" title={UI_TEXT.editorContextLabel}>
              <FileIcon />
              <span className="chip-name">{entry.contextLabel}</span>
            </li>
          )}
          {entry.attachments.map((attachment) => (
            <li key={attachment.id} className="chip">
              <ImageIcon />
              <span className="chip-name">{attachment.name}</span>
              {attachment.width === undefined || attachment.height === undefined ? null : (
                <span className="chip-size">
                  {attachment.width}×{attachment.height}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="message-text">{entry.text}</div>
      {entry.status === 'failed' ? (
        <div className="message-error" role="alert">
          {entry.reason}
        </div>
      ) : null}
      {hasMenu ? (
        <div className="rewind">
          <button
            type="button"
            className="rewind-button"
            title={UI_TEXT.rewindMenuLabel}
            aria-label={UI_TEXT.rewindMenuLabel}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => {
              setMenuOpen((isOpen) => !isOpen)
            }}
          >
            <RewindIcon />
          </button>
          {isMenuOpen ? (
            <div className="rewind-menu" role="menu" aria-label={UI_TEXT.rewindMenuLabel}>
              {REWIND_MENU.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  role="menuitem"
                  className="rewind-menu-item"
                  onClick={() => {
                    choose(row.id)
                  }}
                >
                  {row.label}
                </button>
              ))}
            </div>
          ) : null}
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
interface AssistantRowProps {
  readonly entry: Extract<TranscriptEntry, { kind: 'assistant' }>
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
  readonly onApply: (text: string) => void
}

function AssistantRow({ entry, onOpenLink, onCopy, onInsert, onApply }: AssistantRowProps) {
  const text = useDeferredValue(entry.text)
  const { head, tail } = entry.isStreaming ? splitForStreaming(text) : { head: '', tail: text }
  const actions = { onOpenLink, onCopy, onInsert, onApply }
  const [isCopied, markCopied] = useCopiedFlag()
  return (
    <li className="message message-assistant" aria-busy={entry.isStreaming}>
      <span className="tool-dot tool-dot-muted" aria-hidden="true" />
      <div className="message-body">
        {head === '' ? null : <MarkdownView text={head} {...actions} />}
        <MarkdownView text={tail} {...actions} />
        {entry.isStreaming ? <span className="cursor" aria-hidden="true" /> : null}
      </div>
      {entry.isStreaming ? null : (
        <button
          type="button"
          className="response-copy"
          aria-label={UI_TEXT.copyResponse}
          title={isCopied ? UI_TEXT.copiedCode : UI_TEXT.copyResponse}
          onClick={() => {
            onCopy(entry.text)
            markCopied()
          }}
        >
          {isCopied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
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
    onOpenOutput,
    onDecide,
    onAnswer,
    onApply,
    onOpenEditDiff,
    onRevertEdit,
    onFork,
    onRewind,
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
        onOpenOutput={onOpenOutput}
        onDecide={onDecide}
        onAnswer={onAnswer}
        onOpenEditDiff={onOpenEditDiff}
        onRevertEdit={onRevertEdit}
      />
    )
  const renderEntry = (entry: TranscriptEntry) => {
    switch (entry.kind) {
      case 'user': {
        return <UserCard key={entry.id} entry={entry} onFork={onFork} onRewind={onRewind} />
      }
      case 'assistant': {
        return (
          <AssistantRow
            key={entry.id}
            entry={entry}
            onOpenLink={onOpenLink}
            onCopy={onCopy}
            onInsert={onInsert}
            onApply={onApply}
          />
        )
      }
      case 'reasoning':
      case 'tool': {
        return renderStep(entry)
      }
      case 'subagent': {
        return (
          <li key={entry.id} className="activity activity-subagent" data-status={entry.status}>
            <span className="activity-kind">{UI_TEXT.subagentRowLabel}</span>
            <span className="activity-status">
              {[
                entry.objective ?? entry.role ?? UI_TEXT.agentUntitled,
                entry.durationMs === undefined ? undefined : formatDurationMs(entry.durationMs),
                entry.status === 'inProgress'
                  ? UI_TEXT.agentRunning
                  : (entry.controlStatus ?? entry.status),
              ]
                .filter((part) => part !== undefined)
                .join(' · ')}
            </span>
          </li>
        )
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
