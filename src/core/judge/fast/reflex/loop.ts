// M125 lane R (D107): loop, stall and done detection over the observed
// tool stream. Generalises the Model API repeat guard to both backends:
// the canonical call key lives here so either backend supplies it the
// same way, and this module names repeats, oscillations and
// same-failure runs. Pure and synchronous; it only names a pattern,
// never stops anything.
export interface ToolIdentity {
  readonly name: string
  readonly arguments: string
}

/** JSON with object keys sorted, so key order never distinguishes two values. */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => canonicalJson(entry))
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .toSorted(([left], [right]) => {
            if (left === right) return 0
            return left < right ? -1 : 1
          })
          .map(([key, entry]: [string, unknown]) => [key, canonicalJson(entry)]),
      )
    : value
}

/** Object key order and insignificant JSON whitespace never distinguish two calls. */
export function toolRepeatKey(call: ToolIdentity): string {
  let args: string
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    args = JSON.stringify(canonicalJson(parsed))
  } catch {
    // Invalid JSON still belongs to the tool's validated refusal path.
    args = call.arguments
  }
  return JSON.stringify([call.name, args])
}

export interface LoopSignal {
  /** Canonical tool-call identity (the backend's repeat key). */
  readonly key: string
  /** The call failed (nonzero exit, thrown error, refused result). */
  readonly failed: boolean
  /** Digest of the complete observable result. */
  readonly outputDigest: string
}

export type LoopPattern = 'repeat' | 'oscillation' | 'same-failure'

export type LoopVerdict =
  { readonly stuck: true; readonly pattern: LoopPattern } | { readonly stuck: false }

/** Three identical calls with three identical results in a row. */
const REPEAT_RUN = 3
/** Two calls alternating twice (A B A B). */
const OSCILLATION_RUN = 4
/** Three failures with the identical result in a row. */
const SAME_FAILURE_RUN = 3

/** Name the trailing pattern, or miss when the stream shows none. */
export function detectLoop(signals: readonly LoopSignal[]): LoopVerdict {
  const tail = signals.slice(-Math.max(REPEAT_RUN, OSCILLATION_RUN, SAME_FAILURE_RUN))
  if (tail.length >= REPEAT_RUN) {
    const run = tail.slice(-REPEAT_RUN)
    const firstRepeat = run[0]
    if (
      firstRepeat !== undefined &&
      run.every(
        (signal) =>
          signal.key === firstRepeat.key && signal.outputDigest === firstRepeat.outputDigest,
      )
    )
      return { stuck: true, pattern: 'repeat' }
  }
  if (tail.length >= OSCILLATION_RUN) {
    const run = tail.slice(-OSCILLATION_RUN)
    const first = run[0]
    const second = run[1]
    if (
      first !== undefined &&
      second !== undefined &&
      first.key !== second.key &&
      run[2]?.key === first.key &&
      run[3]?.key === second.key
    )
      return { stuck: true, pattern: 'oscillation' }
  }
  if (tail.length >= SAME_FAILURE_RUN) {
    const run = tail.slice(-SAME_FAILURE_RUN)
    const firstFailure = run[0]
    if (
      firstFailure !== undefined &&
      run.every((signal) => signal.failed && signal.outputDigest === firstFailure.outputDigest)
    )
      return { stuck: true, pattern: 'same-failure' }
  }
  return { stuck: false }
}
