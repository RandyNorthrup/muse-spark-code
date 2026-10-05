// The conversation: user cards with their image chips, assistant markdown,
// reasoning rows, tool rows (with approval / question cards), generic items,
// errors and notices, and the status line while a turn runs. Focus view
// collapses tool and reasoning rows behind one expandable row per run.
//
// Every row is memoised and every callback the app passes is stable (M25), so
// a keystroke in the composer renders no row and a streamed delta renders
// only the row it changes. The rows carry no alert roles: the app's single
// live region reads failures and turn ends out once (M25).

import { memo, type ReactNode, useDeferredValue, useMemo, useRef, useState } from 'react'
import type { CitationSummary, QuestionAnswer } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import { formatTokenWindow } from '../../shared/palette'
import { formatUsd } from '../../core/usage/insights'
import { hasFileAttachment } from '../state/transcriptEntries'
import {
  forkCutBefore,
  type OutputPage,
  outputPageKey,
  type TranscriptEntry,
} from '../state/uiState'
import type { NoticeAction } from '../../shared/protocol'
import { splitForStreaming, splitOpenFence } from '../streamSplit'
import { useDismiss } from '../useDismiss'
import { agentStatusLabel, formatDurationMs } from '../agentFormat'
import { useCopiedFlag } from '../useCopiedFlag'
import { CodeBlock } from './CodeBlock'
import { ExternalLink } from './ExternalLink'
import { CheckIcon, CopyIcon, FileIcon, ImageIcon, MoreIcon, ReplyIcon, RewindIcon } from './icons'
import { type QuoteIntent, QuoteMenu } from './QuoteMenu'
import { MarkdownView } from './MarkdownView'
import { ReasoningRow } from './ReasoningRow'
import { StatusLine } from './StatusLine'
import { ToolRow, type ToolRowProps } from './ToolRow'
import { UserShellRow } from './UserShellRow'
import { WorkflowRunView } from './WorkflowRun'
import { PaidBadge } from './PaidBadge'

export interface TranscriptProps {
  readonly entries: readonly TranscriptEntry[]
  readonly isRunning: boolean
  readonly isFocusView: boolean
  readonly outputPages: Readonly<Record<string, OutputPage>>
  /** Pictures loaded for tool rows (M43). */
  readonly toolImages: ToolRowProps['toolImages']
  readonly onReadImage: ToolRowProps['onReadImage']
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
  /**
   * Code block Insert; absent, with Apply, in a conversation that holds
   * imported history (M84): someone else's file never writes into the editor.
   */
  readonly onInsert: ((text: string) => void) | undefined
  readonly onReadOutput: (itemId: string, outputRef: string, offsetBytes: number) => void
  /** A tool output as an editor tab (M15). */
  readonly onOpenOutput: ToolRowProps['onOpenOutput']
  readonly onAnswer: (userInputId: string, answers: readonly QuestionAnswer[]) => void
  /** The question card's Cancel (M16), and its Explain instead (M46). */
  readonly onCancelQuestion: (userInputId: string) => void
  readonly onClarifyQuestion: ToolRowProps['onClarifyQuestion']
  /** An elicitation form's Send, Decline and Cancel (M91 lane M). */
  readonly onAcceptElicitation: ToolRowProps['onAcceptElicitation']
  readonly onDeclineElicitation: ToolRowProps['onDeclineElicitation']
  readonly onCancelElicitation: ToolRowProps['onCancelElicitation']
  /** A running command to the background, a task's Stop (M46). */
  readonly onMoveToBackground: ToolRowProps['onMoveToBackground']
  readonly onStopTask: ToolRowProps['onStopTask']
  /** The backend stops the user's own `!` commands (M46). */
  readonly canStopUserShell: boolean
  /** Code block Apply (M5); absent as `onInsert` is. */
  readonly onApply: ((text: string) => void) | undefined
  readonly onOpenEditDiff: (itemId: string, outputRef: string) => void
  /** A tool row's path, or a reply's relative link: the file (M16, M25). */
  readonly onOpenFile: ToolRowProps['onOpenFile']
  /** A reply's link to a file outside the workspace (M25). */
  readonly onRefuseLink?: (() => void) | undefined
  /** The user card's menu (M6, M13); absent while no session exists. */
  readonly onFork?: ((entryId: string) => void) | undefined
  readonly onRewind?: ((entryId: string) => void) | undefined
  /** "Fork conversation and rewind code": one host action, the rewind then the fork (M72). */
  readonly onForkRewind?: ((entryId: string) => void) | undefined
  readonly onRewindConversation?: ((entryId: string) => void) | undefined
  /**
   * Turn checkpoints (M72): the turns with one, their card's "Restore files"
   * and "Rewind conversation and restore files", and a restore's Redo.
   */
  readonly checkpointTurnIds?: ReadonlySet<string> | undefined
  readonly legacyCheckpointTurnIds?: ReadonlySet<string> | undefined
  readonly onRestoreFiles?: ((entryId: string) => void) | undefined
  readonly onRestoreBoth?: ((entryId: string) => void) | undefined
  readonly onRedo?: ((entryId: string, restoreId: string) => void) | undefined
  /** A Muse Code fault's way on (D26): Restart now, New conversation. */
  readonly onNoticeAction?: ((entryId: string, action: NoticeAction) => void) | undefined
  /** Why the menu offers no file restore (Restricted Mode, the setting), or none. */
  readonly restoreNote?: string | undefined
  /** Why the menu offers no conversation rewind (Muse Code on Windows, D26), or none. */
  readonly conversationNote?: string | undefined
  /** A still-running turn has no settled replay for a steered user card. */
  readonly activeTurnId?: string | undefined
  /** A reply's actions menu (M17); absent while no session exists. */
  readonly onReply?: ((entryId: string) => void) | undefined
  /** Tokens and the dollar estimate under each reply (M82, Model API only). */
  readonly showReplyUsage: boolean
  /** The latest Plan-mode reply, which carries the plan's actions (M79). */
  readonly planReplyId?: string | undefined
  readonly onSavePlan?: ((entryId: string) => void) | undefined
  /** Absent where a plan cannot be implemented (a side chat). */
  readonly onImplementPlan?: ((entryId: string) => void) | undefined
  /** The row whose highlighted text has the Copy / Ask / Comment menu open (M17). */
  readonly quoteMenuEntryId?: string | undefined
  readonly onQuote?: ((intent: QuoteIntent) => void) | undefined
  readonly onCopyQuote?: (() => void) | undefined
  readonly onCloseQuoteMenu?: (() => void) | undefined
}

type RewindChoice = 'fork' | 'conversation' | 'restore' | 'rewind' | 'restoreBoth' | 'forkRewind'

/**
 * The rows of the user card's menu, in Claude Code's order. A turn with a
 * checkpoint (M72) offers "Restore files" and the conversation rewind with
 * it; one without keeps M13's fork and code rewind together.
 */
function rewindMenu(): readonly { readonly id: RewindChoice; readonly label: string }[] {
  return [
    { id: 'fork', label: UI_TEXT.forkFromHere },
    { id: 'conversation', label: UI_TEXT.rewindConversationToHere },
    { id: 'restore', label: UI_TEXT.restoreFilesToHere },
    { id: 'rewind', label: UI_TEXT.rewindCodeToHere },
    { id: 'restoreBoth', label: UI_TEXT.rewindAndRestore },
    { id: 'forkRewind', label: UI_TEXT.forkAndRewind },
  ]
}

/** The first user card of each turn: the one a turn's checkpoint belongs to (M72). */
function turnOpeners(entries: readonly TranscriptEntry[]): ReadonlySet<string> {
  const seen = new Set<string>()
  const openers = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'user' || entry.turnId === undefined || seen.has(entry.turnId)) {
      continue
    }

    seen.add(entry.turnId)
    openers.add(entry.id)
  }
  return openers
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
  onForkRewind,
  onRewindConversation,
  onRestoreFiles,
  onRestoreBoth,
  restoreNote,
  conversationNote,
  quoteMenu,
}: {
  readonly entry: Extract<TranscriptEntry, { kind: 'user' }>
  readonly onFork: ((entryId: string) => void) | undefined
  readonly onRewind: ((entryId: string) => void) | undefined
  readonly onForkRewind: ((entryId: string) => void) | undefined
  readonly onRewindConversation: ((entryId: string) => void) | undefined
  readonly onRestoreFiles: ((entryId: string) => void) | undefined
  readonly onRestoreBoth: ((entryId: string) => void) | undefined
  readonly restoreNote: string | undefined
  readonly conversationNote: string | undefined
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
  const offered: Readonly<Record<RewindChoice, boolean>> = {
    fork: onFork !== undefined,
    conversation: onRewindConversation !== undefined,
    restore: onRestoreFiles !== undefined,
    rewind: true,
    restoreBoth: onRestoreBoth !== undefined,
    forkRewind: onForkRewind !== undefined && onRestoreFiles === undefined,
  }
  const menuRows = rewindMenu().filter((row) => offered[row.id])
  const notes = [restoreNote, conversationNote].filter((note) => note !== undefined)
  const choose = (choice: RewindChoice) => {
    setMenuOpen(false)
    switch (choice) {
      case 'conversation': {
        onRewindConversation?.(entry.id)
        break
      }
      case 'restore': {
        onRestoreFiles?.(entry.id)
        break
      }
      case 'restoreBoth': {
        onRestoreBoth?.(entry.id)
        break
      }
      case 'fork': {
        onFork?.(entry.id)
        break
      }
      case 'rewind': {
        onRewind?.(entry.id)
        break
      }
      case 'forkRewind': {
        onForkRewind?.(entry.id)
        break
      }
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
              {attachment.width === undefined ? <FileIcon /> : <ImageIcon />}
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
              {notes.map((note) => (
                <div
                  key={note}
                  role="menuitem"
                  aria-disabled="true"
                  className="rewind-menu-item rewind-menu-note"
                >
                  {note}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {quoteMenu}
    </li>
  )
})

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
            <ExternalLink
              url={citation.url}
              title={citation.title}
              onOpenLink={onOpenLink}
              onRefuseLink={onRefuseLink}
            />
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
  /** Absent in a conversation that holds imported history (M84). */
  readonly onInsert: ((text: string) => void) | undefined
  readonly onApply: ((text: string) => void) | undefined
  /** The actions menu's "Reply to this output" (M17); absent while no session exists. */
  readonly onReply: ((entryId: string) => void) | undefined
  /** Tokens and the dollar estimate under the reply (M82); hidden while off. */
  readonly showReplyUsage: boolean
  /** The plan's actions under the latest Plan-mode reply (M79); absent elsewhere. */
  readonly onSavePlan: ((entryId: string) => void) | undefined
  readonly onImplementPlan: ((entryId: string) => void) | undefined
  /** The highlighted-text menu when it belongs to this row (M17). */
  readonly quoteMenu: ReactNode
}

/** "Save plan" and "Implement in a fresh conversation" under a Plan-mode reply (M79). */
function PlanActions({
  entryId,
  onSavePlan,
  onImplementPlan,
}: {
  readonly entryId: string
  readonly onSavePlan: (entryId: string) => void
  readonly onImplementPlan: ((entryId: string) => void) | undefined
}) {
  return (
    <div className="plan-actions" role="group" aria-label={UI_TEXT.planActionsLabel}>
      <button
        type="button"
        className="button-secondary"
        onClick={() => {
          onSavePlan(entryId)
        }}
      >
        {UI_TEXT.savePlan}
      </button>
      {onImplementPlan === undefined ? null : (
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            onImplementPlan(entryId)
          }}
        >
          {UI_TEXT.implementPlan}
        </button>
      )}
    </div>
  )
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
  showReplyUsage,
  onSavePlan,
  onImplementPlan,
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
        {closed === '' ? null : (
          // The reply a plan action would save is shown as its brief would read (M79).
          <MarkdownView text={closed} {...actions} isPlan={onSavePlan !== undefined} />
        )}
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
        {showReplyUsage && entry.usage !== undefined && entry.costUsd !== undefined ? (
          <div className="response-usage">
            {fill(UI_TEXT.replyUsage, {
              input: formatTokenWindow(entry.usage.inputTokens),
              output: formatTokenWindow(entry.usage.outputTokens),
              cost: formatUsd(entry.costUsd),
            })}
          </div>
        ) : null}
        {onSavePlan === undefined || entry.isStreaming ? null : (
          <PlanActions
            entryId={entry.id}
            onSavePlan={onSavePlan}
            onImplementPlan={onImplementPlan}
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

/**
 * A workflow run's card (M47): it stays in its place and keeps changing
 * after the turn that launched it ends, as the run goes on in the background.
 */
const WorkflowRow = memo(function WorkflowRow({
  entry,
}: {
  readonly entry: Extract<TranscriptEntry, { kind: 'workflow' }>
}) {
  return (
    <li
      className="workflow"
      data-status={entry.status}
      data-entry-id={entry.id}
      data-role="workflow"
    >
      <WorkflowRunView entry={entry} />
    </li>
  )
})

function OtherRow({
  entry,
}: {
  readonly entry: Exclude<
    TranscriptEntry,
    StepEntry | { kind: 'user' | 'assistant' | 'userShell' | 'workflow' }
  >
}) {
  switch (entry.kind) {
    case 'subagent': {
      return (
        <li className="activity activity-subagent" data-status={entry.status}>
          <span className="activity-kind">{UI_TEXT.subagentRowLabel}</span>
          {entry.paid === undefined ? null : <PaidBadge feature={entry.paid} />}
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
      return (
        <li className={`notice notice-${entry.level}`}>
          {entry.text}
          <RepeatCount count={entry.repeatCount} />
        </li>
      )
    }
  }
}

/**
 * How many times a notice was said (D26): a small muted count after its
 * text, read out in words, as the count's glyph alone says little.
 */
function RepeatCount({ count }: { readonly count: number | undefined }) {
  if (count === undefined) {
    return null
  }
  const label = plural(UI_TEXT.noticeRepeated, count)
  return (
    <>
      {' '}
      <span className="notice-repeat" title={label} aria-hidden="true">
        {fill(UI_TEXT.noticeRepeatBadge, { count })}
      </span>
      <span className="sr-only">{label}</span>
    </>
  )
}

const MemoOtherRow = memo(OtherRow)

/**
 * A file restore's notice with its Redo (M72): unavailable while the host
 * answers, gone once spent, kept when a file could not be put back yet.
 */
const RestoreNotice = memo(function RestoreNotice({
  entry,
  restoreId,
  onRedo,
}: {
  readonly entry: Extract<TranscriptEntry, { kind: 'notice' }>
  readonly restoreId: string
  readonly onRedo: (entryId: string, restoreId: string) => void
}) {
  return (
    <li className={`notice notice-${entry.level}`}>
      {entry.text}
      {entry.isRedoUsed === true ? null : (
        <button
          type="button"
          className="notice-action"
          title={UI_TEXT.redoLabel}
          aria-label={UI_TEXT.redoLabel}
          disabled={entry.isRedoPending === true}
          onClick={() => {
            onRedo(entry.id, restoreId)
          }}
        >
          {UI_TEXT.redoAction}
        </button>
      )}
    </li>
  )
})

/** A button's label for each way on a notice offers. */
function noticeActionLabel(action: NoticeAction): string {
  switch (action) {
    case 'restartMuseCode': {
      return UI_TEXT.restartNow
    }
    case 'newConversation': {
      return UI_TEXT.newConversationTitle
    }
    case 'installBundledSkills': {
      return UI_TEXT.bundledSkillsInstall
    }
    case 'updateBundledSkills': {
      return UI_TEXT.bundledSkillsUpdate
    }
    case 'declineBundledSkills': {
      return UI_TEXT.bundledSkillsNotNow
    }
  }
}

/** A notice with its ways on (D26, M89): one button per action. */
const ActionNotice = memo(function ActionNotice({
  entry,
  actions,
  onAction,
}: {
  readonly entry: Extract<TranscriptEntry, { kind: 'notice' }>
  readonly actions: readonly NoticeAction[]
  readonly onAction: (entryId: string, action: NoticeAction) => void
}) {
  const spent = useRef(false)
  const [isSpent, setIsSpent] = useState(false)
  return (
    <li className={`notice notice-${entry.level}`}>
      {entry.text}
      <RepeatCount count={entry.repeatCount} />
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          className="notice-action"
          disabled={isSpent}
          onClick={() => {
            if (spent.current) {
              return
            }
            spent.current = true
            setIsSpent(true)
            onAction(entry.id, action)
          }}
        >
          {noticeActionLabel(action)}
        </button>
      ))}
    </li>
  )
})

function TranscriptList(props: TranscriptProps) {
  const {
    entries,
    isRunning,
    isFocusView,
    outputPages,
    toolImages,
    onReadImage,
    onOpenLink,
    onCopy,
    onInsert,
    onReadOutput,
    onOpenOutput,
    onAnswer,
    onCancelQuestion,
    onClarifyQuestion,
    onAcceptElicitation,
    onDeclineElicitation,
    onCancelElicitation,
    onMoveToBackground,
    onStopTask,
    canStopUserShell,
    onApply,
    onOpenEditDiff,
    onOpenFile,
    onRefuseLink,
    onFork,
    onRewind,
    onForkRewind,
    onRewindConversation,
    checkpointTurnIds,
    legacyCheckpointTurnIds,
    onRestoreFiles,
    onRestoreBoth,
    onRedo,
    onNoticeAction,
    restoreNote,
    conversationNote,
    activeTurnId,
    onReply,
    showReplyUsage,
    planReplyId,
    onSavePlan,
    onImplementPlan,
    quoteMenuEntryId,
    onQuote,
    onCopyQuote,
    onCloseQuoteMenu,
  } = props
  const openers = useMemo(() => turnOpeners(entries), [entries])
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
        isRunning={isRunning}
        patchPage={
          entry.patchRef === undefined
            ? undefined
            : outputPages[outputPageKey(entry.id, entry.patchRef.id)]
        }
        onReadOutput={onReadOutput}
        onOpenOutput={onOpenOutput}
        onAnswer={onAnswer}
        onCancelQuestion={onCancelQuestion}
        onClarifyQuestion={onClarifyQuestion}
        onAcceptElicitation={onAcceptElicitation}
        onDeclineElicitation={onDeclineElicitation}
        onCancelElicitation={onCancelElicitation}
        onOpenEditDiff={onOpenEditDiff}
        onOpenFile={onOpenFile}
        onOpenLink={onOpenLink}
        onRefuseLink={onRefuseLink}
        toolImages={toolImages}
        onReadImage={onReadImage}
        onMoveToBackground={onMoveToBackground}
        onStopTask={onStopTask}
        quoteMenu={quoteMenuFor(entry.id)}
      />
    )
  const renderEntry = (entry: TranscriptEntry) => {
    switch (entry.kind) {
      case 'user': {
        const canForkHere = forkCutBefore(entries, entry.id) !== undefined
        const canRewindHere =
          canForkHere && entry.turnId !== activeTurnId && !hasFileAttachment(entry.attachments)
        const hasCheckpoint =
          entry.turnId !== undefined &&
          checkpointTurnIds?.has(entry.turnId) === true &&
          openers.has(entry.id)
        return (
          <UserCard
            key={entry.id}
            entry={entry}
            onFork={canForkHere ? onFork : undefined}
            onRewind={onRewind}
            onForkRewind={canForkHere ? onForkRewind : undefined}
            onRewindConversation={canRewindHere ? onRewindConversation : undefined}
            onRestoreFiles={hasCheckpoint ? onRestoreFiles : undefined}
            onRestoreBoth={hasCheckpoint && canRewindHere ? onRestoreBoth : undefined}
            restoreNote={
              !hasCheckpoint &&
              entry.turnId !== undefined &&
              legacyCheckpointTurnIds?.has(entry.turnId) === true
                ? UI_TEXT.checkpointsLegacyReadOnly
                : restoreNote
            }
            conversationNote={conversationNote}
            quoteMenu={quoteMenuFor(entry.id)}
          />
        )
      }
      case 'assistant': {
        const isPlanReply = entry.id === planReplyId
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
            showReplyUsage={showReplyUsage}
            onSavePlan={isPlanReply ? onSavePlan : undefined}
            onImplementPlan={isPlanReply ? onImplementPlan : undefined}
            quoteMenu={quoteMenuFor(entry.id)}
          />
        )
      }
      case 'reasoning':
      case 'tool': {
        return renderStep(entry)
      }
      case 'userShell': {
        return (
          <UserShellRow
            key={entry.id}
            entry={entry}
            canStop={canStopUserShell}
            onOpenOutput={onOpenOutput}
            onStopTask={onStopTask}
          />
        )
      }
      case 'workflow': {
        return <WorkflowRow key={entry.id} entry={entry} />
      }
      case 'notice': {
        if (onNoticeAction !== undefined && entry.actions !== undefined) {
          return (
            <ActionNotice
              key={entry.id}
              entry={entry}
              actions={entry.actions}
              onAction={onNoticeAction}
            />
          )
        }
        return onRedo === undefined || entry.redoRestoreId === undefined ? (
          <MemoOtherRow key={entry.id} entry={entry} />
        ) : (
          <RestoreNotice
            key={entry.id}
            entry={entry}
            restoreId={entry.redoRestoreId}
            onRedo={onRedo}
          />
        )
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
