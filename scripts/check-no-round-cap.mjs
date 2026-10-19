#!/usr/bin/env node
// Guard: no round count of ours ends a turn (D121) — only a caller allowance
// the person set still bounds its run.
// node scripts/check-no-round-cap.mjs <path/to/ModelApiHost.ts>
// Exits 0 when no round cap remains; non-zero with the line that names the
// problem otherwise.
import { checkNoRoundCap } from './lib/noRoundCap.mjs'

const result = checkNoRoundCap(process.argv[2])
if (!result.ok) {
  console.error(result.problem ?? 'round cap guard: failed')
  process.exit(1)
}
console.log(`round cap guard: no cap ok (${process.argv[2]})`)
