import { UI_TEXT } from '../../shared/constants'
import { formatNumber, plural, templateParts } from '../../shared/l10n/text'
import type { DiffTallyCounts } from '../../shared/diffTally'

export interface DiffTallyProps {
  readonly counts: DiffTallyCounts | undefined
  readonly onReview?: () => void
}

/** Conversation edit totals; Review is available only when the host can open it. */
export function DiffTally({ counts, onReview }: DiffTallyProps) {
  if (counts === undefined) {
    return null
  }
  const parts = templateParts(UI_TEXT.diffTallyLines)
  return (
    <div
      className="diff-tally"
      role="group"
      aria-label={UI_TEXT.diffTallyLabel}
      aria-description={UI_TEXT.diffTallyTitle}
      title={UI_TEXT.diffTallyTitle}
    >
      <span className="diff-tally-files">{plural(UI_TEXT.diffTallyFiles, counts.files)}</span>
      <span className="diff-tally-lines">
        {parts.map((part, index) => {
          if (typeof part === 'string') {
            return typeof parts[index + 1] === 'object' ? null : part
          }
          // Keep the translated sign/prefix with its count: the complete
          // visible text lets the contrast check measure one-digit totals.
          const prefix = parts[index - 1]
          return (
            <span
              className={part.slot === 'added' ? 'diff-tally-added' : 'diff-tally-removed'}
              key={index}
            >
              {typeof prefix === 'string' ? prefix : null}
              {formatNumber(part.slot === 'added' ? counts.added : counts.removed)}
            </span>
          )
        })}
      </span>
      {onReview !== undefined && (
        <button
          className="button-secondary diff-tally-review chat-control"
          type="button"
          title={UI_TEXT.diffTallyReviewTitle}
          onClick={() => {
            onReview()
          }}
        >
          {UI_TEXT.diffTallyReview}
        </button>
      )}
    </div>
  )
}
