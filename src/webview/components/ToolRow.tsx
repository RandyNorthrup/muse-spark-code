// One tool call: status dot, label, argument summary, change line (an
// edit's lines, a fetched page's size), and a collapsible body (shell
// IN/OUT, edit diff, read output, a fetched page, a memory note, a goal,
// scheduled prompts, search results, a workflow's script and launch, or
// generic args/output), the
// picture a tool read or made, plus the approval or question card when the
// host is waiting.

import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  IO_PREVIEW_LINES,
  PATCH_DOCUMENT_MAX_PAGES,
  TOOL_STATUS_IN_PROGRESS,
  TOOL_STATUS_INTERRUPTED,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { PaidBadge } from './PaidBadge'
import type { LineRange } from '../../shared/protocol'
import { type DiffRow, type FileDiff, parsePatchDocument, parseUnifiedText } from '../diff'
import {
  failedOutcomeText,
  hasLandedEdits,
  isFailedStatus,
  type OutputPage,
  type ToolImageState,
  toolImageKey,
  type TranscriptEntry,
} from '../state/uiState'
import { backgroundRun, readableText } from '../toolDetails'
import {
  changeSummary,
  describeTool,
  fetchedSize,
  type ToolPresentation,
  writtenContent,
} from '../toolPresentation'
import { CloseIcon, ExpandChevron, FileIcon, RewindIcon } from './icons'
import { type GooeyItem, useRowMenu } from './GooeyMenu'
import type { QuestionCardProps } from './QuestionCard'
import { useAttentionSurface } from './QuestionSurface'
import { DeferredQuestionCard } from './DeferredQuestionUi'
import { ElicitationCard, type ElicitationCardProps } from './ElicitationCard'
import { Clipped, DiffTable } from './ToolBlocks'
import {
  GoalBody,
  ImageBody,
  MemoryBody,
  ScheduleBody,
  ToolImage,
  WebBody,
  WorkflowBody,
} from './ToolBodies'
import { verifySummaryText } from '../../shared/verifyText'
import { ThenRunBlock, VerifyBody } from './VerifyParts'

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>

export interface ToolRowProps {
  readonly entry: ToolEntry
  readonly isRunning: boolean
  readonly patchPage: OutputPage | undefined
  readonly onReadOutput: (itemId: string, outputRef: string, offsetBytes: number) => void
  /** The whole output as an editor tab (M15): the stored output when there is a ref. */
  readonly onOpenOutput: (
    itemId: string,
    label: string,
    text: string,
    outputRef: string | undefined,
  ) => void
  readonly onAnswer: QuestionCardProps['onAnswer']
  readonly onCancelQuestion: QuestionCardProps['onCancel']
  readonly onClarifyQuestion: QuestionCardProps['onClarify']
  readonly onAcceptElicitation: ElicitationCardProps['onAccept']
  readonly onDeclineElicitation: ElicitationCardProps['onDecline']
  readonly onCancelElicitation: ElicitationCardProps['onCancel']
  /** Edit review (M5): the stored patch of a completed edit-family item in the diff editor. */
  readonly onOpenEditDiff: (itemId: string, outputRef: string) => void
  /**
   * The edit's Revert in the row's menu (M87, D66 item 17), after the host's
   * confirmation; absent where nothing may write the workspace's files.
   */
  readonly onRevertEdit?: ((itemId: string, outputRef: string) => void) | undefined
  /** The row's path: the file at its change (M16). */
  readonly onOpenFile: (path: string, range: LineRange | undefined) => void
  /** A search result's page (M43), opened as a reply's links are. */
  readonly onOpenLink: (url: string) => void
  readonly onRefuseLink: (() => void) | undefined
  /** The pictures the host has loaded for tool rows (M43), by `toolImageKey`. */
  readonly toolImages: Readonly<Record<string, ToolImageState>>
  readonly onReadImage: (itemId: string, path: string) => void
  /** A running shell call to the background, and a background task's Stop (M46). */
  readonly onMoveToBackground: (itemId: string) => void
  readonly onStopTask: (itemId: string) => void
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

/** A row's status dot: running, done, cut off or failed (the user's `!` rows too, M46). */
export function statusDotClass(status: string): string {
  if (status === 'inProgress') {
    return 'tool-dot tool-dot-running'
  }
  if (status === TOOL_STATUS_INTERRUPTED) {
    return 'tool-dot tool-dot-muted'
  }
  return status === 'completed' ? 'tool-dot tool-dot-ok' : 'tool-dot tool-dot-failed'
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
          <Clipped text={command} className="shell-out" previewLines={IO_PREVIEW_LINES} />
        </div>
      )}
      {output === '' ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.outLabel}</span>
          <Clipped
            text={output}
            className="shell-out"
            onOpen={onOpen}
            previewLines={IO_PREVIEW_LINES}
          />
        </div>
      )}
      {(run?.isRunning === true || entry.isBackground) && entry.status === 'inProgress' ? (
        <p className="tool-detail-meta">{UI_TEXT.backgroundRunning}</p>
      ) : null}
    </div>
  )
}

/** What a settled question card says: the answers, the explanation given instead (M46), or Cancelled. */
function questionOutcomeText(outcome: NonNullable<ToolEntry['questionOutcome']>): string {
  const labels: Readonly<Record<string, string>> = {
    answered: UI_TEXT.questionAnswered,
    clarified: UI_TEXT.questionClarified,
    cancelled: UI_TEXT.questionDeclined,
    deferred: UI_TEXT.questionDeferred,
  }
  const label = labels[outcome.outcome] ?? outcome.outcome
  if (outcome.clarification !== undefined) {
    return `${label}: ${outcome.clarification}`
  }
  if (outcome.answers.length === 0) {
    return label
  }
  const answers = outcome.answers
    .map(
      (answer) =>
        answer.selectedLabel ?? answer.selectedLabels?.join(', ') ?? answer.freeText ?? '',
    )
    .join('; ')
  return `${label}: ${answers}`
}

/** "Rejected", "Interrupted", "Stopped" (M46) or "Failed" under a row that did not complete. */
function outcomeText(status: string): string {
  return status === TOOL_STATUS_INTERRUPTED ? UI_TEXT.toolInterrupted : failedOutcomeText(status)
}

/**
 * A running shell call's Move to background, or a background task's Stop
 * (M46, PLAN.md D39). Pressed, it waits for the host: the row's next update
 * or a refusal frees it.
 */
function TaskAction({
  entry,
  presentation,
  onMoveToBackground,
  onStopTask,
}: {
  readonly entry: ToolEntry
  readonly presentation: ToolPresentation
  readonly onMoveToBackground: (itemId: string) => void
  readonly onStopTask: (itemId: string) => void
}) {
  if (entry.status !== 'inProgress' || entry.approval !== undefined) {
    return null
  }
  // Named for the row, so it is never mistaken for the composer's Stop.
  const row = `${presentation.label} ${presentation.summary}`.trim()
  if (entry.isBackground) {
    return (
      <button
        type="button"
        className="tool-more tool-task-action"
        aria-label={`${UI_TEXT.stopTask}: ${row}`}
        title={UI_TEXT.stopTaskTitle}
        disabled={entry.taskRequest !== undefined}
        onClick={() => {
          onStopTask(entry.id)
        }}
      >
        {UI_TEXT.stopTask}
      </button>
    )
  }
  return presentation.body === 'shell' ? (
    <button
      type="button"
      className="tool-more tool-task-action"
      aria-label={`${UI_TEXT.moveToBackground}: ${row}`}
      title={UI_TEXT.moveToBackgroundTitle}
      disabled={entry.taskRequest !== undefined}
      onClick={() => {
        onMoveToBackground(entry.id)
      }}
    >
      {UI_TEXT.moveToBackground}
    </button>
  ) : null
}

/**
 * Fetch the stored patch while the row is open: the first page once, then
 * each next page until the document is whole (M25; a patch past one page of
 * OUTPUT_PAGE_BYTES used to stop at a partial document and fall back to the
 * unnumbered diff), within the host's own page budget.
 *
 * Automatic reads wait for the conversation's turn to end, keeping Muse
 * Code's command queue clear for approvals. Reopening a row reads on demand;
 * a missing page gets one more attempt when the turn ends.
 * Only once the edit has finished: Muse Code 1.4.2 names the patch while the
 * edit is still in progress, and a read then can answer "item or attached
 * output ref was not found" (captured 2026-10-02). A page asked for and not
 * come by the time the row is collapsed is asked for again when it is
 * expanded: the retry on demand after a failed or slow read (D26).
 */
function usePatchPages(
  entry: ToolEntry,
  isOpen: boolean,
  isRunning: boolean,
  patchPage: OutputPage | undefined,
  onReadOutput: ToolRowProps['onReadOutput'],
): void {
  const requested = useRef(new Set<number>())
  const hadPage = useRef(false)
  const openState = useRef(isOpen)
  const runningState = useRef(isRunning)
  const openedByUser = useRef(false)
  const patchRefId = entry.patchRef?.id
  const isFinished = entry.status !== TOOL_STATUS_IN_PROGRESS
  const hasPage = patchPage !== undefined
  const nextOffset = patchPage === undefined ? 0 : patchPage.nextOffset
  const isWhole = patchPage?.isEof === true
  useEffect(() => {
    const pages = requested.current
    const didTurnEnd = runningState.current && !isRunning
    if (isRunning && !runningState.current) {
      openedByUser.current = false
    }
    if (openState.current !== isOpen) {
      openedByUser.current = isOpen
    }
    openState.current = isOpen
    runningState.current = isRunning
    // Pages the reducer dropped (a resumed or forked history) are fetched again.
    if (!hasPage && hadPage.current) {
      pages.clear()
    }
    hadPage.current = hasPage
    if (didTurnEnd && !hasPage) {
      pages.delete(nextOffset)
    }
    if (!isOpen) {
      pages.delete(nextOffset)
      return
    }
    if (
      !isFinished ||
      isWhole ||
      patchRefId === undefined ||
      pages.has(nextOffset) ||
      pages.size >= PATCH_DOCUMENT_MAX_PAGES ||
      (isRunning && !openedByUser.current)
    ) {
      return
    }
    pages.add(nextOffset)
    onReadOutput(entry.id, patchRefId, nextOffset)
  }, [
    isOpen,
    isRunning,
    isFinished,
    isWhole,
    hasPage,
    nextOffset,
    patchRefId,
    entry.id,
    onReadOutput,
  ])
}

/** The pictures the row shows: the one its path names, then any the tool reported (M43). */
function imagePathsOf(entry: ToolEntry, imagePath: string | undefined): readonly string[] {
  const reported = entry.images ?? []
  return [...new Set(imagePath === undefined ? reported : [imagePath, ...reported])]
}

function ToolRowView({
  entry,
  isRunning,
  patchPage,
  onReadOutput,
  onOpenOutput,
  onAnswer,
  onCancelQuestion,
  onClarifyQuestion,
  onAcceptElicitation,
  onDeclineElicitation,
  onCancelElicitation,
  onOpenEditDiff,
  onRevertEdit,
  onOpenFile,
  onOpenLink,
  onRefuseLink,
  toolImages,
  onReadImage,
  onMoveToBackground,
  onStopTask,
  quoteMenu,
}: ToolRowProps) {
  const attention = useAttentionSurface()
  const presentation = useMemo(() => describeTool(entry.tool, entry.args), [entry.tool, entry.args])
  const imagePaths = imagePathsOf(entry, presentation.imagePath)
  const isQuestionOpen =
    entry.question !== undefined &&
    entry.question.isNoLongerOpen !== true &&
    ['waiting', 'open'].includes(entry.question.state ?? 'waiting')
  const isWaiting = entry.approval !== undefined || isQuestionOpen
  // Shell and edit rows show their body from the start, as Claude Code's do,
  // and so does a row with a picture (M43); the others open on click (M16).
  const [isOpen, setIsOpen] = useState(
    presentation.body === 'shell' || presentation.body === 'edit' || imagePaths.length > 0,
  )
  // An edit's lines, or a fetched page's size (M69).
  const change =
    changeSummary(entry.patchSummary) ??
    (presentation.body === 'fetch' && entry.status === 'completed'
      ? fetchedSize(entry.output)
      : undefined)
  const verified = verifySummaryText(entry.verifySummary)
  const isFailed = isFailedStatus(entry.status) || entry.status === TOOL_STATUS_INTERRUPTED
  // An edit whose changes are on disk (a finished one, or a rename stopped
  // partway, M67) can be reviewed and reverted in the editor.
  const reviewRef =
    presentation.body === 'edit' && hasLandedEdits(entry) ? entry.patchRef : undefined
  usePatchPages(entry, isOpen, isRunning, patchPage, onReadOutput)
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
  const items: GooeyItem[] =
    presentation.body !== 'shell' && entry.output === '' && entry.outputRef === undefined
      ? []
      : [
          {
            id: 'output',
            label: UI_TEXT.rowOpenOutput,
            icon: <FileIcon />,
            onSelect: () => {
              menu.close()
              openOutput()
            },
          },
        ]
  if (openReview !== undefined) {
    items.push({
      id: 'review',
      label: UI_TEXT.diffTallyReview,
      icon: <RewindIcon />,
      onSelect: () => {
        menu.close()
        openReview()
      },
    })
  }
  // Not while a turn runs: it may be writing the same file (the host refuses it too).
  if (reviewRef !== undefined && onRevertEdit !== undefined && !isRunning) {
    items.push({
      id: 'revert',
      label: UI_TEXT.rowRevertEdit,
      icon: <RewindIcon />,
      onSelect: () => {
        menu.close()
        onRevertEdit(entry.id, reviewRef.id)
      },
    })
  }
  if (
    attention !== undefined &&
    entry.question?.state === 'open' &&
    entry.question.isNoLongerOpen !== true
  ) {
    const question = entry.question
    items.push({
      id: 'dismiss-question',
      label: UI_TEXT.questionDismiss,
      icon: <CloseIcon />,
      disabled: question.isSubmitted === true,
      onSelect: () => {
        menu.close()
        attention.onDismiss(question.userInputId)
      },
    })
  }
  const menu = useRowMenu(items, UI_TEXT.messageActions, quoteMenu)
  let body: ReactNode
  switch (presentation.body) {
    case 'shell': {
      body = <ShellBody entry={entry} command={presentation.command} onOpen={openOutput} />
      break
    }
    case 'edit': {
      body = (
        <>
          <EditBody entry={entry} files={files} onExpand={openReview} />
          {entry.thenRun === undefined ? null : <ThenRunBlock result={entry.thenRun} />}
        </>
      )
      break
    }
    case 'read':
    case 'fetch': {
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
    case 'workflow': {
      body = <WorkflowBody entry={entry} />
      break
    }
    case 'verify': {
      body = <VerifyBody output={entry.output} onOpen={openOutput} />
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
  const elicitationOutcomeLabel =
    entry.elicitationOutcome?.action === 'accept'
      ? UI_TEXT.questionAnswered
      : UI_TEXT.questionDeclined
  let elicitationCard: ReactNode = null
  if (entry.elicitation !== undefined) {
    elicitationCard =
      attention === undefined ? (
        <ElicitationCard
          key={entry.elicitation.elicitationId}
          form={entry.elicitation}
          onAccept={onAcceptElicitation}
          onDecline={onDeclineElicitation}
          onCancel={onCancelElicitation}
        />
      ) : (
        <button
          type="button"
          className="button-secondary elicitation-docked"
          onClick={() => {
            if (entry.elicitation !== undefined)
              attention.selectDockCard({ kind: 'elicitation', id: entry.elicitation.elicitationId })
          }}
        >
          {entry.elicitation.server}: {UI_TEXT.questionAnswer}
        </button>
      )
  }
  const hasBody = body !== null || images.length > 0
  return (
    <li
      className={`${isWaiting ? 'tool tool-waiting' : 'tool'}${isQuestionOpen ? ' tool-question-open' : ''}`}
      data-status={entry.status}
      data-entry-id={entry.id}
      data-role="tool"
      {...menu.rowProps}
    >
      <div className="tool-header" hidden={entry.question !== undefined} inert={menu.isOpen}>
        <button
          type="button"
          className="tool-toggle"
          aria-expanded={isOpen}
          disabled={!hasBody}
          onClick={toggle}
        >
          <span className={statusDotClass(entry.status)} aria-hidden="true" />
          <span className="tool-label">{presentation.label}</span>
          {entry.isBackground ? <span className="badge">{UI_TEXT.backgroundBadge}</span> : null}
          {entry.paid === undefined ? null : <PaidBadge feature={entry.paid} />}
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
        <TaskAction
          entry={entry}
          presentation={presentation}
          onMoveToBackground={onMoveToBackground}
          onStopTask={onStopTask}
        />
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
      {verified === undefined ? null : <div className="tool-change">{verified}</div>}
      {isFailed ? (
        <div className="tool-failure">
          {outcomeText(entry.status)}
          {entry.failureReason === undefined ? '' : `: ${entry.failureReason}`}
        </div>
      ) : null}
      {isOpen && entry.question === undefined ? (
        <div className="tool-body" inert={menu.isOpen}>
          {body}
          {images}
        </div>
      ) : null}
      {entry.approval === undefined ? null : (
        // The card itself waits in the dock above the composer (D26).
        <div className="tool-outcome approval-docked">{UI_TEXT.approvalDockedNote}</div>
      )}
      {entry.approvalOutcome === undefined ? null : (
        <div className="tool-outcome">
          {UI_TEXT.approvalDecided}: {entry.approvalOutcome.decision} (
          {entry.approvalOutcome.resolvedBy})
        </div>
      )}
      {entry.approvalOutcome?.reason === undefined ? null : (
        // The Auto reviewer's reason on Muse Code (M90), in its own words.
        <div className="tool-outcome" dir="auto">
          {entry.approvalOutcome.reason}
        </div>
      )}
      {entry.question === undefined ? null : (
        <DeferredQuestionCard
          key={`${attention?.sessionId ?? ''}:${entry.question.userInputId}`}
          question={entry.question}
          onAnswer={onAnswer}
          onCancel={onCancelQuestion}
          onClarify={onClarifyQuestion}
        />
      )}
      {elicitationCard}
      {entry.elicitationOutcome === undefined ? null : (
        <div className="tool-outcome">
          {entry.elicitationOutcome.action === 'cancel'
            ? fill(UI_TEXT.elicitationExpired, { server: entry.elicitationOutcome.server })
            : elicitationOutcomeLabel}
        </div>
      )}
      {entry.questionOutcome === undefined ||
      (entry.question?.state === 'open' &&
        entry.questionOutcome.clarification === undefined) ? null : (
        <div className="tool-outcome" dir="auto">
          {questionOutcomeText(entry.questionOutcome)}
        </div>
      )}
      {menu.menu}
      {quoteMenu}
    </li>
  )
}

/** Memoised (M25): a row renders only when its entry, its patch page or its menu changes. */
export const ToolRow = memo(ToolRowView)
