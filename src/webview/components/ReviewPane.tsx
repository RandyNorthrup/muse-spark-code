// The review pane (M70, PLAN.md D49): the conversation's changes as a modal
// over the chat, file by file and change by change. Each change can be
// accepted (kept, and marked so here) or reverted (the host takes that one
// hunk out of the file as it is now, or says why it could not). A comment on
// one of its lines goes to the agent with the lines around it: into the
// running turn as a steer, or as the next message when nothing runs.

import { useId, useState } from 'react'
import {
  REVIEW_COMMENT_CONTEXT_LINES,
  REVIEW_COMMENT_MODEL_TEXT,
  UI_TEXT,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import {
  ADD_MARKER,
  CONTEXT_MARKER,
  type PatchHunk,
  REMOVE_MARKER,
} from '../../shared/patchDocument'
import type { ChatReference, LineRange, ReviewFile } from '../../shared/protocol'
import { type DiffRow, hunkRows } from '../diff'
import {
  type ReviewHunkState,
  reviewHunkKey,
  reviewHunkName,
  type ReviewPaneState,
} from '../state/uiState'
import { Modal } from './Modal'
import { DiffTable } from './ToolBlocks'

export interface ReviewPaneProps {
  readonly pane: ReviewPaneState
  readonly hunks: Readonly<Record<string, ReviewHunkState>>
  /** A turn runs: a comment steers it rather than starting the next one. */
  readonly isRunning: boolean
  readonly onAccept: (key: string, isAccepted: boolean) => void
  readonly onRevert: (file: ReviewFile, hunkIndex: number) => void
  readonly onOpenFile: (path: string, range: LineRange | undefined) => void
  readonly onComment: (text: string, reference: ChatReference) => void
  readonly onClose: () => void
}

// The comment's quote reads as the diff's own lines: its markers first.
const REFERENCE_ROLE = 'diff'
const MARKERS: Readonly<Record<DiffRow['kind'], string>> = {
  context: CONTEXT_MARKER,
  add: ADD_MARKER,
  remove: REMOVE_MARKER,
  hunk: CONTEXT_MARKER,
}

/** The lines a change leaves in the file: where it starts, and where it ends. */
function newSpan(hunk: PatchHunk): { readonly start: number; readonly end: number } {
  const count = hunk.newLines ?? hunk.lines.filter((line) => !line.startsWith(REMOVE_MARKER)).length
  return { start: hunk.newStart, end: hunk.newStart + Math.max(count, 1) - 1 }
}

// Line numbers are shown as the editor shows them, with no digit grouping.
function hunkHeading(hunk: PatchHunk, hunkIndex: number): string {
  const { start, end } = newSpan(hunk)
  const index = hunkIndex + 1
  return start === end
    ? fill(UI_TEXT.reviewHunkLine, { index, start: String(start) })
    : fill(UI_TEXT.reviewHunkLines, { index, start: String(start), end: String(end) })
}

/** A row's line as the line picker names it: its number in the file now, or the one it had. */
function lineLabel(row: DiffRow): string {
  return row.kind === 'remove'
    ? fill(UI_TEXT.reviewRemovedLineOption, { line: String(row.oldLine ?? ''), text: row.text })
    : fill(UI_TEXT.reviewLineOption, { line: String(row.newLine ?? ''), text: row.text })
}

/**
 * What the comment quotes: the file and line (a removed line by the number
 * it had), then the change's lines around it. Model text: English.
 */
function commentReference(path: string, rows: readonly DiffRow[], index: number): ChatReference {
  const row = rows[index]
  const heading =
    row?.kind === 'remove'
      ? fill(REVIEW_COMMENT_MODEL_TEXT.reviewRemovedLine, { path, line: String(row.oldLine ?? '') })
      : `${path}:${String(row?.newLine ?? '')}`
  const around = rows
    .slice(
      Math.max(index - REVIEW_COMMENT_CONTEXT_LINES, 0),
      index + REVIEW_COMMENT_CONTEXT_LINES + 1,
    )
    .map((candidate) => `${MARKERS[candidate.kind]}${candidate.text}`)
  return { intent: 'comment', role: REFERENCE_ROLE, text: [heading, ...around].join('\n') }
}

/** The line a comment starts on: the first line the change added, else the first it removed. */
function firstCommentLine(lines: readonly { readonly row: DiffRow; readonly index: number }[]) {
  return (
    lines.find(({ row }) => row.kind === 'add') ??
    lines.find(({ row }) => row.kind === 'remove') ??
    lines[0]
  )
}

function CommentForm({
  path,
  rows,
  isRunning,
  onComment,
  onCancel,
}: {
  readonly path: string
  readonly rows: readonly DiffRow[]
  readonly isRunning: boolean
  readonly onComment: ReviewPaneProps['onComment']
  readonly onCancel: () => void
}) {
  const lineId = useId()
  const textId = useId()
  const lines = rows.flatMap((row, index) => (row.kind === 'hunk' ? [] : [{ row, index }]))
  const [chosen, setChosen] = useState(firstCommentLine(lines)?.index ?? 0)
  const [text, setText] = useState('')
  const send = () => {
    const comment = text.trim()
    if (comment === '') {
      return
    }
    onComment(comment, commentReference(path, rows, chosen))
    onCancel()
  }
  return (
    <div className="review-comment">
      <label className="review-comment-field" htmlFor={lineId}>
        {UI_TEXT.reviewCommentLine}
        <select
          id={lineId}
          className="question-input"
          value={chosen}
          onChange={(event) => {
            setChosen(Number(event.target.value))
          }}
        >
          {lines.map(({ row, index }) => (
            <option key={String(index)} value={index}>
              {lineLabel(row)}
            </option>
          ))}
        </select>
      </label>
      <label className="review-comment-field" htmlFor={textId}>
        {UI_TEXT.reviewCommentLabel}
        <textarea
          id={textId}
          className="question-input"
          rows={2}
          value={text}
          placeholder={UI_TEXT.reviewCommentPlaceholder}
          onChange={(event) => {
            setText(event.target.value)
          }}
        />
      </label>
      <div className="review-actions">
        <button type="button" className="tool-more" disabled={text.trim() === ''} onClick={send}>
          {isRunning ? UI_TEXT.reviewSendSteer : UI_TEXT.reviewSendNext}
        </button>
        <button type="button" className="tool-more" onClick={onCancel}>
          {UI_TEXT.reviewCommentCancel}
        </button>
      </div>
    </div>
  )
}

/** The words beside a change's buttons: what became of it. */
function hunkStatus(state: ReviewHunkState | undefined): string | undefined {
  switch (state?.kind) {
    case 'accepted': {
      return UI_TEXT.reviewAccepted
    }
    case 'reverting': {
      return UI_TEXT.reviewReverting
    }
    case 'reverted': {
      return UI_TEXT.reviewReverted
    }
    case 'failed': {
      return `${UI_TEXT.reviewNotReverted}: ${state.reason}`
    }
    case undefined: {
      return undefined
    }
  }
}

function Hunk({
  file,
  hunk,
  hunkIndex,
  state,
  isRunning,
  onAccept,
  onRevert,
  onComment,
}: {
  readonly file: ReviewFile
  readonly hunk: PatchHunk
  readonly hunkIndex: number
  readonly state: ReviewHunkState | undefined
  readonly isRunning: boolean
  readonly onAccept: ReviewPaneProps['onAccept']
  readonly onRevert: ReviewPaneProps['onRevert']
  readonly onComment: ReviewPaneProps['onComment']
}) {
  const [isCommenting, setIsCommenting] = useState(false)
  const key = reviewHunkKey(file.itemId, file.fileIndex, hunkIndex)
  const name = reviewHunkName(file.path, hunkIndex)
  const rows = hunkRows(hunk)
  const isAccepted = state?.kind === 'accepted'
  const isGone = state?.kind === 'reverted' || state?.kind === 'reverting'
  const status = hunkStatus(state)
  return (
    <li className="review-hunk">
      <p className="review-hunk-heading">{hunkHeading(hunk, hunkIndex)}</p>
      <DiffTable rows={rows} />
      <div className="review-actions">
        <button
          type="button"
          className="tool-more"
          aria-pressed={isAccepted}
          aria-label={`${UI_TEXT.reviewAccept}: ${name}`}
          disabled={isGone}
          onClick={() => {
            onAccept(key, !isAccepted)
          }}
        >
          {UI_TEXT.reviewAccept}
        </button>
        <button
          type="button"
          className="tool-more"
          aria-label={`${UI_TEXT.reviewRevert}: ${name}`}
          title={file.refusal}
          disabled={isGone || file.refusal !== undefined}
          onClick={() => {
            onRevert(file, hunkIndex)
          }}
        >
          {UI_TEXT.reviewRevert}
        </button>
        <button
          type="button"
          className="tool-more"
          aria-label={`${UI_TEXT.reviewComment}: ${name}`}
          aria-expanded={isCommenting}
          onClick={() => {
            setIsCommenting(!isCommenting)
          }}
        >
          {UI_TEXT.reviewComment}
        </button>
        {status === undefined ? null : <span className="review-hunk-status">{status}</span>}
      </div>
      {isCommenting ? (
        <CommentForm
          path={file.path}
          rows={rows}
          isRunning={isRunning}
          onComment={onComment}
          onCancel={() => {
            setIsCommenting(false)
          }}
        />
      ) : null}
    </li>
  )
}

function summaryOf(
  files: readonly ReviewFile[],
  hunks: Readonly<Record<string, ReviewHunkState>>,
): string {
  const keys = files.flatMap((file) =>
    file.hunks.map((_hunk, hunkIndex) => reviewHunkKey(file.itemId, file.fileIndex, hunkIndex)),
  )
  const count = (kind: ReviewHunkState['kind']) =>
    keys.filter((key) => hunks[key]?.kind === kind).length
  const paths = new Set(files.map((file) => file.path))
  return [
    plural(UI_TEXT.reviewPaneFiles, paths.size),
    plural(UI_TEXT.reviewPaneHunks, keys.length),
    plural(UI_TEXT.reviewPaneAccepted, count('accepted')),
    plural(UI_TEXT.reviewPaneReverted, count('reverted')),
  ].join(' · ')
}

function PaneBody({
  pane,
  hunks,
  isRunning,
  onAccept,
  onRevert,
  onOpenFile,
  onComment,
}: Omit<ReviewPaneProps, 'onClose'>) {
  const { files } = pane
  if (files === undefined) {
    return (
      <p className="usage-row-meta" role="status">
        {UI_TEXT.reviewPaneLoading}
      </p>
    )
  }
  if (files.length === 0) {
    return pane.reason === undefined && pane.omittedEdits > 0 ? null : (
      <p className="usage-row-meta">{pane.reason ?? UI_TEXT.reviewPaneEmpty}</p>
    )
  }
  return (
    <>
      <p className="usage-row-meta">{summaryOf(files, hunks)}</p>
      {files.map((file) => (
        <section
          key={`${file.itemId}:${String(file.fileIndex)}`}
          className="review-file"
          aria-label={file.path}
        >
          <div className="review-file-head">
            <h3 className="review-file-path">{file.path}</h3>
            {file.refusal === undefined ? (
              <button
                type="button"
                className="tool-more"
                aria-label={`${UI_TEXT.reviewOpenFile}: ${file.path}`}
                onClick={() => {
                  onOpenFile(file.path, undefined)
                }}
              >
                {UI_TEXT.reviewOpenFile}
              </button>
            ) : null}
          </div>
          {file.refusal === undefined ? null : <p className="usage-row-meta">{file.refusal}</p>}
          <ol className="review-hunks">
            {file.hunks.map((hunk, hunkIndex) => (
              <Hunk
                key={String(hunkIndex)}
                file={file}
                hunk={hunk}
                hunkIndex={hunkIndex}
                state={hunks[reviewHunkKey(file.itemId, file.fileIndex, hunkIndex)]}
                isRunning={isRunning}
                onAccept={onAccept}
                onRevert={onRevert}
                onComment={onComment}
              />
            ))}
          </ol>
        </section>
      ))}
    </>
  )
}

export function ReviewPane({ onClose, ...body }: ReviewPaneProps) {
  const { pane } = body
  return (
    <Modal title={UI_TEXT.reviewPaneTitle} titleId="review-pane-title" isWide onClose={onClose}>
      <PaneBody {...body} />
      {pane.omittedEdits > 0 ? (
        <p className="usage-row-meta">{plural(UI_TEXT.reviewPaneOmitted, pane.omittedEdits)}</p>
      ) : null}
    </Modal>
  )
}
