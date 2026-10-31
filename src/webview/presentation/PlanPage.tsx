import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { isCarrierFailure } from '../bridges/failure'
import type { PresentationPlan } from '../../shared/presentationRecords'
import { plural } from '../../shared/l10n/text'

export interface PlanPageProps {
  readonly plans: readonly PresentationPlan[]
  readonly onRead: (fileName: string) => Promise<string>
  readonly onOpen: (fileName: string) => Promise<void>
  /** The engine owns trust, a fresh conversation and confirmation of the exact saved file. */
  readonly onImplement: (fileName: string) => Promise<void>
}

/** A read-only saved-plan index and exact-text preview, shared by every carrier. */
export function PlanPage({ plans, onRead, onOpen, onImplement }: PlanPageProps) {
  const generation = useRef(0)
  const action = useRef(false)
  const preview = useRef<HTMLPreElement>(null)
  const [selection, setSelection] = useState<{ fileName: string; text?: string }>()
  const [isReading, setReading] = useState(false)
  const [isActing, setActing] = useState(false)
  const [hasError, setError] = useState(false)
  const selected = plans.find((plan) => plan.fileName === selection?.fileName)
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )
  useEffect(() => {
    if (selection?.text !== undefined) preview.current?.focus()
  }, [selection])

  async function read(plan: PresentationPlan): Promise<void> {
    const ticket = ++generation.current
    setSelection({ fileName: plan.fileName })
    setReading(true)
    setError(false)
    try {
      const text = await onRead(plan.fileName)
      if (ticket === generation.current) setSelection({ fileName: plan.fileName, text })
    } catch (error: unknown) {
      if (!isCarrierFailure(error)) throw error
      if (ticket === generation.current) setError(true)
    } finally {
      if (ticket === generation.current) setReading(false)
    }
  }

  async function run(operation: PlanPageProps['onOpen']): Promise<void> {
    if (selected === undefined || isReading || action.current) return
    action.current = true
    const ticket = generation.current
    setActing(true)
    setError(false)
    try {
      await operation(selected.fileName)
    } catch (error: unknown) {
      if (!isCarrierFailure(error)) throw error
      if (ticket === generation.current) setError(true)
    } finally {
      action.current = false
      if (ticket === generation.current) setActing(false)
    }
  }

  return (
    <main className="fallback-page" aria-busy={isReading || isActing}>
      <h1>{UI_TEXT.plansTitle}</h1>
      <p role="status">
        {plans.length === 0 ? UI_TEXT.plansNone : plural(UI_TEXT.plansCount, plans.length)}
      </p>
      <ul aria-label={UI_TEXT.plansTitle}>
        {plans.map((plan) => (
          <li key={plan.fileName} className="fallback-manager-row">
            <button
              type="button"
              aria-pressed={plan.fileName === selected?.fileName}
              disabled={isActing}
              onClick={() => {
                void read(plan)
              }}
            >
              {plan.title}
            </button>
            <span dir="auto">{plan.relativePath.replaceAll('\\', '/')}</span>
          </li>
        ))}
      </ul>
      {isReading && <p role="status">{UI_TEXT.loadingOutput}</p>}
      {hasError && <p role="alert">{UI_TEXT.fallbackActionFailed}</p>}
      {selected !== undefined && selection?.text !== undefined && (
        <section aria-label={selected.title}>
          <h2>{selected.title}</h2>
          <pre
            ref={preview}
            className="presentation-document"
            tabIndex={0}
            aria-label={selected.title}
            dir="auto"
          >
            {selection.text}
          </pre>
          <div className="fallback-actions">
            <button
              type="button"
              disabled={isActing}
              onClick={() => {
                void run(onOpen)
              }}
            >
              {UI_TEXT.planOpen}
            </button>
            <button
              type="button"
              disabled={isActing}
              onClick={() => {
                void run(onImplement)
              }}
            >
              {UI_TEXT.implementPlan}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
