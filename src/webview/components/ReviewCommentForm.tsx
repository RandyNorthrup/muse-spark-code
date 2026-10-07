import { useId, useState } from 'react'
import {
  REVIEW_COMMENT_CONTEXT_LINES,
  REVIEW_COMMENT_MODEL_TEXT,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { ADD_MARKER, CONTEXT_MARKER, REMOVE_MARKER } from '../../shared/patchDocument'
import type { ChatReference } from '../../shared/protocol'
import type { DiffRow } from '../diff'
import type { ReviewPaneProps } from './ReviewPane'

const REFERENCE_ROLE = 'diff'
const MARKERS: Readonly<Record<DiffRow['kind'], string>> = {
  context: CONTEXT_MARKER,
  add: ADD_MARKER,
  remove: REMOVE_MARKER,
  hunk: CONTEXT_MARKER,
}

function lineLabel(row: DiffRow): string {
  return row.kind === 'remove'
    ? fill(UI_TEXT.reviewRemovedLineOption, { line: String(row.oldLine ?? ''), text: row.text })
    : fill(UI_TEXT.reviewLineOption, { line: String(row.newLine ?? ''), text: row.text })
}

/** The selected diff line and its context, in the model's English vocabulary. */
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

/** Start at the first added line, then a removed line, then the first context line. */
function firstCommentLine(lines: readonly { readonly row: DiffRow; readonly index: number }[]) {
  return (
    lines.find(({ row }) => row.kind === 'add') ??
    lines.find(({ row }) => row.kind === 'remove') ??
    lines[0]
  )
}

export function ReviewCommentForm({
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
    if (comment === '') return
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
