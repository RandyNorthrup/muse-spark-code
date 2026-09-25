// One tool call: status dot, label, argument summary, change line, and a
// collapsible body (shell IN/OUT, edit diff, read output, a memory note, a
// goal, scheduled prompts, search results, or generic args/output), the
// picture a tool read or made, plus the approval or question card when the
// host is waiting.

import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { PATCH_DOCUMENT_MAX_PAGES, TOOL_STATUS_INTERRUPTED, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { paidFeaturePrice } from '../../shared/paid'
import type { LineRange } from '../../shared/protocol'
import { type DiffRow, type FileDiff, parsePatchDocument, parseUnifiedText } from '../diff'
import {
  isFailedStatus,
  type OutputPage,
  type ToolImageState,
  toolImageKey,
  type TranscriptEntry,
} from '../state/uiState'
import { backgroundRun, readableText } from '../toolDetails'
import { changeSummary, describeTool, writtenContent } from '../toolPresentation'
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'
import { ExpandChevron } from './icons'
import { QuestionCard, type QuestionCardProps } from './QuestionCard'
import { Clipped, DiffTable } from './ToolBlocks'
import { GoalBody, ImageBody, MemoryBody, ScheduleBody, ToolImage, WebBody } from './ToolBodies'

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
  /** A search result's page (M43), opened as a reply's links are. */
  readonly onOpenLink: (url: string) => void
  readonly onRefuseLink: (() => void) | undefined
  /** The pictures the host has loaded for tool rows (M43), by `toolImageKey`. */
  readonly toolImages: Readonly<Record<string, ToolImageState>>
  readonly onReadImage: (itemId: string, path: string) => void
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

/**
 * A shell call's IN and OUT. One Muse Code moved to the background answers
 * with JSON about the run instead of the command's text (M43): its OUT is
 * what the command printed so far, and a line says it still runs.
 */
function ShellBody({
  entry,
  command,
  onOpen,
}: {
  readonly entry: ToolEntry
  readonly command: string | undefined
  readonly onOpen: () => void
}) {
  const run = backgroundRun(entry.output)
  const output = run === undefined ? entry.output : run.output
  return (
    <div className="shell">
      {command === undefined ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.inLabel}</span>
          <pre className="tool-pre">{command}</pre>
        </div>
      )}
      {output === '' ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.outLabel}</span>
          <Clipped text={output} className="shell-out" onOpen={onOpen} />
        </div>
      )}
      {run?.isRunning === true && entry.status === 'inProgress' ? (
        <p className="tool-detail-meta">{UI_TEXT.backgroundRunning}</p>
      ) : null}
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

/** The pictures the row shows: the one its path names, then any the tool reported (M43). */
function imagePathsOf(entry: ToolEntry, imagePath: string | undefined): readonly string[] {
  const reported = entry.images ?? []
  return [...new Set(imagePath === undefined ? reported : [imagePath, ...reported])]
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
  onOpenLink,
  onRefuseLink,
  toolImages,
  onReadImage,
  quoteMenu,
}: ToolRowProps) {
  const presentation = useMemo(() => describeTool(entry.tool, entry.args), [entry.tool, entry.args])
  const imagePaths = imagePathsOf(entry, presentation.imagePath)
  const isWaiting = entry.approval !== undefined || entry.question !== undefined
  // Shell and edit rows show their body from the start, as Claude Code's do,
  // and so does a row with a picture (M43); the others open on click (M16).
  const [isOpen, setIsOpen] = useState(
    presentation.body === 'shell' || presentation.body === 'edit' || imagePaths.length > 0,
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
  let body: ReactNode
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
    case 'memory': {
      body = <MemoryBody entry={entry} />
      break
    }
    case 'goal': {
      body = <GoalBody entry={entry} />
      break
    }
    case 'schedule': {
      body = <ScheduleBody entry={entry} />
      break
    }
    case 'web': {
      body = <WebBody entry={entry} onOpenLink={onOpenLink} onRefuseLink={onRefuseLink} />
      break
    }
    case 'image': {
      body = <ImageBody entry={entry} />
      break
    }
    case 'generic': {
      body = (
        <>
          {entry.args === '' ? null : (
            <Clipped text={readableText(entry.args)} className="tool-output" />
          )}
          {entry.output === '' ? null : (
            <Clipped
              text={readableText(entry.output)}
              className="tool-output"
              onOpen={openOutput}
            />
          )}
        </>
      )
      break
    }
  }
  const images =
    entry.status === 'completed'
      ? imagePaths.map((imagePath) => (
          <ToolImage
            key={imagePath}
            path={imagePath}
            image={toolImages[toolImageKey(entry.id, imagePath)]}
            onRequest={() => {
              onReadImage(entry.id, imagePath)
            }}
            onOpen={() => {
              onOpenFile(imagePath, undefined)
            }}
          />
        ))
      : []
  const hasBody = body !== null || images.length > 0
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
          {entry.paid === undefined ? null : (
            <span
              className="badge badge-paid"
              title={fill(UI_TEXT.paidRowTitle, { price: paidFeaturePrice(entry.paid) })}
            >
              {UI_TEXT.paidRowBadge}
            </span>
          )}
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
      {isOpen ? (
        <div className="tool-body">
          {body}
          {images}
        </div>
      ) : null}
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
