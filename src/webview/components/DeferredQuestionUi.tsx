// One guarded import for the question-only UI; its draft context stays mounted.
import { UI_TEXT } from '../../shared/constants'
import type { PendingQuestion } from '../state/uiState'
import type { QuestionView } from './QuestionCard'
import type { QuestionDockProps } from './QuestionUi'
import { deferred } from './DeferredSurface'

const loadQuestionUi = () => import('./QuestionUi')
const LazyCard = deferred(
  async () => {
    const { QuestionView } = await loadQuestionUi()
    return { default: QuestionView }
  },
  false,
  (props) =>
    'question' in props ? (
      <QuestionLoadingCard question={props.question} isDockCard={props.isDockCard ?? false} />
    ) : 'elicitation' in props ? (
      <QuestionLoadingCard title={props.elicitation.server} question={undefined} />
    ) : null,
)
const LazyDock = deferred(
  async () => {
    const { QuestionDock } = await loadQuestionUi()
    return { default: QuestionDock }
  },
  false,
  (props) =>
    props.hasApproval ? (
      <div className="attention-question-line">{UI_TEXT.questionOpen}</div>
    ) : (
      <QuestionLoadingCard question={props.questionGroup.questions[0]} isDockCard />
    ),
)

/** Keep an arrival visible while its controls load; drafts live above Suspense. */
function QuestionLoadingCard({
  question,
  title,
  isDockCard = false,
}: {
  readonly question: PendingQuestion | undefined
  readonly title?: string
  readonly isDockCard?: boolean
}) {
  return (
    <div
      className="question question-folded"
      role="group"
      aria-busy="true"
      aria-label={title ?? question?.questions[0]?.header ?? UI_TEXT.questionOpen}
      data-question-id={question?.userInputId}
      data-question-slot={isDockCard ? 'dock' : 'row'}
      tabIndex={-1}
    >
      <div className="question-summary">
        <span className="question-state-label">{UI_TEXT.loadingOutput}</span>
        <span className="question-summary-header" dir="auto">
          {title ?? question?.questions[0]?.header}
        </span>
      </div>
    </div>
  )
}
export function DeferredQuestionCard(props: Parameters<typeof QuestionView>[0]) {
  return <LazyCard {...props} />
}
export function DeferredQuestionDock(props: QuestionDockProps) {
  return <LazyDock {...props} />
}
