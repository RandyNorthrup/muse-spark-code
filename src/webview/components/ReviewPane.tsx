// The review pane (M70, PLAN.md D49): the conversation's changes as a modal
// over the chat, file by file and change by change. Each change can be
// accepted (kept, and marked so here) or reverted (the host takes that one
// hunk out of the file as it is now, or says why it could not). A comment on
// one of its lines goes to the agent with the lines around it: into the
// running turn as a steer, or as the next message when nothing runs.

import { useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import { type PatchHunk, REMOVE_MARKER } from '../../shared/patchDocument'
import type { ChatReference, LineRange, ReviewFile } from '../../shared/protocol'
import { hunkRows } from '../../shared/patchDocument'
import {
  type ReviewHunkState,
  reviewHunkKey,
  reviewHunkName,
  type ReviewPaneState,
} from '../state/uiState'
import { Modal } from './Modal'
import { DiffTable } from './ToolBlocks'
import { deferred } from './DeferredSurface'

const CommentForm = deferred(async () => {
  const module = await import('./ReviewCommentForm')
  return { default: module.ReviewCommentForm }
})

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
          keepFocus
          className="review-comment"
          path={file.path}
          rows={rows}
          isRunning={isRunning}
          onComment={onComment}
          onCancel={() => {
            setIsCommenting(false)
          }}
          onClose={() => {
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
