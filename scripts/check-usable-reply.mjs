#!/usr/bin/env node
// Guard: a capped turn is never read as a finished one (tool rounds).
// node scripts/check-usable-reply.mjs <source root>
// Exits 0 when every completed-terminal comparison lives in the accessor or
// the allow-list; non-zero naming each violation otherwise. No default root:
// missing input is a failure, never a pass.
import { checkUsableReply } from './lib/usableReplyGuard.mjs'

const result = checkUsableReply(process.argv[2])
if (!result.ok) {
  console.error(result.problem ?? 'usable-reply guard: failed')
  process.exit(1)
}
console.log(`usable-reply guard: no raw completed-terminal reads (${process.argv[2]})`)
