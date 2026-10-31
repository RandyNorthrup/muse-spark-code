import { useEffect, useRef, useState } from 'react'
import type { MhpParams } from '../../shared/hostApi/methods'
import { UI_TEXT } from '../../shared/l10n/text'
import { isCarrierFailure } from '../bridges/failure'

type Hunk = MhpParams<'diff/review'>['hunks'][number]
type Decision = MhpParams<'diff/didDecide'>['decision']
function HunkReview({
  hunk,
  decide,
}: {
  readonly hunk: Hunk
  readonly decide: (hunkId: Hunk['id'], decision: Decision) => Promise<void>
}) {
  const [isBusy, setBusy] = useState(false)
  const [decision, setDecision] = useState<Decision>()
  const [hasError, setError] = useState(false)
  const pending = useRef(false)
  const completed = useRef(false)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (decision !== undefined) status.current?.focus()
  }, [decision])
  async function submit(value: Decision): Promise<void> {
    if (pending.current || completed.current) return
    pending.current = true
    setBusy(true)
    setError(false)
    try {
      await decide(hunk.id, value)
      completed.current = true
      setDecision(value)
    } catch (error: unknown) {
      if (!isCarrierFailure(error)) throw error
      setError(true)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const decisionText = {
    accept: UI_TEXT.reviewAccepted,
    reject: UI_TEXT.reject,
    cancel: UI_TEXT.goalEditCancel,
  }
  return (
    <section className="fallback-diff" aria-label={hunk.uri} aria-busy={isBusy}>
      <h2>{hunk.uri}</h2>
      <h3>{UI_TEXT.fallbackBefore}</h3>
      <pre tabIndex={0}>
        <del>{hunk.before}</del>
      </pre>
      <h3>{UI_TEXT.fallbackAfter}</h3>
      <pre tabIndex={0}>
        <ins>{hunk.after}</ins>
      </pre>
      {hasError && <p role="alert">{UI_TEXT.fallbackActionFailed}</p>}
      {decision === undefined ? (
        <div className="fallback-actions">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              void submit('accept')
            }}
          >
            {UI_TEXT.reviewAccept}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              void submit('reject')
            }}
          >
            {UI_TEXT.reject}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              void submit('cancel')
            }}
          >
            {UI_TEXT.goalEditCancel}
          </button>
        </div>
      ) : (
        <p ref={status} tabIndex={-1} role="status">
          {decisionText[decision]}
        </p>
      )}
    </section>
  )
}

export function DiffPage({
  title,
  hunks,
  onDecide,
}: {
  readonly title: string
  readonly hunks: readonly Hunk[]
  readonly onDecide: (id: Hunk['id'], decision: Decision) => Promise<void>
}) {
  return (
    <main className="fallback-page">
      <h1>{title}</h1>
      {hunks.map((hunk) => (
        <HunkReview
          key={JSON.stringify([hunk.id, hunk.expectedVersion])}
          hunk={hunk}
          decide={onDecide}
        />
      ))}
    </main>
  )
}
