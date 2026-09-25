// One tool call: status dot, label, argument summary, change line, and a
// collapsible body (shell IN/OUT, edit diff, read output, or generic
// args/output), plus the approval or question card when the host is waiting.

import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  OUTPUT_PREVIEW_CHARS,
  OUTPUT_PREVIEW_LINES,
  PATCH_DOCUMENT_MAX_PAGES,
  TOOL_STATUS_INTERRUPTED,
  UI_TEXT,
} from '../../shared/constants'
import type { LineRange } from '../../shared/protocol'
import { type DiffRow, type FileDiff, parsePatchDocument, parseUnifiedText } from '../diff'
import { isFailedStatus, type OutputPage, type TranscriptEntry } from '../state/uiState'
import { changeSummary, describeTool, writtenContent } from '../toolPresentation'
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'
import { ExpandChevron } from './icons'
import { QuestionCard, type QuestionCardProps } from './QuestionCard'

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>

export interface ToolRowProps {
  readonly entry: ToolEntry
  readonly patchPage: OutputPage | undefined
  readonly onReadOutput: (itemId: string, outputRef: string, offsetBytes: number) => void
  /** The whole output as an editor tab (M15): the stored output when there is a ref. */
  readonly onOpenOutput: (
    itemId: string,
    label: string,
    text: string,
    outputRef: string | undefined,
  ) => void
  readonly onDecide: ApprovalCardProps['onDecide']
  readonly onAnswer: QuestionCardProps['onAnswer']
  readonly onCancelQuestion: QuestionCardProps['onCancel']
  /** Edit review (M5): the stored patch of a completed edit-family item in the diff editor. */
  readonly onOpenEditDiff: (itemId: string, outputRef: string) => void
  /** The row's path: the file at its change (M16). */
  readonly onOpenFile: (path: string, range: LineRange | undefined) => void
  /** The highlighted-text menu when it belongs to this row (M17). */
  readonly quoteMenu: ReactNode
}

/** The lines an edit changed, from its diff rows: the added lines, else the first line shown. */
function changedRange(rows: readonly DiffRow[] | undefined): LineRange | undefined {
  if (rows === undefined) {
    return undefined
  }
  const added = rows.filter((row) => row.kind === 'add' && row.newLine !== undefined)
  const first = added[0]?.newLine ?? rows.find((row) => row.newLine !== undefined)?.newLine
  const last = added.at(-1)?.newLine ?? first
  return first === undefined || last === undefined ? undefined : { startLine: first, endLine: last }
}

/** The rows of an edit: the fetched patch (the file the row names) or the visible diff. */
function editRows(
  entry: ToolEntry,
  files: readonly FileDiff[] | undefined,
  filePath: string,
): readonly DiffRow[] | undefined {
  const file = files?.find((candidate) => candidate.path === filePath) ?? files?.[0]
  return file?.rows ?? parseUnifiedText(entry.output)
}

function statusClass(entry: ToolEntry): string {
  if (entry.status === 'inProgress') {
    return 'tool-dot tool-dot-running'
  }
  if (entry.status === TOOL_STATUS_INTERRUPTED) {
    return 'tool-dot tool-dot-muted'
  }
  return entry.status === 'completed' ? 'tool-dot tool-dot-ok' : 'tool-dot tool-dot-failed'
}

/** A block that opens something on click or Enter/Space, as Claude Code's outputs do (M15). */
function Openable({
  onOpen,
  children,
}: {
  readonly onOpen: () => void
  readonly children: ReactNode
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="tool-open"
      title={UI_TEXT.openOutputTitle}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        event.preventDefault()
        onOpen()
      }}
    >
      {children}
    </div>
  )
}

/** Text clipped to the preview line and character counts, with a Show more toggle. */
function Clipped({
  text,
  className,
  onOpen,
}: {
  readonly text: string
  readonly className: string
  readonly onOpen?: (() => void) | undefined
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const allLines = text.split('\n')
  const isLong = allLines.length > OUTPUT_PREVIEW_LINES || text.length > OUTPUT_PREVIEW_CHARS
  const firstLines = allLines.slice(0, OUTPUT_PREVIEW_LINES).join('\n')
  const preview =
    firstLines.length > OUTPUT_PREVIEW_CHARS
      ? `${firstLines.slice(0, OUTPUT_PREVIEW_CHARS)}…`
      : firstLines
  const shown = isExpanded || !isLong ? text : preview
  const pre = <pre className="tool-pre">{shown}</pre>
  return (
    <div className={className}>
      {onOpen === undefined ? pre : <Openable onOpen={onOpen}>{pre}</Openable>}
      {isLong ? (
        <button
          type="button"
          className="tool-more"
          onClick={() => {
            setIsExpanded(!isExpanded)
          }}
        >
          {isExpanded ? UI_TEXT.showLess : UI_TEXT.showMore}
        </button>
      ) : null}
    </div>
  )
}

/**
 * A diff clipped to the preview line count behind "Click to expand" (M15):
 * with `onExpand` the click opens the real file in the diff editor (as
 * Claude Code's expands into an editor); without it the rows unfold inline.
 */
function DiffTable({
  rows,
  onExpand,
}: {
  readonly rows: readonly DiffRow[]
  readonly onExpand?: (() => void) | undefined
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isLong = rows.length > OUTPUT_PREVIEW_LINES
  const shown = isExpanded || !isLong ? rows : rows.slice(0, OUTPUT_PREVIEW_LINES)
  return (
    <div className="diff-clip">
      <table className="diff">
        <tbody>
          {shown.map((row, index) => (
            <tr key={String(index)} className={`diff-${row.kind}`}>
              <td className="diff-gutter">{row.oldLine ?? ''}</td>
              <td className="diff-gutter">{row.newLine ?? ''}</td>
              <td className="diff-text">{row.kind === 'hunk' ? '⋯' : row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {onExpand !== undefined || (isLong && !isExpanded) ? (
        <button
          type="button"
          className="tool-expand"
          onClick={
            onExpand ??
            (() => {
              setIsExpanded(true)
            })
          }
        >
          {UI_TEXT.clickToExpand}
        </button>
      ) : null}
    </div>
  )
}

function EditBody({
  entry,
  files,
  onExpand,
}: {
  readonly entry: ToolEntry
  readonly files: readonly FileDiff[] | undefined
  readonly onExpand: (() => void) | undefined
}) {
  if (files !== undefined && files.length > 0) {
    return (
      <>
        {files.map((file) => (
          <DiffTable key={file.path} rows={file.rows} onExpand={onExpand} />
        ))}
      </>
    )
  }
  const rows = parseUnifiedText(entry.output)
  if (rows !== undefined) {
    return <DiffTable rows={rows} onExpand={onExpand} />
  }
  const content = writtenContent(entry.args)
  if (content !== undefined) {
    return <Clipped text={content} className="tool-output" onOpen={onExpand} />
  }
  return entry.patchRef === undefined ? null : (
    <p className="tool-loading">{UI_TEXT.loadingOutput}</p>
  )
}

function ShellBody({
  entry,
  command,
  onOpen,
}: {
  readonly entry: ToolEntry
  readonly command: string | undefined
  readonly onOpen: () => void
}) {
  return (
    <div className="shell">
      {command === undefined ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.inLabel}</span>
          <pre className="tool-pre">{command}</pre>
        </div>
      )}
      {entry.output === '' ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.outLabel}</span>
          <Clipped text={entry.output} className="shell-out" onOpen={onOpen} />
        </div>
      )}
    </div>
  )
}

/** "Rejected", "Interrupted" or "Failed" under a row that did not complete. */
function outcomeText(status: string): string {
  if (status === 'rejected') {
    return UI_TEXT.toolRejected
  }
  return status === TOOL_STATUS_INTERRUPTED ? UI_TEXT.toolInterrupted : UI_TEXT.toolFailed
}

/**
 * Fetch the stored patch while the row is open: the first page once, then
 * each next page until the document is whole (M25; a patch past one page of
 * OUTPUT_PAGE_BYTES used to stop at a partial document and fall back to the
 * unnumbered diff), within the host's own page budget.
 */
function usePatchPages(
  entry: ToolEntry,
  isOpen: boolean,
  patchPage: OutputPage | undefined,
  onReadOutput: ToolRowProps['onReadOutput'],
): void {
  const requested = useRef(new Set<number>())
  const hadPage = useRef(false)
  const patchRefId = entry.patchRef?.id
  const hasPage = patchPage !== undefined
  const nextOffset = patchPage === undefined ? 0 : patchPage.nextOffset
  const isWhole = patchPage?.isEof === true
  useEffect(() => {
    const pages = requested.current
    // Pages the reducer dropped (a resumed or forked history) are fetched again.
    if (!hasPage && hadPage.current) {
      pages.clear()
    }
    hadPage.current = hasPage
    if (
      !isOpen ||
      isWhole ||
      patchRefId === undefined ||
      pages.has(nextOffset) ||
      pages.size >= PATCH_DOCUMENT_MAX_PAGES
    ) {
      return
    }
    pages.add(nextOffset)
    onReadOutput(entry.id, patchRefId, nextOffset)
  }, [isOpen, isWhole, hasPage, nextOffset, patchRefId, entry.id, onReadOutput])
}

function ToolRowView({
  entry,
  patchPage,
  onReadOutput,
  onOpenOutput,
  onDecide,
  onAnswer,
  onCancelQuestion,
  onOpenEditDiff,
  onOpenFile,
  quoteMenu,
}: ToolRowProps) {
  const presentation = useMemo(() => describeTool(entry.tool, entry.args), [entry.tool, entry.args])
  const isWaiting = entry.approval !== undefined || entry.question !== undefined
  // Shell and edit rows show their body from the start, as Claude Code's do;
  // read and generic rows open on click (M16).
  const [isOpen, setIsOpen] = useState(
    presentation.body === 'shell' || presentation.body === 'edit',
  )
  const change = changeSummary(entry.patchSummary)
  const isFailed = isFailedStatus(entry.status) || entry.status === TOOL_STATUS_INTERRUPTED
  // A finished edit with a stored patch can be reviewed in the editor.
  const reviewRef =
    presentation.body === 'edit' && entry.status === 'completed' ? entry.patchRef : undefined
  usePatchPages(entry, isOpen, patchPage, onReadOutput)
  // Parsed once per page, not per render (M25); a partial document parses to nothing.
  const patchContent = patchPage?.isEof === true ? patchPage.content : undefined
  const files = useMemo(
    () => (patchContent === undefined ? undefined : parsePatchDocument(patchContent)),
    [patchContent],
  )
  const toggle = () => {
    setIsOpen(!isOpen)
  }
  const filePath =
    presentation.summary !== '' && (presentation.body === 'edit' || presentation.body === 'read')
      ? presentation.summary
      : undefined
  const openFile = () => {
    if (filePath === undefined) {
      return
    }
    const range =
      presentation.body === 'edit' ? changedRange(editRows(entry, files, filePath)) : undefined
    onOpenFile(filePath, range)
  }
  const openOutput = () => {
    onOpenOutput(entry.id, presentation.label, entry.output, entry.outputRef?.id)
  }
  const openReview =
    reviewRef === undefined
      ? undefined
      : () => {
          onOpenEditDiff(entry.id, reviewRef.id)
        }
  let body
  switch (presentation.body) {
    case 'shell': {
      body = <ShellBody entry={entry} command={presentation.command} onOpen={openOutput} />
      break
    }
    case 'edit': {
      body = <EditBody entry={entry} files={files} onExpand={openReview} />
      break
    }
    case 'read': {
      body =
        entry.output === '' ? null : (
          <Clipped text={entry.output} className="tool-output" onOpen={openOutput} />
        )
      break
    }
    case 'question': {
      body = null
      break
    }
    case 'generic': {
      body = (
        <>
          {entry.args === '' ? null : <Clipped text={entry.args} className="tool-output" />}
          {entry.output === '' ? null : (
            <Clipped text={entry.output} className="tool-output" onOpen={openOutput} />
          )}
        </>
      )
      break
    }
  }
  const hasBody = body !== null
  return (
    <li
      className={isWaiting ? 'tool tool-waiting' : 'tool'}
      data-status={entry.status}
      data-entry-id={entry.id}
      data-role="tool"
    >
      <div className="tool-header">
        <button
          type="button"
          className="tool-toggle"
          aria-expanded={isOpen}
          disabled={!hasBody}
          onClick={toggle}
        >
          <span className={statusClass(entry)} aria-hidden="true" />
          <span className="tool-label">{presentation.label}</span>
          {entry.isBackground ? <span className="badge">{UI_TEXT.backgroundBadge}</span> : null}
          {filePath !== undefined || presentation.summary === '' ? null : (
            <span className="tool-summary">{presentation.summary}</span>
          )}
        </button>
        {filePath === undefined ? null : (
          <button
            type="button"
            className="tool-path"
            title={UI_TEXT.openFileTitle}
            onClick={openFile}
          >
            {filePath}
          </button>
        )}
        {hasBody ? (
          <button
            type="button"
            className="tool-chevron"
            aria-label={UI_TEXT.toggleDetails}
            aria-expanded={isOpen}
            onClick={toggle}
          >
            <ExpandChevron isOpen={isOpen} />
          </button>
        ) : null}
      </div>
      {change === undefined ? null : <div className="tool-change">{change}</div>}
      {isFailed ? (
        <div className="tool-failure">
          {outcomeText(entry.status)}
          {entry.failureReason === undefined ? '' : `: ${entry.failureReason}`}
        </div>
      ) : null}
      {isOpen ? <div className="tool-body">{body}</div> : null}
      {entry.approval === undefined ? null : (
        // Keyed by stage so feedback typed for one stage never rides on the next (M25).
        <ApprovalCard
          key={`${entry.approval.approvalId}:${String(entry.approval.requirementId.sourceIndex)}`}
          approval={entry.approval}
          toolName={entry.tool}
          onDecide={onDecide}
        />
      )}
      {entry.approvalOutcome === undefined ? null : (
        <div className="tool-outcome">
          {UI_TEXT.approvalDecided}: {entry.approvalOutcome.decision} (
          {entry.approvalOutcome.resolvedBy})
        </div>
      )}
      {entry.question === undefined ? null : (
        <QuestionCard question={entry.question} onAnswer={onAnswer} onCancel={onCancelQuestion} />
      )}
      {entry.questionOutcome === undefined ? null : (
        <div className="tool-outcome">
          {entry.questionOutcome.answers.length === 0
            ? UI_TEXT.questionCancelled
            : `${UI_TEXT.questionAnswered}: ${entry.questionOutcome.answers
                .map(
                  (answer) =>
                    answer.selectedLabel ??
                    answer.selectedLabels?.join(', ') ??
                    answer.freeText ??
                    '',
                )
                .join('; ')}`}
        </div>
      )}
      {quoteMenu}
    </li>
  )
}

/** Memoised (M25): a row renders only when its entry, its patch page or its menu changes. */
export const ToolRow = memo(ToolRowView)
