# RVINT3 — independent review of the third integration round (2026-10-23, macmini)

Review lane with fix rights. Reviewed range: `3198954c91..bf7fcb66a1`
(main at 0.19.0). Thirteen integrator merges and seven `fix(int):`
commits. No branch was merged by this lane. Audit scripts from the
review live in `temp/rvint3/` (not committed).

## Method

For each integrator merge: `git show --remerge-diff` on conflicted
files, and the lane tip (second parent) compared with the merge blob.
A file whose merge blob equals the int parent is a drop only when
lane-unique behaviour is absent. Generated files were checked by their
own gates. Every `fix(int):` diff was read. Named collisions were
checked in the tree: `MOONSHOT_PRESET`, the RLM108/RLM95 overlap, the
accounts refusal sentence, PLAN archive moves, D212–D215, and whether
RLM96D landed a second team core.

## Findings fixed

### 1. The terminal called a missing accounts row an unknown provider (fixed, f435eac0c4)

`AccountStore.provider()` throws `AccountStoreError('unavailable')`
with cause `accounts.noAccountsEntry` when the metadata read answers
and the id has no row (`src/core/providers/accounts.ts`). The terminal
mapper ignored that cause and printed `UI_TEXT.providerUnknown`
("Unknown provider: {provider}."). That sentence is false for a known
provider that simply has no accounts row, and the connection sentence
is false because metadata answered. List, add, and auth set now share
`terminalAccountsFailure` (`src/runtime/providers/accountsCommand.ts:62`):
when the read answered, the entry id does not match, and the error is
`unavailable`, the sentence is `accounts.unavailableReason` filled with
`accounts.noAccountsEntry`. An entry that exists, and a read that
threw, still use `commandError`. ACP `accountErrorText` still maps by
code to the connection sentence; the cause does not cross that boundary.

CHANGELOG.md:522 already says `providers accounts` names a provider
with no accounts entry. No second bullet.

Drill: before the mapper change, `npx vitest run
test/unit/accountErrorTruth.test.ts --maxWorkers=3` exited 1 (3 failed,
12 passed): received "Unknown provider: testprov." and "Unknown
provider: anthropic-s2." After, the same command exited 0 (15 passed).
Repository timeout, no `--testTimeout`. Related suites
`accountErrorTruth`, `accountsCommand`, and `providerKeyConfirm` then
exited 0 (52 passed).

### 2. M96d's public status was the old planned line (fixed, 3ab6605ea0)

The plan reader keeps the first status line whose parenthetical note
does not match historical or superseded. M96d's 2026-10-10 "planned"
line came before the 2026-10-22 "built, pending integration" line, so
the public roadmap filed the milestone under Planned. The older line
is now marked historical (`PLAN.md:23634`). The built line
(`PLAN.md:23639`) is current. `npm run roadmap:generate` moved
**Machine-wide agent coordination** to In progress
(`ROADMAP.md:32`, "Built; not in a release yet."). `npm run
check:roadmap` exited 0.

### 3. The join still carried dead code and one copied loader (fixed, c98b8fe41b)

`npm run deadcode` exited 1 on four items, and `npm run duplication`
exited 1 on one 13-line TypeScript clone. Same defects round 2 named;
that branch is not an ancestor (below), so the fixes were re-applied
here after confirming the symbols were still unused.

- `paidAvailability` (`src/host/paid/paidHost.ts`, deleted above
  `createPaidFeatures` at line 248) had no caller. The live rule is
  inline in `src/extension.ts:1446`: tab, or the Model API backend, or
  a feature that is not default-on. Default-on is "no global setting
  value" (`src/extension.ts:1382`).
- `MAY_HOLD_SECRET` was re-exported from `src/core/redact.ts` and
  imported by nobody. The constant remains in `src/shared/redact.ts`.
- `JudgeLintOptions` in `src/runtime/judge/lint.ts` was exported and
  unused. `optionsSchema` is the parser. The interface is gone.
- `test/unit/helpers/judgeApprovalFixtures.ts` had no importer.
- `features()` in `test/unit/judgeP2RedesignSides.test.ts` and
  `test/unit/judgeWiringAssembly.test.ts` both loaded
  `dist/judgeP2.js`. It is now `shippedJudgeFeatures`
  (`test/unit/helpers/judgePhase2Rig.ts:26`).

Knip configuration hints and the four `@unwired` tag hints do not fail
the gate and were left.

Drill: after the edit, `npx vitest run
test/unit/judgeP2RedesignSides.test.ts
test/unit/judgeWiringAssembly.test.ts --maxWorkers=3` exited 0 (21
passed). `npm run duplication` exited 0 (0 clones). `npm run deadcode`
exited 0.

### 4. The capability witness still named the deleted function (fixed, 47d6c5961a)

`npm run check:reference` exited 1: "Host capability witness changed:
src/host/paid/paidHost.ts". The witness required the two lines that
lived only in `paidAvailability`. Those lines now guard the live
extension predicate (`scripts/lib/reference.mjs:471` and the
`globalValue === undefined` fragment at line 472). After that,
`npm run check:reference` exited 0.

## Findings that stand

- **Changelog and l10n.** Across all 13 integrator merges, lane-new
  `[Unreleased]` bullets missing from the merge: 0. Lane-new `en.ts`
  keys missing: 0.
- **RLPROVSYNC `providersCommands.ts`.** The merge blob equals the int
  parent. The lane's `anthropic-version` header lives in
  `src/runtime/providerReads.ts` (moved by `4be0ae403`). Keeping the
  int file is correct.
- **RLM108's partial overlap with RLM95.** About 35 merge blobs equal
  the int parent because RLM108 held an older slice. `credentialRead.ts`
  on the lane inlined a weaker subscription probe and dropped
  `readSubscriptionPresence`. Int kept. `servedEffortLevels` misses are
  later signature changes. The third-party-notices miss is wrapping.
- **RLM95B `providerRegistry.ts`.** Int's `unknownModelRefText` kept
  over the lane's shorter `UserRefusalError`.
- **Refusal sentences.** RLTESTDRIVE2's packed missing-entry sentence
  is what finding 1 restored on the terminal. RLM108's note that a
  causeless outage against a missing providers-file entry says
  "Unknown provider" described the sentence the integrator had forced.
  The accounts command no longer uses it. One `MOONSHOT_PRESET` remains
  (`src/core/providers/presets.ts:1191`, exported at line 1393).
- **RLM96D is not a second team core.** The coordinator is
  `src/core/team/coordinator/mode.ts`. `test/unit/helpers/teamBoard.ts`
  gained `refundAttempt` because the board context requires it.
  `tabIgnoreBlind.test.ts` and `realGit.ts` on the int side are the
  superset; the lane's CLT-first resolver still called `runFile('git')`.
- **D212–D215.** One header each: D212 secondary roles (`PLAN.md:15386`),
  D213 MCP eras (`PLAN.md:15465`), D214 ACP surface (`PLAN.md:15482`),
  D215 physical device safety (`PLAN.md:7769`). D216 is the Muse Code
  subscription route (`PLAN.md:13946`). RLM104's "D212 = MHP 1.5"
  commits are not in HEAD (below).
- **D121.** `2ec0a9c3e` and `1ad81b49a` remove a deadline of ours on
  governed git and keep the abort signal. `GIT_WORKTREE_TIMEOUT_MS` was
  not restored. No `it.skip` and no raised test timeout were added.
- **`fix(int):` commits** other than the accounts weakening in
  `a99370314` (finding 1) are minimal repairs: spend capability on new
  presets (`261edee65`), ACP schema path (`583c1a9f4`), routes and
  grammar (`4be0ae403`), board helper (`a6e926f2d`), shared lifecycle
  fields and clone helpers (`bf7fcb66a`). None raises a budget.
- **Catch inventory.** `npm run check:catches` exits 1 on this tree and
  exited 1 on `bf7fcb66a1` with the same rises: core SWALLOW 71→83,
  GENERIC 250→280, CLEANUP 239→243; host SWALLOW 18→22, GENERIC 98→105,
  CLEANUP 90→93; runtime SWALLOW 32→40, GENERIC 185→199, CLEANUP
  130→134; webview SWALLOW 9→11. The baseline was not rewritten.
  `src/runtime/judge/lint.ts:267` is the same GENERIC site, shifted by
  the deleted interface; the runtime GENERIC rise stayed 185→199.
  RVINT2 narrowed part of the round-2 rise on a branch that is not an
  ancestor. That baseline was not copied, and round 3 added more
  unbaselined sites. Re-doing every site is not this lane's patch.
- **Bundle size.** `npm run build` exits 1. Ten bundles are over budget,
  none raised: `reportingPanel.js` 50.6/50, `resourceGovernor.js`
  126.9/125, `resourceAdmission.js` 25.5/25, `modelApi.js` 544.3/525,
  `modelsPanel.js` 155.0/150, `usageService.js` 100.8/100,
  `teamScheduler.js` 75.3/75, `vaultActions.js` 25.1/25,
  `estimateContracts.js` 25.1/25, `wire.js` 76.2/75 (KiB). The size
  check stops the build before `check-bundle-split`. Run alone,
  `node scripts/check-bundle-split.mjs` exits 1: `dist/subscriptions.js`
  and `dist/vaultMigration.js` carry
  `src/core/providers/subscriptions/chatgptRecord.ts`, which the gate
  says loads only in `dist/providers.js`. None of those files are in
  this lane's diff.
- **`check:plan`.** Exits 1. PLAN.md is 3769716 bytes, over 85%
  (3565158) of the archived-plan budget. No history was archived, and
  no RVINT3 milestone was added, because either would make the file
  larger.
- **SAST.** Exits 1. Five blocking findings, all
  `detect-replaceall-sanitization` on `xml()` in
  `src/host/backend/deviceWorkerDarwin.ts:500`. That function landed in
  `715b4a7b1`, an ancestor of `3198954c91`, and this round does not
  touch the file. The escape is the XML character replacement, with
  `&` first. It was not rewritten and not silenced.
- **`npm run security:audit`.** Exits 1. Three highs are not excepted:
  GHSA-xcx6-jx8p-x3h5 (`@azure/msal-node`), GHSA-xjj6-f33q-929c
  (`undici`), GHSA-mrhx-c7xc-m3w5 (`zod`). One exception
  (GHSA-vfj7-8cjw-p6xm, braces) is stale. `package.json` and the lock
  are not in this lane's diff.

## Lanes named in the brief that are not in this round

The integrator merged 13 of the 17 named lanes. Not ancestors of HEAD,
and not merged by this lane (the brief does not list those merges):

- `rec/rlf-mcp2` `cbc053c81`
- RLM95C: no local branch
- RLM116: no local branch
- RLM104: `9ecf6e334`, `adc5ca49a`, `15edf3f3c`, `0ac46a881` exist and
  are not ancestors. Its D212 renumber never landed.
- `rec/rvint2` `77bc8a4e7` (review of round 2). Its dead-code and
  assembly-loader fixes were re-done here because the defects were
  still present. Its catch-baseline narrowing was not.

## Gates on the final tree

| Gate                                                               | Exit                                        |
| ------------------------------------------------------------------ | ------------------------------------------- |
| prettier --check (touched files)                                   | 0                                           |
| eslint --max-warnings 0 (touched files)                            | 0                                           |
| npm run typecheck                                                  | 0                                           |
| node scripts/check-l10n.mjs                                        | 0                                           |
| npm run check:reference                                            | 0                                           |
| npm run check:host-api                                             | 0                                           |
| npm run check:plan                                                 | 1 (size; owned)                             |
| npm run check:roadmap                                              | 0                                           |
| npm run check:catches                                              | 1 (rises above; same on bf7fcb66a1)         |
| npm run duplication                                                | 0                                           |
| npm run cycles                                                     | 0                                           |
| npm run deadcode                                                   | 0                                           |
| npm run build                                                      | 1 (ten bundles over budget; owned)          |
| node scripts/check-bundle-split.mjs                                | 1 (chatgptRecord; files outside this diff)  |
| security:sast (SSL_CERT_FILE=/etc/ssl/cert.pem, version check off) | 1 (Darwin xml escape from before the round) |
| npm run security:audit                                             | 1 (three highs; lock unchanged)             |

`npx vitest related` selects 3 files for `accountsCommand.ts` (all
passed), 0 for `paidHost.ts`, 0 for `runtime/judge/lint.ts`, and 450
for `core/redact.ts` (8 of them e2e, 19 vault) because that module is
imported across the tree. The redact edit removes an unused re-export.
The 450 were not run: the set includes live end-to-end suites, and it
is the whole unit battery. Direct consumers
`estimatorSnapshotStrict.test.ts` and `scanSecrets.test.ts` exited 0
(24 passed). `judgeP2Delivery.test.ts` exited 1 (19 failed, 83 passed):
16 cases exceeded the suite's own 60 s timeout while each runs five
split-gate processes (later cases of the same shape passed around 36 s);
the other three failures are the chatgptRecord split above. The
`judgeLint` child case for `src/runtime/judge/lint.ts` passed. No
timeout was raised.

No changelog bullet was added. No PLAN.md section was added.
