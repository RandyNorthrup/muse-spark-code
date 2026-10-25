import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import { BackIcon, ForwardIcon } from './icons'

export function OpenQuestionsChip({
  count,
  onAnswer,
  onJump,
}: {
  readonly count: number
  readonly onAnswer: () => void
  readonly onJump: (direction: 'next' | 'previous') => void
}) {
  return (
    <div className="open-questions-chip">
      <button type="button" className="button-secondary chat-control" onClick={onAnswer}>
        {plural(UI_TEXT.openQuestionsCount, count)} · {UI_TEXT.questionAnswer}
      </button>
      <button
        type="button"
        className="icon-button chat-control"
        aria-label={UI_TEXT.questionPreviousOpen}
        onClick={() => {
          onJump('previous')
        }}
      >
        <BackIcon />
      </button>
      <button
        type="button"
        className="icon-button chat-control"
        aria-label={UI_TEXT.questionNextOpen}
        onClick={() => {
          onJump('next')
        }}
      >
        <ForwardIcon />
      </button>
    </div>
  )
}
