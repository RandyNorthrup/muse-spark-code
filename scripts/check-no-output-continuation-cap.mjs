#!/usr/bin/env node
// Guard: a reply cut at the output limit keeps going while the model is
// mid-answer (D121) — no count of ours ends it.
// node scripts/check-no-output-continuation-cap.mjs <path/to/ModelApiHost.ts>
// Exits 0 when no continuation cap remains; non-zero with the line that
// names the problem otherwise.
import { checkNoOutputContinuationCap } from './lib/noOutputContinuationCap.mjs'

const result = checkNoOutputContinuationCap(process.argv[2])
if (!result.ok) {
  console.error(result.problem ?? 'output continuation guard: failed')
  process.exit(1)
}
console.log(`output continuation guard: no cap ok (${process.argv[2]})`)
