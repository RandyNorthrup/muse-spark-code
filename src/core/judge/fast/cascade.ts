// M125 lane E (D107): the deterministic-first cascade within one
// deadline. The deterministic check runs first; the engine only on a
// miss; today's behaviour on abstention, failure or a late answer. A
// late answer is discarded, never applied, and its late settlement is
// still reported so the host records the miss. Our own cancellation
// reports `cancelled`, which the host must not record as a sample.
export type CascadeEngineOutcome =
  'hit' | 'abstained' | 'late' | 'miss' | 'cancelled' | 'deterministic'

export interface CascadeStep<T> {
  /** The deterministic check; a hit ends the cascade with no engine call. */
  readonly deterministic: () => { readonly hit: true; readonly value: T } | { readonly hit: false }
  /** The miss path; `undefined` is the engine abstaining. */
  readonly engine: () => Promise<T | undefined>
  /** Today's behaviour: the fallback the deadline protects. */
  readonly fallback: () => T
  /** The decision's deadline; `undefined` (post-turn) waits for the engine. */
  readonly deadlineMs: number | undefined
  /** Our own cancellation; reported, never recorded as a sample. */
  readonly signal?: AbortSignal | undefined
  /**
  Reports a discarded run's late settlement to the host record: the
  answer, or the failure with its thrown value. The host records the
  miss; the error itself is never logged.
  */
  readonly report?: ((outcome: 'answered' | 'failed', error?: unknown) => void) | undefined
}

export interface CascadeResult<T> {
  readonly value: T
  readonly engine: CascadeEngineOutcome
  /**
  The engine's thrown value when `engine` is `miss`. The host records
  the miss and drops it; it is never logged, since error text can name
  paths and accounts.
  */
  readonly cause?: unknown
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Identity marker for the deadline's win in the engine race. */
const CASCADE_TIMEOUT = Symbol('cascade-timeout')

/** The engine's answer: an abstention takes the fallback, a value is the hit. */
function answered<T>(step: CascadeStep<T>, value: T | undefined): CascadeResult<T> {
  return value === undefined
    ? { value: step.fallback(), engine: 'abstained' }
    : { value, engine: 'hit' }
}

/**
An engine throw: an abort is our own cancellation; any other throw is a
miss with infinite latency, never the fallback's fault.
*/
function thrown<T>(step: CascadeStep<T>, error: unknown): CascadeResult<T> {
  return error instanceof Error && error.name === 'AbortError'
    ? { value: step.fallback(), engine: 'cancelled' }
    : { value: step.fallback(), engine: 'miss', cause: error }
}

/** Run one decision's cascade within its deadline. */
export async function runCascade<T>(step: CascadeStep<T>): Promise<CascadeResult<T>> {
  // Read fresh at every check: the person may cancel while the engine runs.
  const isAborted = (): boolean => step.signal?.aborted === true
  const checked = step.deterministic()
  if (checked.hit) return { value: checked.value, engine: 'deterministic' }
  if (isAborted()) return { value: step.fallback(), engine: 'cancelled' }
  const pending = step.engine()
  const deadlineMs = step.deadlineMs
  if (deadlineMs === undefined) {
    try {
      return answered(step, await pending)
    } catch (error: unknown) {
      return thrown(step, error)
    }
  }
  const timer = (async (): Promise<typeof CASCADE_TIMEOUT> => {
    await delay(deadlineMs)
    return CASCADE_TIMEOUT
  })()
  try {
    const value = await Promise.race([pending, timer])
    if (value === CASCADE_TIMEOUT || isAborted()) {
      // Discarded, never applied: the late settlement still reports to
      // the host record, so the miss is recorded, never dropped.
      void (async (): Promise<void> => {
        try {
          await pending
          step.report?.('answered')
        } catch (error: unknown) {
          step.report?.('failed', error)
        }
      })()
      return isAborted()
        ? { value: step.fallback(), engine: 'cancelled' }
        : { value: step.fallback(), engine: 'late' }
    }
    return answered(step, value)
  } catch (error: unknown) {
    return thrown(step, error)
  }
}
