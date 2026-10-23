# RLF-TAB — M94 rows that need no live call, recovery lane record

Branch `rec/rlf-tab`, worktree on macbook (the owner's MacBook),
2026-10-22. Base: `397aca3dd` (main at 0.19.0 plus 15 merged
lanes, incl. RLFINISH). The brief: close the M94 acceptance rows
RLFINISH left open that need no live call, and work the activation
shim (acceptance 19) from 10.336 KiB toward the 4 KiB ambition by
moving code out of activation, never by raising a budget. The live
check is in B4.

Live calls made by this lane: 0. No paid or live model calls; the
brief names none.

## What landed

Each row below names the real-code suite that closes it. All suites
run with the repository's own timeouts; counts are the final green
runs on this tree.

- **Acceptance 1 and 18 (arming; activation loads nothing).**
  `test/unit/tabActivation.test.ts` (6 green): off sends and loads
  nothing, on arms the registration and the status, teardown clears
  the context. `test/unit/tabLoader.test.ts` (3 green): the
  six-entry bundle shape guard and the loader's words. The first-use
  wiring (`createTabLoaded`) lives inside `dist/tab.js`; the shim
  passes its readers through on the first request.
- **Acceptance 2 (no key).** `test/unit/tabStatusModel.test.ts`
  (15 green, shared with 15): the bar says no key and Tab never
  prompts for one.
- **Acceptance 3 (where it stays quiet).**
  `test/unit/tabYield.test.ts` (9 green): the language switch
  (exact, wildcard, default on) and the Copilot posture read.
- **Acceptance 4 (files it never reads).**
  `test/unit/tabEligibility.test.ts` (25 green, shared with 5, 8,
  13): `files.exclude` (spanning globs, name-only patterns, `when`
  siblings, refusals, uncompilable and over-limit patterns),
  forbidden names, eligibility over real git and real hook
  fixtures. `test/unit/tabIgnoreBlind.test.ts` (8 green): tracked
  cursorignore/continueignore, the fail-closed blind rule, the
  generation that re-asks a check begun before an ignore change.
- **Acceptance 5 (secrets).** `tabEligibility.test.ts`: the
  redacted halves over the real redactor.
- **Acceptance 8 (typing through and partial accept).**
  `tabEligibility.test.ts`: the inferred partial accept and the
  text-change projection.
- **Acceptance 10 (the daily budget).**
  `test/unit/tabLedgerRace.test.ts` (4 green): two writers never
  pass the budget together, racing or in turn; an open reservation
  survives a restart. `test/unit/tabLedgerSilence.test.ts`
  (3 green, shared with 20): a corrupt or unreadable ledger
  refuses the request.
- **Acceptance 11 (the question).** `test/unit/tabConsent.test.ts`
  (12 green): first request asks; Allow once covers the window;
  Always persists per workspace and is voided by a price change or
  revocation; Deny snoozes; the legacy migration asks once; one
  key per (model, price).
- **Acceptance 13 (modes).** `tabEligibility.test.ts`: fast or
  multi-line by D73's rules, Invoke always multi-line and one item.
- **Acceptance 14 (Copilot).** `tabYield.test.ts`: automatic
  requests yield while Copilot serves the language; Invoke still
  works.
- **Acceptance 15 (status bar and snooze).**
  `tabStatusModel.test.ts`: every D73 state, the spend tooltip, the
  budget warning background. `test/unit/tabSnooze.test.ts`
  (3 green): the shared 15-minute snooze ends on time in every
  window.
- **Acceptance 16 (Account & usage).**
  `test/unit/paidUsageTabRow.test.tsx` (5 green): unknown budget
  before Tab state arrives, none when the person set none, the set
  budget, requests/tokens/cached tokens/reported cost once Tab has
  run, off with the budget before the first run.
- **Acceptance 17 (hooks).** `test/unit/tabHooks.test.ts`
  (11 green): deny, exit 2, timeout and oversize answers; invalid
  and reloading configuration; verdicts cached per path, content,
  model and policy epoch and re-asked when the epoch moves; the
  `afterTabFileEdit` payload, its inferred flag and its queue
  bound; the preview cap.
- **Acceptance 20 (logs).** `tabLedgerSilence.test.ts`: no folder,
  no content and no secret in any warning over real failures. The
  loader's words stay fixed.
- **Acceptance 19 (size).** Measured below. `dist/tab.js` holds at
  65.3/75 KiB; `dist/extension.js` at 454.7/600 KiB.

The provider's file, consent, snooze, status, yield and loader
decisions moved out of activation into `src/host/tab/tabYield.ts`,
`tabSnooze.ts`, `tabStatusModel.ts`, `tabStatusItem.ts`,
`tabLoader.ts`, `tabConsent.ts` and `tabEligibility.ts`;
`tabBundle.ts` keeps a type-only `vscode` import with status,
budget notice and consent readers injected. The new code carries
one NARROW catch (an over-limit exclude pattern is the user's typo
and excludes nothing; everything else rethrows): host CLEANUP
92 → 91, baseline regenerated. The host-api record follows the
refactor (`tabBundle.ts` 24 → 1 VS Code API uses). The Tab test
fixtures share `test/unit/helpers/tabQuietFixtures.ts`; the
duplication gate reports 0 clones.

`test/integration/tab.test.ts` (18 cases, written, NOT RUN on this
rig — no GUI on the MacBook) drives the real provider and the real
activation inside the Extension Development Host with zero network:
16 quiet-path cases over real documents plus activation
arming, first-use load and teardown. For hosted CI (stable and
minimum).

## Acceptance 19, measured

Tab-attributable bytes in `dist/extension.js` from
`dist/meta/extension.json` (inputs under `src/host/tab/` and
`src/core/tab/`, `bytesInOutput` summed):

- Base `397aca3dd` (built in a scratch worktree): 10,852 bytes =
  10.598 KiB.
- This lane: 8,331 bytes = 8.136 KiB (−2,521 bytes, −23%).

The lane's remainder: `tabBundle.ts` 2,932 (registration core),
`tabStatusModel.ts` 2,138 + `tabStatusItem.ts` 1,261 (the status bar
shows at startup by acceptance 1), `tabLoader.ts` 759,
`tabYield.ts` 550 (the startup Copilot read), `tabIgnoreFile.ts`
397, `tabSnooze.ts` 294. No budget was raised or moved. The 4 KiB
ambition stays open: reaching it needs a product decision (defer
the status bar until first use), not a refactor.

## Red/green drills

Each drill breaks the guard on purpose, shows the failing suite's
non-zero exit, restores the file byte-identical (`git checkout`),
and shows the suite green. D8 ran earlier in the lane; D1–D7 and
D9–D15 ran on the final tree.

- D1 yield default: `tabYield.ts` `?? true` → `?? false`.
  `tabYield`: 1 failed / 8 passed, exit 1
  (`isTabLanguageOn > reads the exact switch first, then the
wildcard, then on`). Restored: 9 passed, exit 0.
- D2 snooze boundary: `tabSnooze.ts` `> nowMs` → `>= nowMs`.
  `tabSnooze`: 2 failed / 1 passed, exit 1. Restored: 3 passed,
  exit 0.
- D3 budget warning: `tabStatusModel.ts`
  `if (snapshot.budgetReached)` →
  `if (!snapshot.budgetReached && snapshot.isKeyStored)`.
  `tabStatusModel`: 7 failed, exit 1. Restored: 15 passed,
  exit 0.
- D4 bundle shape: `tabLoader.ts` drops the `createTabLoaded`
  entry check. `tabLoader`: 1 failed / 2 passed, exit 1
  (`accepts the six entries and refuses anything else`).
  Restored: 3 passed, exit 0.
- D5 consent window cache: `tabConsent.ts` `current === token` →
  `current !== token`. `tabConsent`: 2 failed / 10 passed,
  exit 1. Restored: 12 passed, exit 0.
- D6 invoke mode: `tabEligibility.ts` Invoke returns `'fast'`.
  `tabEligibility`: 1 failed / 24 passed, exit 1
  (`chooseTabMode > invoke chooses …`). Restored: 25 passed,
  exit 0.
- D7 shim arming: `tabBundle.ts` `arm()` skips
  `registerProvider`. `tabActivation`: 2 failed / 4 passed,
  exit 1. Restored: 6 passed, exit 0.
- D8 exclude NARROW guard: `tabEligibility.ts`
  `error instanceof RangeError` → `error instanceof TypeError`.
  `tabEligibility`: 1 failed / 24 passed, exit 1
  (`excludes nothing for a pattern past the compiler limits`).
  Restored: 25 passed, exit 0.
- D9 ledger race: `tabLedger.ts` day total drops reservations.
  `tabLedgerRace`: 3 failed / 1 passed, exit 1. Restored:
  4 passed, exit 0.
- D10 hook epoch: `tabHooks.ts` drops the epoch from the verdict
  key AND the `verdicts.clear()` on epoch move. (Either break
  alone stays green: the key, the clear and the mid-read recheck
  are triple guards; the key-only break ran 11 passed, exit 0.)
  Both: `tabHooks` 1 failed / 10 passed, exit 1
  (`asks again when the epoch moves or the model differs`).
  Restored: 11 passed, exit 0.
- D11 ignore generation: `tabIgnore.ts` drops
  `this.generation += 1`. `tabIgnoreBlind`: 1 failed / 7 passed,
  exit 1 (`refuses a read the ignore files keep changing under`).
  Restored: 8 passed, exit 0.
- D12 usage row: `PaidUsageSection.tsx` defaults the Tab budget
  line to none instead of unknown. `paidUsageTabRow`: 1 failed /
  4 passed, exit 1. Restored: 5 passed, exit 0.
- D13 ledger log silence: `tabLedger.ts` warns with the ledger
  folder. `tabLedgerSilence`: 1 failed / 2 passed, exit 1
  (`names no folder and no content when its own file fails`).
  Restored: 3 passed, exit 0.
- D14 split gate: `deferredBundles.mjs` names
  `tabConsentX.ts` in the Tab inventory.
  `check-bundle-split`: `dist/tab.js no longer carries
src/host/tab/tabConsentX.ts`, exit 1. Restored: green,
  exit 0.
- D15 size gate: `check-bundle-size.mjs` Tab budget 75 → 65.
  `OVER dist/tab.js: 65.3 KiB (budget 65 KiB)`, exit 1.
  Restored: `ok dist/tab.js: 65.3 KiB (budget 75 KiB)`
  (the check still exits 1 on the three base-state OVERs below).

## Gates

Final runs on this tree (exit codes; the two failures are
measured identical on the untouched base, see below):

- prettier `--check` on touched files: 0.
- eslint `--max-warnings 0` on touched files: 0.
- `npm run typecheck` (all projects): 0.
- `node scripts/check-l10n.mjs`: 0 (0 problems).
- `npm run check:reference`: 0.
- `npm run check:host-api`: 0 (record regenerated for the
  refactor).
- `npm run check:plan`: 1 — PLAN.md over 85% of the archived-plan
  budget. Measured on the untouched base (`397aca3dd` in a
  scratch worktree): exit 1, same message, 3,668,951 bytes; this
  tree adds only the required 1,034-byte status paragraph. The
  archive step (CONTRIBUTING.md) needs every open branch's PLAN.md
  merged onto the new file; with the recovery lanes in flight
  that is the lead's integration step, not this lane's.
- `npm run check:roadmap`: 0 (ROADMAP.md current; the status
  line changes no fingerprinted field).
- `npm run check:catches`: 0 (all sites match the regenerated
  baseline).
- `npm run duplication`: 0 (0 clones).
- `npm run cycles`: 0 (no circular dependency).
- `npm run deadcode`: 0.
- `npm run build`: 1 — `OVER dist/resourceAdmission.js:
25.0 KiB (budget 25 KiB)`, `OVER dist/modelApi.js: 527.7 KiB
(budget 525 KiB)`, `OVER dist/vaultActions.js: 25.0 KiB
(budget 25 KiB)`. Measured on the untouched base: exit 1 with
  the byte-identical three OVERs. This lane touches none of
  those bundles' inputs; its own lines hold (`dist/tab.js`
  65.3/75 KiB, `dist/extension.js` 454.7/600 KiB). No budget was
  raised or moved.
- `node scripts/gen-lazy-registry.mjs --check`: 0.
  `check-host-globals`: 0. `third-party-notices`: 0.
  `check-legal-build-records`: 0.
- Touched unit suites: 104 green across 12 files (counts above),
  repository timeouts, `--maxWorkers=3`.
- `npx vitest related --run` over the 12 changed sources: 0
  (7 files, 73 green).
- `npm run security:audit`: 0 (4 advisories, 2 exceptions).
- `npm run security:sast`: not run — semgrep is not installed
  on this rig (`semgrep is not installed: pip install -r
.github/semgrep/requirements.txt`, exit 1). Hosted CI owns it.
- `test/integration/tab.test.ts`: not run — no GUI on the
  MacBook. Hosted CI (stable and minimum) owns it.

## Open

- The served-path live suggestion and the B4 live check (~3
  calls): explicitly out of this lane, with the owner/lead.
- The acc-19 4 KiB ambition: 8.136 KiB reached by refactor; the
  rest needs the product decision noted above.
- `check:plan` (archive) and the three build OVERs: measured
  base-state, for the lead's integration.
- The integration suite's first run: hosted CI.
- No CHANGELOG entry: the lane changes no behaviour a person
  notices (a tested refactor toward the size ambition).
