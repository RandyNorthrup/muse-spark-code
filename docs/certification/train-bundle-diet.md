# Train bundle diet (lane TRAINDIET)

Worktree `/home/randy/lanes/TRAINDIET`, branch `fix/train-bundle-diet`,
base `803f42f95` (train) compared against release base `35d7b6f54`
(scratch worktree, removed after measuring). No cap, budget-table or gate
change. No behaviour change: every value is identical, only the spelling
of initialisers changed or pure builders moved behind factories.

## Before / after (bytes, production `npm run build`)

| Bundle                                | Base 35d7b6f54 | Train before | Train after | Cap     | Headroom |
| ------------------------------------- | -------------- | ------------ | ----------- | ------- | -------- |
| dist/usagePanel.js                    | 76,495         | 76,827       | 73,747      | 76,800  | 3,053    |
| dist/modelsPanel.js                   | 127,734        | 127,688      | 125,999     | 128,000 | 2,001    |
| dist/headless.js                      | 101,810        | 101,911      | 98,323      | 102,400 | 4,077    |
| dist/estimator.js                     | 68,647         | 68,746       | 67,989      | 76,800  | —        |
| dist/webview resource history closure | ~50,586        | 50,636       | 50,543      | 51,200  | 657      |
| dist/webview estimator panel closure  | 25,479         | 25,479       | 25,479      | 25,600  | 121      |

Targets from the brief: usagePanel at least 1,500 B under its cap
(3,053 under: met), modelsPanel and headless at least 1,000 B more
headroom each (1,689 and 3,588 more respectively: met). The inherited
`dist/webview surface English` OVER (26.5/25 KiB) is the release
branch's, left alone.

## What arrived since the release base (usagePanel +332 B)

usageJournal.ts +183, l10n/usageEn.ts +178, constants.ts +75
(Git-in-every-editor constants: all droppable literals), usagePage.ts
+24, exactUsd.ts +24, minus small shrinkages elsewhere. Neither merge is
wrong: the bytes are shared-code drag, fixed below by class, not by
reverting arrivals.

## The class and the fixes

A top-level initialiser esbuild cannot drop rides into EVERY bundle that
imports its module. Verified against esbuild 0.28.2 production settings:
pure literals, literal arrays/objects and literal-argument `new Set/Map`
drop; calls, tagged templates, property reads on globals, `new` with
call arguments, templates over identifiers and property reads on module
objects pin. A /* @**PURE** */ mark drops only when its own arguments
are droppable too, so nested `z.*` builders need the no-argument IIFE
form (the usdSchema.ts precedent); a bare mark on a nested builder was
measured ineffective and is rejected by the new guard.

- Literals for computed/one-shot strings
  (`src/shared/constants.ts`, `src/shared/browserCheckConstants.ts`):
  MAX_ATTACHMENT_BASE64_CHARS is now `42_666_668` (was `4 *
Math.ceil(32_000_000 / 3)`); five `String.raw` paths, `String.
fromCodePoint(92)` and `'0'.repeat(64)` are plain strings. Values
  verified byte-exact with node before editing.
- Literal set members (`src/shared/constants.ts`): WEB_FETCH_TOOLS and
  IDE_PAID_TOOLS spell their `mcp__ide__*` members out; a template over
  the source constant pinned each set. `test/unit/bundleDiet.test.ts`
  pins the sync with the constants.
- Pure factories: VERIFY_ROW_TOOLS (double mark: the `new` and the inner
  `Object.values`), usageAccountFields (test-only, now an IIFE),
  providerRouting's openRouterRoutingSchema/customCompatSchema,
  resources' settings/status/record/device/sample/diskVolume/minute
  schemas, each marked and IIFE-wrapped where nested.
- Pure schema builders: every `z.*` head in `src/shared/team.ts`,
  `estimate.ts`, `resources.ts`, `resourceHistory.ts`, `accounts.ts`,
  `providerRouting.ts`, `usagePage.ts` and `usageJournal.ts` carries
  /* @**PURE** */. Dense graphs (team, usagePage) keep their reachable
  chains; the win is the unreachable fringe (usageJournal −755 B in
  usagePanel, resources −1,994 B for the exec-sink subset by probe).

## Guard and red drill

`test/unit/bundleDiet.test.ts`: scans `src/shared/constants.ts` with the
TypeScript compiler API and fails naming any top-level export whose
initialiser is not droppable (call without pure arguments, tagged
template, global read, `new` with impure arguments), plus the two
literal-set sync checks. Drill: appended `export const
DRILL_PINNED_TRAIN_DIET = Math.ceil(7 / 2)` → test failed with
`DRILL_PINNED_TRAIN_DIET (line 8010): impure call arguments`; removed
it and verified SHA-256 `503163d784cad09ff92dedb13146839ed2a2bd0b2271df819fa25b273e9d24b6`
matches the pre-drill file byte-exact, test green again (2 passed).

## Found but left, with reasons

- Estimator panel closure (121 B left, unchanged): structurally dense.
  `estimateSectionSchema` embeds `inputs: estimateInputsSchema`, so the
  panel parses the full engine shape; splitting it is a protocol change,
  out of scope for a diet lane.
- `src/shared/l10n/text.ts` formatter state (`stateFor` call,
  UI_TEXT clone): genuine in all five targets (all format text).
- `FILE_REFUSAL_MODEL_TEXT` in usagePanel: reachable through
  `writeFileAtomically` → `assertBoundPath`, not drag.
- `team.ts` schemas: dense chains from the eight panel-used schemas;
  annotations kept as true hygiene, near-zero bytes.
- Binary-arithmetic consts (`15 * 60_000` style): pinned only while a
  module has live side effects; unpinnable per-const without splitting
  `constants.ts`, which is a bigger refactor than this lane.
- Residual accepted pinning the guard does not flag (no instances of
  local property-read initialisers; identifier templates such as
  EXTENSION_QUALIFIED_ID stay as the minimal spelling).
