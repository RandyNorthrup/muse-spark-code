#!/usr/bin/env node
// Guard: the last permitted call is always the wrap-up (tool rounds).
// node scripts/check-wrap-up-request.mjs <path/to/ModelApiHost.ts>
// Exits 0 when `wrapUpLimit` has its single writer and every request build
// passes through it; non-zero with the line that names the problem otherwise.
import { checkWrapUpSingleBuilder } from './lib/wrapUpSingleBuilder.mjs'

const result = checkWrapUpSingleBuilder(process.argv[2])
if (!result.ok) {
  console.error(result.problem ?? 'wrap-up request guard: failed')
  process.exit(1)
}
console.log(`wrap-up request guard: single builder ok (${process.argv[2]})`)
