// The conversation: user cards with their image chips, assistant markdown,
// reasoning rows, tool rows (with approval / question cards), generic items,
// errors and notices, and the status line while a turn runs. Focus view
// collapses tool and reasoning rows behind one expandable row per run.
//
// Every row is memoised and every callback the app passes is stable (M25), so
// a keystroke in the composer renders no row and a streamed delta renders
// only the row it changes. The rows carry no alert roles: the app's single
// live region reads failures and turn ends out once (M25).

import { memo, type ReactNode, useDeferredValue, useRef, useState } from 'react'
import type { CitationSummary, QuestionAnswer } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import { type OutputPage, outputPageKey, type TranscriptEntry } from '../state/uiState'
import { linkTarget } from '../links'
import { splitForStreaming, splitOpenFence } from '../streamSplit'
import { useDismiss } from '../useDismiss'
import type { ApprovalDecisionInput } from './ApprovalCard'
import { agentStatusLabel, formatDurationMs } from './AgentMap'
import { useCopiedFlag } from '../useCopiedFlag'
import { CodeBlock } from './CodeBlock'
import { CheckIcon, CopyIcon, FileIcon, ImageIcon, MoreIcon, ReplyIcon, RewindIcon } from './icons'
import { type QuoteIntent, QuoteMenu } from './QuoteMenu'
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
  /** The question card's Cancel (M16). */
  readonly onCancelQuestion: (userInputId: string) => void
  /** Code block Apply and edit review (M5). */
  readonly onApply: (text: string) => void
  readonly onOpenEditDiff: (itemId: string, outputRef: string) => void
  /** A tool row's path, or a reply's relative link: the file (M16, M25). */
  readonly onOpenFile: ToolRowProps['onOpenFile']
  /** A reply's link to a file outside the workspace (M25). */
  readonly onRefuseLink?: (() => void) | undefined
  /** The user card's menu (M6, M13); absent while no session exists. */
  readonly onFork?: ((entryId: string) => void) | undefined
  readonly onRewind?: ((entryId: string) => void) | undefined
  /** A reply's actions menu (M17); absent while no session exists. */
  readonly onReply?: ((entryId: string) => void) | undefined
  /** The row whose highlighted text has the Copy / Ask / Comment menu open (M17). */
  readonly quoteMenuEntryId?: string | undefined
  readonly onQuote?: ((intent: QuoteIntent) => void) | undefined
  readonly onCopyQuote?: (() => void) | undefined
  readonly onCloseQuoteMenu?: (() => void) | undefined
}

type RewindChoice = 'fork' | 'rewind' | 'both'

/** The rows of the user card's menu, in Claude Code's order. */
function rewindMenu(): readonly { readonly id: RewindChoice; readonly label: string }[] {
  return [
    { id: 'fork', label: UI_TEXT.forkFromHere },
    { id: 'rewind', label: UI_TEXT.rewindCodeToHere },
    { id: 'both', label: UI_TEXT.forkAndRewind },
  ]
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

/** Escape inside an open menu closes it and stays inside the row. */
function closeOnEscape(isOpen: boolean, close: () => void) {
  return (event: React.KeyboardEvent<HTMLElement>) => {
    if (!isOpen || event.key !== 'Escape') {
      return
    }
    event.stopPropagation()
    close()
  }
}

const UserCard = memo(function UserCard({
  entry,
  onFork,
  onRewind,
  quoteMenu,
}: {
  readonly entry: Extract<TranscriptEntry, { kind: 'user' }>
  readonly onFork: ((entryId: string) => void) | undefined
  readonly onRewind: ((entryId: string) => void) | undefined
  readonly quoteMenu: ReactNode
}) {
  const hasChips =
    entry.attachments.length > 0 ||
    entry.contextLabel !== undefined ||
    entry.referenceLabel !== undefined
  const [isMenuOpen, setMenuOpen] = useState(false)
  const menuArea = useRef<HTMLDivElement>(null)
  const closeMenu = () => {
    setMenuOpen(false)
  }
  const onMenuBlur = useDismiss(menuArea, isMenuOpen, closeMenu)
  // Without fork (a host that refuses it, D26) the menu offers the rewind alone.
  const hasMenu = onRewind !== undefined && entry.status === 'sent'
  const menuRows = rewindMenu().filter((row) => onFork !== undefined || row.id === 'rewind')
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
      data-entry-id={entry.id}
      data-role="user"
      onKeyDown={closeOnEscape(isMenuOpen, closeMenu)}
    >
      {hasChips ? (
        <ul className="chips chips-strip" aria-label={UI_TEXT.attachmentsLabel}>
          {entry.contextLabel === undefined ? null : (
            <li className="chip" title={UI_TEXT.editorContextLabel}>
              <FileIcon />
              <span className="chip-name">{entry.contextLabel}</span>
            </li>
          )}
          {entry.referenceLabel === undefined ? null : (
            <li className="chip" title={UI_TEXT.referenceTitle}>
              <ReplyIcon />
              <span className="chip-name" dir="auto">
                {entry.referenceLabel}
              </span>
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
      <div className="message-text" dir="auto">
        {entry.text}
      </div>
      {entry.status === 'failed' ? <div className="message-error">{entry.reason}</div> : null}
      {hasMenu ? (
        <div ref={menuArea} className="rewind" onBlur={onMenuBlur}>
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
              {menuRows.map((row) => (
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
      {quoteMenu}
    </li>
  )
})

/** The host name a citation without a title is shown by; the URL itself when it has none. */
function citationLabel(citation: CitationSummary): string {
  if (citation.title !== undefined) {
    return citation.title
  }
  try {
    return new URL(citation.url).host || citation.url
  } catch {
    return citation.url
  }
}

/**
 * The web pages a reply cites (M33, `url_citation`), each once, under the
 * reply. They open like the reply's own links: http and https in the
 * browser, anything else refused.
 */
function Citations({
  citations,
  onOpenLink,
  onRefuseLink,
}: {
  readonly citations: readonly CitationSummary[]
  readonly onOpenLink: (url: string) => void
  readonly onRefuseLink: (() => void) | undefined
}) {
  return (
    <nav className="citations" aria-label={UI_TEXT.citationsHeading}>
      <span className="citations-heading">{UI_TEXT.citationsHeading}</span>
      <ol className="citations-list">
        {citations.map((citation) => (
          <li key={citation.url}>
            <a
              href={citation.url}
              title={citation.url}
              onClick={(event) => {
                event.preventDefault()
                const target = linkTarget(citation.url)
                if (target.kind === 'external') {
                  onOpenLink(target.url)
                } else {
                  onRefuseLink?.()
                }
              }}
            >
              {citationLabel(citation)}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * Assistant text. While a reply streams it is rendered in two parts: a
 * stable head (memoised, re-rendered only when the split point moves) and a
 * tail that re-parses per delta, so the per-delta cost stays that of one
 * paragraph rather than the whole reply (docs/certification/m4.md). A code
 * fence still open at the end of the tail is shown as plain text outside the
 * markdown and highlighted once it closes (M25). The value is also deferred
 * so React never blocks input on that render.
 */
interface AssistantRowProps {
  readonly entry: Extract<TranscriptEntry, { kind: 'assistant' }>
  readonly onOpenLink: (url: string) => void
  readonly onOpenFile: ToolRowProps['onOpenFile']
  readonly onRefuseLink: (() => void) | undefined
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
  readonly onApply: (text: string) => void
  /** The actions menu's "Reply to this output" (M17); absent while no session exists. */
  readonly onReply: ((entryId: string) => void) | undefined
  /** The highlighted-text menu when it belongs to this row (M17). */
  readonly quoteMenu: ReactNode
}

const AssistantRow = memo(function AssistantRow({
  entry,
  onOpenLink,
  onOpenFile,
  onRefuseLink,
  onCopy,
  onInsert,
  onApply,
  onReply,
  quoteMenu,
}: AssistantRowProps) {
  const text = useDeferredValue(entry.text)
  const { head, tail } = entry.isStreaming ? splitForStreaming(text) : { head: '', tail: text }
  const { closed, open } = entry.isStreaming
    ? splitOpenFence(tail)
    : { closed: tail, open: undefined }
  const actions = { onOpenLink, onOpenFile, onRefuseLink, onCopy, onInsert, onApply }
  const [isCopied, markCopied] = useCopiedFlag()
  const [isMenuOpen, setMenuOpen] = useState(false)
  const menuArea = useRef<HTMLDivElement>(null)
  const closeMenu = () => {
    setMenuOpen(false)
  }
  const onMenuBlur = useDismiss(menuArea, isMenuOpen, closeMenu)
  return (
    <li
      className="message message-assistant"
      aria-busy={entry.isStreaming}
      data-entry-id={entry.id}
      data-role="assistant"
      onKeyDown={closeOnEscape(isMenuOpen, closeMenu)}
    >
      <span className="tool-dot tool-dot-muted" aria-hidden="true" />
      <div className="message-body">
        {head === '' ? null : <MarkdownView text={head} {...actions} />}
        {closed === '' ? null : <MarkdownView text={closed} {...actions} />}
        {open === undefined ? null : (
          <CodeBlock
            code={open.code}
            language={open.language}
            isOpen
            onCopy={onCopy}
            onInsert={onInsert}
            onApply={onApply}
          />
        )}
        {entry.isStreaming ? <span className="cursor" aria-hidden="true" /> : null}
        {entry.isStreaming ||
        entry.citations === undefined ||
        entry.citations.length === 0 ? null : (
          <Citations
            citations={entry.citations}
            onOpenLink={onOpenLink}
            onRefuseLink={onRefuseLink}
          />
        )}
      </div>
      {entry.isStreaming ? null : (
        <div ref={menuArea} className="response-actions" onBlur={onMenuBlur}>
          <button
            type="button"
            className="rewind-button response-copy"
            aria-label={UI_TEXT.copyResponse}
            title={isCopied ? UI_TEXT.copiedCode : UI_TEXT.copyResponse}
            onClick={() => {
              onCopy(entry.text)
              markCopied()
            }}
          >
            {isCopied ? <CheckIcon /> : <CopyIcon />}
          </button>
          {onReply === undefined ? null : (
            <button
              type="button"
              className="rewind-button response-menu-button"
              aria-label={UI_TEXT.messageActions}
              title={UI_TEXT.messageActions}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={() => {
                setMenuOpen((isOpen) => !isOpen)
              }}
            >
              <MoreIcon />
            </button>
          )}
          {isMenuOpen ? (
            <div className="rewind-menu" role="menu" aria-label={UI_TEXT.messageActions}>
              <button
                type="button"
                role="menuitem"
                className="rewind-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  onReply?.(entry.id)
                }}
              >
                {UI_TEXT.replyToOutput}
              </button>
            </div>
          ) : null}
        </div>
      )}
      {quoteMenu}
    </li>
  )
})

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
        {plural(isOpen ? UI_TEXT.hideHiddenSteps : UI_TEXT.showHiddenSteps, count)}
      </button>
      {isOpen ? <ul className="steps-list">{group.steps.map((step) => render(step))}</ul> : null}
    </li>
  )
}

function OtherRow({
  entry,
}: {
  readonly entry: Exclude<TranscriptEntry, StepEntry | { kind: 'user' | 'assistant' }>
}) {
  switch (entry.kind) {
    case 'subagent': {
      return (
        <li className="activity activity-subagent" data-status={entry.status}>
          <span className="activity-kind">{UI_TEXT.subagentRowLabel}</span>
          <span className="activity-status" dir="auto">
            {[
              entry.objective ?? entry.role ?? UI_TEXT.agentUntitled,
              entry.durationMs === undefined ? undefined : formatDurationMs(entry.durationMs),
              agentStatusLabel(
                entry.status === 'inProgress'
                  ? entry.status
                  : (entry.controlStatus ?? entry.status),
              ),
            ]
              .filter((part) => part !== undefined)
              .join(' · ')}
          </span>
        </li>
      )
    }
    case 'item': {
      return (
        <li className="activity" data-status={entry.status}>
          <span className="activity-kind">{entry.itemKind}</span>
          <span className="activity-status">{entry.text ?? entry.status}</span>
        </li>
      )
    }
    case 'error': {
      return <li className="message message-error-card">{entry.text}</li>
    }
    case 'notice': {
      return <li className={`notice notice-${entry.level}`}>{entry.text}</li>
    }
  }
}

const MemoOtherRow = memo(OtherRow)

function TranscriptList(props: TranscriptProps) {
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
    onCancelQuestion,
    onApply,
    onOpenEditDiff,
    onOpenFile,
    onRefuseLink,
    onFork,
    onRewind,
    onReply,
    quoteMenuEntryId,
    onQuote,
    onCopyQuote,
    onCloseQuoteMenu,
  } = props
  const quoteMenuFor = (entryId: string): ReactNode =>
    quoteMenuEntryId === entryId &&
    onQuote !== undefined &&
    onCopyQuote !== undefined &&
    onCloseQuoteMenu !== undefined ? (
      <QuoteMenu onChoose={onQuote} onCopy={onCopyQuote} onClose={onCloseQuoteMenu} />
    ) : null
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
        onCancelQuestion={onCancelQuestion}
        onOpenEditDiff={onOpenEditDiff}
        onOpenFile={onOpenFile}
        quoteMenu={quoteMenuFor(entry.id)}
      />
    )
  const renderEntry = (entry: TranscriptEntry) => {
    switch (entry.kind) {
      case 'user': {
        return (
          <UserCard
            key={entry.id}
            entry={entry}
            onFork={onFork}
            onRewind={onRewind}
            quoteMenu={quoteMenuFor(entry.id)}
          />
        )
      }
      case 'assistant': {
        return (
          <AssistantRow
            key={entry.id}
            entry={entry}
            onOpenLink={onOpenLink}
            onOpenFile={onOpenFile}
            onRefuseLink={onRefuseLink}
            onCopy={onCopy}
            onInsert={onInsert}
            onApply={onApply}
            onReply={onReply}
            quoteMenu={quoteMenuFor(entry.id)}
          />
        )
      }
      case 'reasoning':
      case 'tool': {
        return renderStep(entry)
      }
      default: {
        return <MemoOtherRow key={entry.id} entry={entry} />
      }
    }
  }
  return (
    <ol className="transcript" aria-label={UI_TEXT.transcriptLabel}>
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

/** Memoised: a render of the app that changes none of its props renders no row (M25). */
export const Transcript = memo(TranscriptList)
