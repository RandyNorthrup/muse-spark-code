# PR #229 review threads — triage and fixes (lane PR229FIX, branch `fix/nolimits-1-fin`)

One line per thread; each item ends FIXED in this lane or ANSWERED with the
earlier commit / a measured reason. No model calls, no credentials.

## Triage (committed first)

- T1 `imageGeneration.ts:59` ten-source edit limit — FIX in this lane: enforce
  Meta's documented 1–10 edit-item range in the runtime schema and tool
  definition (the provider's own limit, so the Limits rule allows it).
- T2 `bestOfN.ts:76` eager attempt materialization — FIX in this lane: build
  attempts lazily after the account/consent checks with a cancellation point
  per item; launches already pass through background resource admission.
- T3 `execArgs.ts:131` large budget vs ledger — FIX in this lane: drop the
  `Number.MAX_SAFE_INTEGER` ceiling in the ledger's `units()` so it supports
  the same range the parser accepts (BigInt throughout).
- T4 `rename.test.ts:17` invented fixtures — ANSWERED by `d3ef3d00fd`:
  the suite drives the real `mergePlacedEdits` with plain internal-type
  literals (no mocks, no stand-ins, no wire boundary), and was seen to fail
  with the old ceiling restored; there is no outside-world input here for
  the recorded-exchange rule to govern.
- T5 `promptCommands.ts:272` unbounded share filename — FIX in this lane:
  keep the title unlimited, bound the derived suggested filename to the
  platform's component limit where the save dialog default is built.
- T6 `mcpBridge.ts:642` duplicated check names — FIX in this lane:
  deduplicate the requested names before scheduling; distinct checks stay
  unbounded.

## Fixes
