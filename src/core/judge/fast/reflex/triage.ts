// M125 lane R (D107): first-send triage of one tool result. The safe
// direction is reading: a recognised failure signal needs the full
// output, and only a blank success or a recognised passing summary is
// confidently skipped. Anything else misses to the engine (or, with no
// engine, goes out whole as today). Pure and synchronous; no model, no
// network, no file writes.
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

const ESCAPE = '\u{1B}'
const SGR_PATTERN = new RegExp(`${ESCAPE}[[][0-9;]*m`, 'gu')

// Strict passing summaries, each from a recorded fixture: vitest's
// count lines (vitest-pass.txt) and git's clean tree
// (git-status-clean.txt). jest, pytest, cargo, a non-blank tsc or
// eslint and npm install stay misses until their summaries are
// captured on a rig.
const PASS_SUMMARIES: readonly RegExp[] = [
  /Test Files\s+\d+ passed\b/,
  /Tests\s+\d+ passed\b/,
  /nothing to commit, working tree clean/,
]

/** Triage one result: read fully, skip, or miss to the engine. */
export function triageOutput(input: TriageInput): TriageVerdict {
  if (input.exitCode !== undefined && input.exitCode !== 0)
    return { decision: 'needs-full', reason: 'nonzero-exit' }
  const marker = FAILURE_MARKERS.find((pattern) => pattern.test(input.output))
  if (marker !== undefined) return { decision: 'needs-full', reason: 'failure-marker' }
  if (input.exitCode !== 0) return { decision: 'miss' }
  if (input.output.trim().length === 0) return { decision: 'skip', reason: 'blank-success' }
  // Count lines carry SGR sequences between their own words, so the
  // summaries read through them (lane K's failures parser does too).
  const plain = input.output.replaceAll(SGR_PATTERN, '')
  const summary = PASS_SUMMARIES.find((pattern) => pattern.test(plain))
  return summary === undefined ? { decision: 'miss' } : { decision: 'skip', reason: 'pass-summary' }
}
