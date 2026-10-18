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

## Fixes (commits on `fix/nolimits-1-final-fix`)

- T1 (`e0f4e8af4f`): `editImageArgs` enforces Meta's own 1–10 range
  (`IMAGE_EDIT_SOURCE_MIN/MAX` in `src/shared/constants.ts`); the shared
  `EDIT_IMAGE_PARAMETERS` names one-to-ten with min/maxItems, so both the
  Model API tool and the `ide` tool refuse 0 and 11+ before any source is
  read or the paid-use question is asked. `imageArgs.test.ts` proves 10
  parses and 11 refuses (the old schema accepted 11); prompt length stays
  unbounded.
- T2 (`7f07354f1b`): `BestOfNRunner.start()` no longer pushes N entries up
  front. The run is registered empty, the account/budget/consent checks run,
  then the worktree loop materializes one attempt at a time with a
  cancellation point per item; launches still pass through background
  resource admission. No ceiling added, no new test (a `start()` test would
  need stand-ins for the coordinator/git/worktree deps, which policy
  forbids); verified by typecheck, eslint and build.
- T3 (`10a1951e63`): the ledger's `units()` holds micro-USD as BigInt with
  no ceiling — only negative refuses — matching the parser and `microUsd()`
  in `runExec.ts`. Extended the existing D121 tests: `9007199255` USD
  parses in `execArgs.test.ts` and admits with exact `capUsd`/`remainingUsd`
  in `runLedger.test.ts` (9,007,199,255,000,000 > 9,007,199,254,740,991, so
  the old ceiling refused it).
- T4 (answered, no change): `d3ef3d00fd` already covers it — see Triage.
- T5 (`bf1ffe8a06`): new pure `promptShareFilename()` in
  `src/shared/prompts.ts` keeps the title unlimited and cuts only the
  suggested filename component to 255 bytes on a UTF-8 boundary; the save
  dialog in `promptEntry.ts` uses it. `prompts.test.ts` proves short names
  are unchanged, 240 ASCII chars fit exactly, and multibyte titles (including
  a cut landing mid-sequence) stay valid and within budget.
- T6 (`570ef7dd84`): `bridgeRunChecks` deduplicates `names` before
  scheduling, keeping order; distinct checks stay unbounded. No new test
  (the call needs routing deps no real-code test can supply).

## Gates on the final tree (all exit 0)

- prettier `--check` on all 13 changed files: clean
- eslint `--max-warnings=0` on all changed src/test files: clean
- `npm run typecheck` (all five projects): 0
- `npm run check:plan`: 0 drift; `node scripts/check-l10n.mjs`: 0 problems
- `npm run build` (production + size/split/host-globals/notices): 0
- suites: `imageArgs` 4/4, `toolImages` 6/6, `runLedger` + `execArgs` 91/91,
  `prompts` 26/26, `bestOfN` 15/15, `rename` 2/2 — repo default timeout,
  no `--testTimeout`
- T2/T6 ship without new unit tests for the measured reason above (a test
  would need stand-ins for runner/routing deps, which policy forbids);
  covered by typecheck, eslint and build.
