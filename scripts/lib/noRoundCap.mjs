// The turn rule (D121): no round count of ours ends a turn — it runs until
// the model answers without a tool call, the person stops it, a hook stops
// it, the provider refuses, or a limit the person set is spent. A caller's
// own allowance (exec --max-requests, a best-of-N attempt ceiling) still
// bounds its run. Logic only: no main-module comparison
// (see check-no-round-cap.mjs).

import { readFileSync } from 'node:fs'

/**
 * Check the no-cap rule over one source file (ModelApiHost.ts).
 * Fails on missing, empty or unreadable input: no input is never a pass.
 * Returns `{ ok: true }` or `{ ok: false, problem }`.
 */
export function checkNoRoundCap(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { ok: false, problem: 'round cap guard: pass the ModelApiHost.ts path to check' }
  }
  let source
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return { ok: false, problem: `round cap guard: cannot read ${filePath}` }
  }
  if (source.length === 0) {
    return { ok: false, problem: 'round cap guard: empty input' }
  }
  if (source.includes('MODEL_API_MAX_TOOL_ROUNDS')) {
    return {
      ok: false,
      problem: 'round cap guard: MODEL_API_MAX_TOOL_ROUNDS still caps the turn',
    }
  }
  if (!source.includes('callerModelCallsLeft() ?? Infinity')) {
    return {
      ok: false,
      problem: 'round cap guard: the turn default is not caller-allowance-or-unbounded',
    }
  }
  if (!source.includes('callerModelCallsLeft()')) {
    return {
      ok: false,
      problem: "round cap guard: the caller's own allowance is no longer honoured",
    }
  }
  return { ok: true }
}
