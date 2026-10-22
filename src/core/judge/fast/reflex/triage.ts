// M125 lane R (D107): first-send triage of one tool result. The safe
// direction is reading: a recognised failure signal needs the full
// output, and only a blank success is confidently skipped. Anything
// else misses to the engine (or, with no engine, goes out whole as
// today). Pure and synchronous; no model, no network, no file writes.
export interface TriageInput {
  /** The tool's exit code when the tool reports one. */
  readonly exitCode: number | undefined
  /** The tool's merged output text. */
  readonly output: string
}

export type TriageVerdict =
  | { readonly decision: 'needs-full' | 'skip'; readonly reason: string }
  | { readonly decision: 'miss' }

const FAILURE_MARKERS: readonly RegExp[] = [
  /fail/i,
  /error/i,
  /exception/i,
  /traceback/i,
  /not found/i,
  /no such/i,
  /denied/i,
  /refused/i,
  /unable to/i,
  /cannot/i,
]

/** Triage one result: read fully, skip, or miss to the engine. */
export function triageOutput(input: TriageInput): TriageVerdict {
  if (input.exitCode !== undefined && input.exitCode !== 0)
    return { decision: 'needs-full', reason: 'nonzero-exit' }
  const marker = FAILURE_MARKERS.find((pattern) => pattern.test(input.output))
  if (marker !== undefined) return { decision: 'needs-full', reason: 'failure-marker' }
  return input.exitCode === 0 && input.output.trim().length === 0
    ? { decision: 'skip', reason: 'blank-success' }
    : { decision: 'miss' }
}
