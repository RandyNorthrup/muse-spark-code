# CC-INT3 — merge round 3 on int/recovery (2026-10-30)

Claude Code lane `CC-INT3`, worktree `/Users/user/lanes/CC-INT3`, branch
`cc/int3`, on the test rig `MacBookPro.ivettnet` (macOS, Darwin 24.6.0, Intel
x86_64, Node 24.21.0, npm 11.19.0). Base: int/recovery `b781451b9` (CC-INT2's
round, `docs/certification/cc-int2.md`, whose known failures and CC-INT1's
(`cc-int1.md`) are not counted against a merge here). Model attempts: **0**.
Provider calls: **0**. Muse requests: **0** (the allowance is used up until
2026-10-25 17:00 Pacific; no real conversation, no nested ACP or CLI session).
Nothing was pushed, rebased, stashed or tagged. The vault and real
credential-store suites (`keyringParts`, `keystoreOwner`, `credentialLease`,
`providerHeadersStore`, `test/unit/vault/**`, `deviceOwnerVaultUses`,
`deviceOwnerBind`, `devicePairKeyDpapi`) were never run on this MacBook, and no
browser or GUI app was started. Scratch files lived in the worktree's ignored
`temp/` (two Python venvs, a scratch `HOME` and workspace, an extracted copy of
the base, logs).

## 1. The merges

Fetched with `git fetch ~/gates/muse.git "refs/heads/lanes/<name>:refs/remotes/<name>"`
and merged with `git merge --no-ff`, in the brief's order.

| #   | Branch (tip)                         | Merge commit | Conflicts                                                                                                                                                                                                                                    |
| --- | ------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lanes/rlf-safelimits` (`4fe41c2a9`) | `43f3f805d`  | `src/core/tab/tabEngine.ts`, `src/runtime/reporting/playbookSchedulesInputs.ts`, `test/unit/scheduleFsRetryStop.test.ts`; `CHANGELOG.md`, `PLAN.md`, `docs/roadmap/entries.json` (adjacent additions, both kept), `ROADMAP.md` (regenerated) |
| 2   | `lanes/cc-winruns` (`deb603704`)     | `ede593df7`  | `CHANGELOG.md`: both lanes added the first entry of the `### Fixed` list under `[Unreleased]`; both kept                                                                                                                                     |

Two merge-interaction commits, each naming the merge:

| Commit      | What                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `9d45f12bd` | `fix(int)`: the Tab backstop is proven on the real client over a silent connection (rlf-safelimits)         |
| `d9df856ab` | `fix(int)`: the CI lookup bound is proven on the platform's fetch over a silent connection (rlf-safelimits) |

## 2. What each merge needed

### 2.1 `lanes/rlf-safelimits` (13 commits, built on `f53ef168f`)

Ten safety limits restored at the values the lane cites, each stopping with
words (R1 schedule storage retry and the report reader's snapshot bound, R2
orphan sweep rounds, R3 registry visibility wait, R4 git worktree and checkout
deadlines, R5 created-registry republish bound with the new `contended`
reason, R6 recording cleanup retries, R7 hand-off default, R8 Tab's sent-request
backstop, R9 the CI lookup bound). int's decisions around them:

- **R8, `tabEngine.ts`.** int had added the per-request stream for
  bring-your-own Tab models (`request.stream ?? deps.stream`) where the lane
  had `deps.stream`. Merged: the backstop's signal goes to whichever stream the
  request names. The lane's `neverAborted` signal is gone with the "no timeout
  of ours" comment it replaced; nothing else in the file read it.
- **R1, `playbookSchedulesInputs.ts`.** int's issues reader, playbook ordering
  and parse-failure import kept; the lane's `SCHEDULE_FS_RETRY_ATTEMPTS` joins
  the existing `shared/constants` import. The snapshot loop is bounded by the
  same five attempts and then answers `busy`.
- **R1, `scheduleFsRetryStop.test.ts`.** int had changed the stop case to read a
  file that exists (Windows reads a missing name under a denied folder as
  missing, not as the denial; hosted CI runs Windows). Kept for the stop case,
  with the lane's 50 ms abort (inside the five attempts' ~200 ms of backoff; int's
  300 ms would now land after they ran out). The lane's new bound case read a
  name that did not exist, which would be `ENOENT` on Windows; it now publishes
  the file first.
- Auto-merged where int had also changed the file: `commands.ts`, `launch.ts`,
  `process.ts` (the hand-off default), `heldCheckout.ts`, `processTree.ts` (the
  sweep bound; int's POSIX supervisor move is elsewhere in the file),
  `constants.ts`, `en.ts`, the 14 tables, `release.yml`, `RELEASING.md`. The
  typecheck, l10n and build gates cover them (§3).
- **Stand-ins in two of the lane's tests, replaced (`9d45f12bd`, `d9df856ab`).**
  R8's test fed the engine a hand-written stream that pretended to hang; R9's fed
  the lookup a never-settling `fetch` standing in for GitHub. Both now use real
  parts: `tabEngine.test.ts` sends the product's own `ModelApiClient` stream
  through the engine to a loopback connection (`node:net`) that is accepted and
  never answered, with the 200 ms backstop; `releaseReuseTimeout.test.mjs` sends
  the platform's `fetch` to the same kind of connection, rewriting only the host
  (the path, headers and the bound's `AbortSignal.timeout` are the product's).
  No provider bytes cross either test. Their drills are in §7.
- **Not changed, said plainly.** `tabEngine.test.ts`'s older cases
  (`throwingStream`, `silentStream`, the admit-gate stream) and
  `publishRegistry.test.mjs`'s injected clock, `windowsRecording.test.ts`'s
  injected removal and `resourceHandoffDeadline.test.ts` were on int already
  in that style and survived its test overhaul; the lane's edits to them
  follow int's. Whether those older seams count as stand-ins is open (§8).
- **Drill scripts.** The lane's drills R2, R3, R5 and R7 ran from scripts in its
  ignored `temp/` and are not in the repository; R2 and R6 are Windows-only
  code paths, R5's `contended` is not deterministically forcible with real parts
  (the lane's reasoning), R3's and R7's suites pass here (§4). The CHANGELOG entry
  names only what a person sees; the record's drills are the lane's own.

### 2.2 `lanes/cc-winruns` (3 commits, built on `9b090e87c`)

`tabProvider.ts` now decides a secret under the cursor before it asks the
paid-use question (the lane found it by running `test/integration/tab.test.ts`
for the first time in a real VS Code on Windows 11: 18 of 18 on stable and on the
minimum after the fix). `test/unit/actuatorsWindowsNative.test.ts` is the
Windows job CPU-rate suite (two cases on a real job and child). Only
`CHANGELOG.md` conflicted. The auto-merge of `tabProvider.ts` was read in place:
the line, mode and redacted halves are read from the same synchronous snapshot
before `consent.requestUse`, and every later check (cancel, policy, grant)
stays in its order. The rlf-safelimits backstop touches the engine, not the
provider; the two lanes do not meet.

- **The Windows-only suite skips here:** `actuatorsWindowsNative` is
  `describe.runIf(IS_WINDOWS)`; on this MacBook it reports **2 skipped**
  (§4). The lane measured it 2 of 2 on Windows 11 with three red drills (its
  record).
- **Not re-run here:** `test/integration/tab.test.ts` (18) and
  `editorChat.test.ts` (10) need a VS Code instance; Electron cannot start on a
  macOS lane. Their compile is covered by the integration typecheck project (§3).
- **A sibling defect, left as the lane left it.** `src/runtime/lsp/lspTab.ts`
  (Tab over LSP for other editors) asks the paid-use question at line 224 and
  decides `secret-at-cursor` at line 240, the order the lane fixed in the
  VS Code provider. It has no suite. Open decision (§8).

## 3. Proof on the final tree

Every exit code is the command's own. The tree is `d9df856ab` plus the record
commits.

| Command                                                                                              | Exit | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                             | 0    | 42 s; `package.json` and the lockfile unchanged by both merges; npm 11 withholds four install scripts (`@vscode/vsce-sign`, `esbuild`, `fsevents`, `keytar`), as on the Windows lane; `.husky/_/pre-commit` present afterwards                                                                                                                                                                                                                                                                                                |
| `prettier --check --ignore-unknown` on the 54 non-image files changed since `b781451b9`              | 0    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `eslint --max-warnings 0` on the 30 changed JS/TS files                                              | 0    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)                                  | 0    | all six projects; first run on the merged tree 9 min 53 s, final tree after the two test commits, 0                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `node scripts/check-l10n.mjs`                                                                        | 0    | 14 UI tables, 14 usage tables, 283 manifest strings, 2457 source files; 0 problems (the lane's `contended` key is in English and all 14 tables)                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run check:reference`                                                                            | 0    | 92 features, 68 commands, 110 settings, 33 slash, 359 CLI; current                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:host-api`                                                                             | 0    | 392 VS Code APIs, 57 files importing vscode, 30 Node built-ins; 0 problems (no record change)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run check:plan`                                                                                 | 0    | 242 milestones; 0 drift (no archive needed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check:roadmap`                                                                              | 0    | 242 entries; `ROADMAP.md` current (regenerated for the safe-limits entry)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:catches`                                                                              | 0    | all catch sites and counts match the baseline; nothing rose, nothing fell, no regeneration                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run cycles`                                                                                     | 0    | no circular dependency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run deadcode`                                                                                   | 0    | knip clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run duplication`                                                                                | 0    | 0 clones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run build`                                                                                      | 0    | every one of the 257 size rows holds; tightest `dist/uiText.js` 124.9 of 125 KiB, `dist/wire.js` 74.8 of 75, `dist/validation.js` 49.8 of 50, `dist/modelApi.js` 522.4 of 525; `dist/extension.js` 517.3 of 600; `dist/acp.js` 406.1 of 850; no budget raised; 162 legal bundles, 0 problems                                                                                                                                                                                                                                  |
| `node scripts/package-vsix.mjs --target win32-x64` (zopfli 0.4.3 in a venv under `temp/`)            | 0    | **`VSIX: 4322472 bytes (budget 4915200)`**: 592,728 bytes under the budget                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run package:acp -- --target win32-x64`                                                          | 0    | **125 of 125** packaged-bundle checks (CC-INT2: 125)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run security:audit`                                                                             | 0    | **7** advisories, 0 exceptions needed (CC-INT2: 6). `package.json` and the lockfile are byte-identical to the base, so the extra advisory is the live feed, not a merge                                                                                                                                                                                                                                                                                                                                                       |
| `npm run security:sast` (semgrep 1.180.0 in a venv under `temp/`; `SSL_CERT_FILE=/etc/ssl/cert.pem`) | 1    | 688 rules, 5210 files: the **same 6 blocking findings as CC-INT1 and CC-INT2**, in `os/build.py`, `os/pi/compose.py` (2), `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`; none of those five files changed in this round (`git diff --name-only b781451b9 HEAD` is empty for each). Semgrep also stopped rules on `ModelApiHost.ts` (3 timeouts) and warned on `src/extension.ts`, `conversationController.ts` and `webview/App.tsx` (1 each): timeouts, not findings |

No gate was red on the merged tree; no regeneration (`--write`, `plan:archive`,
`--write-baseline`) was needed beyond the roadmap.

## 4. Each merged lane's own suites, final tree, repository timeouts

`TMPDIR` at its real path (`/private/var/folders/…/T`: macOS's `/var/folders` is
a link, which the product refuses for its private roots), `--maxWorkers=3`,
three files at a time, no raised timeout. The macOS helper app was built
first with `bash native/darwin/build.sh` (exit 0; git-ignored output; the race
suite and the governed-start suites need it, as CI does).

| Suites                                                                            | Exit | Result                                                                                                   |
| --------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `scheduleFsRetryStop`, `tabEngine`, `startText`                                   | 0    | 15 passed                                                                                                |
| `createdRegistrySaveErrors`, `windowsRecording`, `resourceHandoffDeadline`        | 0    | 17 passed                                                                                                |
| `nativeCheckout`, `governedCheckoutGit`, `sessionBoard`                           | 0    | 25 passed                                                                                                |
| `worktreeCommands`, `heldCheckoutCore`, `processTreeSweep`                        | 0    | 20 passed                                                                                                |
| `publishRegistry`, `releaseReuseTimeout`, `releaseReusePaging`                    | 0    | 9 passed                                                                                                 |
| `createdRegistryRace` (two real processes), `gitNoKill`, `actuatorsWindowsNative` | 0    | 4 passed, **2 skipped**: `actuatorsWindowsNative` is Windows-only                                        |
| `playbookSchedulesInputs`, `scheduleLeaseLifecycle`                               | 1    | 45 passed, 1 failed: the churn case times out at 5 s; fails identically on the untouched base (§5 row 4) |

## 5. `npx vitest related` over the merges' changed sources

The 18 `src/` and `scripts/` files the two merges changed
(`scripts/{publish-registry,release-reuse}.mjs`, `src/acp/startText.ts`,
`src/core/media/record/windows.ts`, `src/core/resources/{commands,createdRegistry,launch,process}.ts`,
`src/core/tab/tabEngine.ts`, `src/host/{commands/worktreeCommands,git/heldCheckout,processTree,sessionBoard}.ts`,
`src/host/vscode/tab/tabProvider.ts`, `src/runtime/panel/pullRequests/checkout.ts`,
`src/runtime/reporting/playbookSchedulesInputs.ts`, `src/runtime/schedules/nodeScheduleFs.ts`,
`src/shared/createdRegistrySaveError.ts`), without `src/shared/constants.ts` and
`src/shared/l10n/en.ts` (their `related` closure is the whole battery; the l10n,
reference, catch and build gates stand for them, as CC-INT2 did). Excluded by
the MacBook rule: `keyringParts`, `keystoreOwner`, `credentialLease`,
`providerHeadersStore`, `test/unit/vault/**`, `deviceOwnerVaultUses`,
`deviceOwnerBind*`, `devicePairKeyDpapi`, and the browser suite
`devicesPhase2Harness`; also `runtimeLsp` (CC-INT1 §5 row 11: three cases that
cannot pass under any macOS temp folder, 240 s each).

`npx vitest related … --run --maxWorkers=3`, the repository's own timeouts:
exit **1**, 407 files (13 failed, 377 passed, 17 skipped), 4598 tests (**21
failed**, 4399 passed, 178 skipped), 774.6 s. Each failing file was then run
alone here, and the same file on an extracted copy of the untouched base
(`git archive b781451b9` under `temp/base`, `node_modules` linked), same
`TMPDIR`, same timeouts:

| #   | Files (tests in the related run)                                                            | Merged tree alone                                           | Untouched base alone                                          | Class                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `browserEnglish` (2), `browserUiText` (1)                                                   | the same 3                                                  | the same 3                                                    | Base (CC-INT1 §5 rows 6, 7): the probe has no history-English loader                                                                                                                                                                                         |
| 2   | `connectorStorageGuard` (3)                                                                 | the same 3                                                  | the same 3                                                    | Base (CC-INT1 §5 row 9): the "legacy" storage is already private on POSIX                                                                                                                                                                                    |
| 3   | `acpServeHandshake` (1), `playbookGovernor` (1), `resourceStatusCpu` (1)                    | the same 3                                                  | the same 3                                                    | Base (CC-INT1 §6, CC-INT2 §5): Muse Code on this rig's `PATH`, APFS case-insensitivity, a 5 s reading                                                                                                                                                        |
| 4   | `playbookSchedulesInputs` (1: the churn case; once also `scheduleFireIdentityMismatch`)     | 1 to 2 fail, 5 s                                            | the same 2 fail (first run); churn fails again in a later run | Base (CC-INT1 §5 row 10): 21 durable updates, ~21 ms per `fsync` here. With `--testTimeout=120000` (exploratory, the only raised timeout in this lane) all 22 pass on the merged tree, so the restored snapshot bound answers an agreed snapshot, not `busy` |
| 5   | `scheduleFireFailures` (5), `schedulePauseAfterFailures` (1), `teamPlaybookIntegration` (1) | 7 to 8 fail, 5 s each (which ones changes from run to run)  | 7 fail, 5 s each (`teamPlaybookIntegration` 8.7 s)            | Base (CC-INT1 §6 "5 s default"): real durable writes. With `--testTimeout=120000` (exploratory) the three files pass on the merged tree: 17 of 17                                                                                                            |
| 6   | `teamCrossBranchAdvisories` (1), `scheduleFileWatcher` (1)                                  | **pass**, twice in a row (10 of 10)                         | not needed                                                    | Load only: a 5 s timeout and a watcher event that missed its window in the loaded 3-worker run; neither suite nor its source changed (`git diff --stat b781451b9 HEAD` is empty for `fileWatcher.ts` and `scheduleFileWatcher.test.ts`)                      |
| 7   | `connectorStdio` e2e (2)                                                                    | the same 2 (`refused` for the milestone and playbook kinds) | not re-run (the base copy has no `dist/`)                     | Base (CC-INT1 §5 row 8)                                                                                                                                                                                                                                      |

Nothing in the table comes from a merge. The earlier classes (the macOS helper
app not built; macOS temp alias) did not occur: the helper was built and
`TMPDIR` was the real path before the run. The files CC-INT2 listed as base
failures that the changed sources do not select (`estimatorPlanSnapshotRealPlan`,
`cx1r2Truth`, `commandHelp`) were not in this run and are unchanged. Owners are
named in CC-INT1 §5.

## 6. Real use through the built product

`dist/acp.js` from this tree's `npm run build`, a scratch `HOME` under `temp/`,
an empty workspace folder, no network call and no Muse request:

```
report --help                          → usage plus the kinds, schedules and issues named           exit 0
report schedules / playbook / issues   → the three reports, empty store, no source failure           exit 0
report schedules --format json         → report-v1 JSON                                             exit 0
chmod 0 on the schedules store; report schedules --format text
                                       → ended in 1 s; Cost, Fires, Refusals and Schedules each say
                                         "Status: Unavailable. Reason: The source could not be read
                                         completely. Sources: schedules"                            exit 0
chmod 755 restored
```

The last step is the kernel's own denial, through the report reader the lane
bounded (R1): the read retried through its five attempts and then said so,
instead of waiting for a cancel. The same command on the untouched base was not
run through its product (the base copy has no build).

Not run through the product, and why: Tab in an editor (VS Code, Electron cannot
start here; and a hung or secret-bearing Tab request needs a Muse request or a
live provider), the OS hand-off adapters (they open the person's browser or
clipboard), a created-registry race through two editor windows (R5), the git
worktree and checkout deadlines against a repository in an editor, the release
workflow's CI lookup (hosted CI), the Windows sweep and recording-cleanup paths
(R2, R6: Windows-only), and the Windows job suite (skips here).

## 7. Red/green drills

Each: one edit, the owning suite, the non-zero exit, restored (`cmp` against a
copy), the same suite green.

| Break                                                                     | Caught by                                                                                   | red | green |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --- | ----- |
| `tabEngine.ts`: the backstop timer no longer aborts the signal            | `tabEngine` "ends a hung request at the backstop with words" (5006 ms into the 5 s timeout) | 1   | 0     |
| `release-reuse.mjs`: the bound's `signal` removed from the lookup request | `releaseReuseTimeout` "ends a hung lookup at the bound" (5008 ms into the 5 s timeout)      | 1   | 0     |

The lane's own drills (R1 to R9, cc-winruns D1 to D3) are in their records;
they ran on those lanes' bases and their suites pass on the merged tree (§4).
No gate fired red on the merged tree (§3).

## 8. Not run, and open decisions

Not run, with the reason:

- `test/integration/tab.test.ts` and `editorChat.test.ts` in VS Code (stable and
  minimum): Electron cannot start on a macOS lane. cc-winruns measured 18 of 18
  and 10 of 10 on Windows 11 on its own base; the merged tree (which adds the
  backstop to the engine) has not had them re-run. Linux or Windows must.
- `actuatorsWindowsNative` (2 cases): Windows-only, **2 skipped** here.
- `npm run test:a11y`, `test:legal-a11y`, `ui:look` (browser suites: "NOT RUN:
  browser suite on the MacBook"), including the models and usage looks
  cc-winruns recorded.
- The vault and OS credential-store suites (rule), `devicesPhase2Harness`
  (browser), `runtimeLsp` (cannot pass under a macOS temp folder).
- Any Muse request, real conversation or paid provider call; the Tab backstop
  against a real hung provider; hosted CI's Windows legs for R2 and R6.

Open decisions for the lead (none blocks the merge):

1. **`lspTab.ts` has the order cc-winruns fixed in the VS Code provider** (the
   paid-use question at line 224, the `secret-at-cursor` decision at line
   240). Options: (a) the same reorder plus a real LSP stdio test; (b) leave
   until the lane's follow-up. Recommendation: (a): a person using Tab over LSP
   is asked to approve a spend for a request that is then never sent.
2. **Older injection seams in suites int already carried** (`tabEngine.test.ts`'s
   `throwingStream`/`silentStream`/admit-gate streams, `publishRegistry`'s
   injected clock, `windowsRecording`'s injected removal). Options: (a) accept
   them as int did; (b) rewrite each over real parts as `9d45f12bd` and
   `d9df856ab` did for the lane's two. Recommendation: (b) as a separate lane;
   this round only replaced what the merged lanes added.
3. **The safety limits are not person-settable** (the lane's reasoning: internal
   resilience defaults; only the hand-off deadline takes a caller's value).
   D121's clarification says "person-settable where that makes sense".
   Recommendation: keep as built; revisit only if the owner asks for a setting.
4. **R5's `contended` and R2/R3/R7's drills live in the lane's ignored `temp/`**,
   not in the repository. Recommendation: accept; their code paths are covered
   as far as real parts allow (§2.1).

## 9. Commits

`b781451b9` → `d9df856ab`: the two merges (`43f3f805d`, `ede593df7`) and the two
`fix(int)` commits (`9d45f12bd`, `d9df856ab`), with the lanes' own 16 commits
beneath them (20 commits, 58 files, +1,480 / −213 against the base), then the
commits that carry the PLAN status, the rlf-safelimits record note and this
record.
