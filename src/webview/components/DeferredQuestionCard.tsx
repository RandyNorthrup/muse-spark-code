import { lazy, Suspense } from 'react'
import type { QuestionCardProps, QuestionOutcome } from './QuestionCard'
const QuestionView = lazy(async () => {
  const module = await import('./QuestionCard')
  return { default: module.QuestionView }
})

export function DeferredQuestionCard(
  props: QuestionCardProps | Parameters<typeof QuestionOutcome>[0],
) {
  return (
    <Suspense fallback={null}>
      <QuestionView {...props} />
    </Suspense>
  )
}
