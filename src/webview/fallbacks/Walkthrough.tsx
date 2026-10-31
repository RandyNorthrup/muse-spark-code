import { UI_TEXT } from '../../shared/l10n/text'
import type { PanelPayload } from '../bridges/types'

export function Walkthrough({
  steps,
  post,
}: {
  readonly steps: readonly {
    readonly id: string
    readonly title: string
    readonly description: string
    readonly action: PanelPayload
    readonly actionTitle: string
  }[]
  readonly post: (payload: PanelPayload) => void
}) {
  return (
    <main className="fallback-page">
      <h1>{UI_TEXT.onboardingTitle}</h1>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            <h2>{step.title}</h2>
            <p>{step.description}</p>
            <button
              type="button"
              onClick={() => {
                post(step.action)
              }}
            >
              {step.actionTitle}
            </button>
          </li>
        ))}
      </ol>
    </main>
  )
}
