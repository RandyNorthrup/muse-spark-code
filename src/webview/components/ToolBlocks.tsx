// The pieces tool rows are built from (M15, M43): text clipped behind Show
// more, a diff clipped behind Click to expand, and a block that opens its
// whole content in an editor tab.

import { type ReactNode, useState } from 'react'
import { OUTPUT_PREVIEW_CHARS, OUTPUT_PREVIEW_LINES, UI_TEXT } from '../../shared/constants'
import type { DiffRow } from '../diff'

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
export function Clipped({
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
export function DiffTable({
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
