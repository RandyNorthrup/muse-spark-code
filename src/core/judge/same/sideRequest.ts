// The Model API side request (M98 lane S, PLAN.md D77): a side request built
// from ModelApiHost's own request builder output. Its cached prefix (the main
// body's model, instructions and tools — exactly what promptCacheKey digests)
// is copied byte-exact and the judge question appended at the tail, so the
// side request reads the main request's cached prefix. Redaction comes first:
// when redaction would change a prefix byte, or the prefix measures below the
// cacheable minimum, a minimal standalone prompt goes instead. Pure; the host
// adapter hands in the built body through its injected source. No `vscode`
// import.

/**
 * The fields of the main body the side request reads. Structural on purpose:
 * the adapter passes ModelApiHost's own keyed body, whose extra fields ride
 * along untouched on the shared-prefix path.
 */
export interface SideRequestMain {
  readonly model: string
  readonly instructions: unknown
  readonly tools: unknown
  readonly input: readonly unknown[]
}

export interface PlanSideRequestInputs<TBody extends SideRequestMain> {
  /** ModelApiHost's own built (keyed) body for the current turn. */
  readonly mainBody: TBody
  /** The judge question block, appended at the tail (a JSON value). */
  readonly tail: unknown
  /** Secret redaction (redactSecrets). Redaction runs before anything remote. */
  readonly redact: (text: string) => string
  /** Measured length of the cached prefix, in the model's tokens. */
  readonly prefixTokens: number
  /** Below this the prefix shares nothing worth caching (lane 0). */
  readonly minPrefixTokens: number
}

export type SideRequestPlan<TBody extends SideRequestMain> =
  | {
      /** The prefix is copied exactly; only the redacted tail is appended. */
      readonly mode: 'shared-prefix'
      readonly body: TBody
    }
  /** The adapter sends a minimal standalone prompt with the redacted tail. */
  | { readonly mode: 'standalone' }

/** The tail, redacted: secrets in the judged state never reach the model. */
export function redactedTail(redact: (text: string) => string, tail: unknown): unknown {
  // `stringify` returns `undefined` for no value at all; the types do not say
  // so, so the check reads the value rather than the signature.
  const text: unknown = JSON.stringify(tail)
  if (typeof text !== 'string') {
    throw new TypeError('judge side requests need a JSON tail')
  }
  return JSON.parse(redact(text)) as unknown
}

function isFiniteCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * Plan the side request for one judge batch. The main body is never edited,
 * reordered or trimmed: the shared-prefix body spreads it whole and replaces
 * only `input` with the same items plus the redacted tail. Anything redaction
 * changes, or a prefix below the cacheable minimum, goes standalone.
 */
export function planSideRequest<TBody extends SideRequestMain>(
  inputs: PlanSideRequestInputs<TBody>,
): SideRequestPlan<TBody> {
  if (!isFiniteCount(inputs.prefixTokens) || !isFiniteCount(inputs.minPrefixTokens)) {
    throw new RangeError('judge side requests need finite non-negative token counts')
  }
  if (!Array.isArray(inputs.mainBody.input)) {
    throw new TypeError('judge side requests need a main body with an input list')
  }
  // As redactedTail: the types do not say `stringify` can return `undefined`.
  const serialized: unknown = JSON.stringify(inputs.mainBody)
  if (typeof serialized !== 'string') {
    throw new TypeError('judge side requests need a JSON main body')
  }
  // Redaction first (D77): a changed byte anywhere in the main body means the
  // prefix the cache would read is not the prefix sent.
  if (inputs.redact(serialized) !== serialized) {
    return { mode: 'standalone' }
  }
  if (inputs.prefixTokens < inputs.minPrefixTokens) {
    return { mode: 'standalone' }
  }
  const tail = redactedTail(inputs.redact, inputs.tail)
  const input: unknown[] = []
  for (const item of inputs.mainBody.input) {
    input.push(item)
  }
  input.push(tail)
  return {
    mode: 'shared-prefix',
    body: { ...inputs.mainBody, input },
  }
}
