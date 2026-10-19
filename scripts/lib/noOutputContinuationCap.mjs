// The output-continuation rule (D121): a reply cut at the output limit keeps
// going for as long as the model is mid-answer — no count of ours ends it.
// Logic only: no main-module comparison (see check-no-output-continuation-cap.mjs).

import { readFileSync } from 'node:fs'

/**
 * Check the no-cap rule over one source file (ModelApiHost.ts).
 * Fails on missing, empty or unreadable input: no input is never a pass.
 * Returns `{ ok: true }` or `{ ok: false, problem }`.
 */
export function checkNoOutputContinuationCap(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return {
      ok: false,
      problem: 'output continuation guard: pass the ModelApiHost.ts path to check',
    }
  }
  let source
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return { ok: false, problem: `output continuation guard: cannot read ${filePath}` }
  }
  if (source.length === 0) {
    return { ok: false, problem: 'output continuation guard: empty input' }
  }
  if (source.includes('MODEL_API_CONTINUATIONS_MAX')) {
    return {
      ok: false,
      problem: 'output continuation guard: MODEL_API_CONTINUATIONS_MAX still caps the continuation',
    }
  }
  if (/outputContinuations\s*</.test(source)) {
    return {
      ok: false,
      problem: 'output continuation guard: the continuation still ends on a count',
    }
  }
  if (!source.includes("incompleteReason === 'max_output_tokens'")) {
    return {
      ok: false,
      problem: 'output continuation guard: no output-limit continuation found',
    }
  }
  return { ok: true }
}
