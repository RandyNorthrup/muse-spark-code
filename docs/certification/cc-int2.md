# CC-INT2 — merge round 2 on int/recovery (2026-10-24, finished 2026-10-30)

Claude Code lane `CC-INT2`, worktree `/Users/user/lanes/CC-INT2`, branch
`cc/int2`, on the test rig `MacBookPro.ivettnet` (macOS, Darwin 24.6.0, Intel
x86_64, Node 24.21.0, npm 11.19.0). Base: int/recovery `9b090e87c7`
(CC-INT1's round, `docs/certification/cc-int1.md`, whose known failures are
not counted against a merge here). Model attempts: **0**. Provider calls:
**0**. Muse requests: **0**. Nothing was pushed, rebased, stashed or tagged.
The vault and real credential-store suites (`keyringParts`, `keystoreOwner`,
`credentialLease`, `providerHeadersStore`, `test/unit/vault/**`, the device
owner vault suites) were never run on this MacBook, and no browser or GUI
app was started. Scratch files lived in the worktree's ignored `temp/` (two
Python venvs, a scratch `HOME`, an extracted copy of the base, build logs).
The lane was interrupted once by the session limit while the SAST scan ran;
nothing in the tree was lost, and the proof below was run on the final tree.

## 1. The merges

Fetched with `git fetch ~/gates/muse.git "refs/heads/lanes/<name>:refs/remotes/<name>"`
and merged with `git merge --no-ff`, in the brief's order.

| #   | Branch (tip)                        | Merge commit | Conflicts                                                                                                                         |
| --- | ----------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lanes/rlf-a11y` (`f3ea14802`)      | `a639a69ae`  | `CHANGELOG.md`, `PLAN.md`, `docs/roadmap/entries.json`, `ROADMAP.md`: adjacent additions, both kept, `ROADMAP.md` regenerated     |
| 2   | `lanes/rlf-m120ui` (`5f7fcb1bc`)    | `610dbc3f6`  | `ROADMAP.md` (regenerated); modify/delete on `test/unit/teamHostService.test.ts` (§2.2)                                           |
| 3   | `lanes/rlusage` (`f5a07800f`)       | `d77fd6143`  | 22 files: the usage journal and recording, resources, reports, catch inventory, generated records (§2.3)                          |
| 4   | `lanes/rlusage-src05` (`7ea2fcac8`) | `be8a0a4c5`  | `PLAN.md`, one certification record, three source files, four modify/delete tests: int already carries every source change (§2.4) |
| 5   | `lanes/rlsched` (`bc59ebdc7`)       | `cedb0bd20`  | 37 files: schedules binding/engine/entry, the watchdog's CLI/ACP/main wiring, English tables, generated reference, records (§2.5) |

Each merge interaction has its own commit:

| Commit      | What                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `16caf9957` | `fix(int)`: Move to… proven on the real host service (rlf-m120ui)                                                                                 |
| `e65595573` | `fix(int)`: int's clocks take the `EpochMs` brand; `team.js` exports `teamPoolEntrySchema` for the runners (rlusage, rlf-m120ui)                  |
| `301c466bc` | `fix(int)`: the schedules bridge passes the caller's stop before the trust check; the watchdog's prose stays out of the browser closure (rlsched) |
| `a9c45d558` | `fix(int)`: dead code the removed stand-in suites kept alive: `compareVersions`, the watchdog bundle entry in knip (rlsched)                      |
| `c0e5e3f10` | `refactor(int)`: one error block in `usageFailureForLog` (rlusage)                                                                                |

## 2. What each merge needed

### 2.1 `lanes/rlf-a11y`

Four commits (names on the controls, contrast on the selected row, the Tab
badge's deferred English, scenes). The conflicts were adjacent additions in
`CHANGELOG.md`, `PLAN.md`, `docs/roadmap/entries.json` and `ROADMAP.md`; both
sides kept, the roadmap regenerated. One sentence in the lane's PLAN status
("`npm run build`, `check:plan` and `security:audit` stay red on the untouched
base") was true of its own base (`397aca3ddb`) and not of int; it now says so
and points here. The three bundle overruns and the PLAN size the lane reported
do not exist on int (the build below holds every budget; `check:plan` passes).
The a11y gates themselves (`npm run test:a11y`, `test:legal-a11y`) need a
browser and are **NOT RUN** here (MacBook rule); the lane measured both green
on Linux (1124 pages, 96 checks) on its own base.

### 2.2 `lanes/rlf-m120ui`

Seven commits (the preference editor, Move to…, scenes). Conflicts: `ROADMAP.md`
(regenerated) and a modify/delete on `test/unit/teamHostService.test.ts`: int
deleted that suite (RLINTFIX item 5: every port hand-written), and the lane
had added two Move to… cases to it. **Reworked, not dropped:** the deletion
stands, and `test/unit/teamMoveTask.test.ts` (2 tests) proves the same
behaviour on the real `createTeamHostService` over the real
`createEngineTeamPorts`: a task waits because its entry holds a lifetime task
cap of zero under the role's `queue` policy; the move re-homes it, the
persisted record (read back through the real `storedTasksSchema`) carries the
role and the `user`-trigger handoff chain, a later pass launches it on the new
role's entry (the real worker port refuses the missing repository before any
copy or model call; `listModels`, `startWorker`, the paid port and the cards
are tripwires that fail if called), and each refusal says its sentence
(running, finished, unknown task, unknown role, same role, unstaffed role).
Drills (each one edit in `teamHost.ts` `moveTask`, run through that suite,
then restored byte-exact with `cmp`): the running-task refusal removed → exit
1, restored → 0; `await persist()` removed → exit 1, restored → 0; the chain's
`user` trigger changed → exit 1, restored → 0.

Interaction (`e65595573`): the lane's panel definition imports
`teamPreference`, which reads `teamPoolEntrySchema`; the runners bundle takes
`shared/team` from `team.js`, so `npm run build` stopped at the bundle split
gate (`teamRunners.js reads teamPoolEntrySchema from team.js, which does not
export it`, exit 1). `teamEntry.ts` now exports it with the other schemas the
runners read; the build is green again.

### 2.3 `lanes/rlusage` (sources 01 to 04)

39 commits, 22 conflicted files. int's decisions that won, and how the lane's
purpose was kept:

- **Usage write failures name their cause (int: RLWINFIX item 3).** int's
  `onWriteError(code, error)` and `usageFailureForLog` stay; the lane's
  "which field failed" reason moved into `usageFailureForLog`
  (`src/core/usage/failures.ts`), so a rejected record is logged as
  `record rejected: id (too_small)` with field names and expected shapes only,
  never values, and `invalidUsage` is a known word. The lane's lifted
  validation (`tryCreateUsageRecord`, `safeParse` in `append`) replaces the
  `try/catch` in the store's `noteUsage`/`append`.
- **A failed read is not "not recorded" (lane) and still names its cause
  (int).** int's `today()` warned through the write sentence and spent the
  once-per-run write warning; the lane stopped warning at all. Merged: the
  write failure uses the lane's sentence (`Usage for this run was not recorded
({reason}).`), the read failure has its own sentence and its own
  once-per-run flag (`Usage history could not be read ({reason}).`, new
  key `usageNotRead` in English and all 14 tables), so neither spends the
  other's warning. int's `usageWarningCause` expectation changed from the old
  write sentence to the read sentence for the lock-held read it covers. New
  real-code suite `usageReadWarning.test.ts` (own file: the store's write
  diagnostic gate is once per process) proves both halves; `execUsageClock`'s
  read case moved there.
- **`EpochMs`** (the lane's brand for stored times) reaches int's newer
  limit-observation code (`OwnedLimitInput.observedAt`), the Muse Code,
  OpenRouter and editor-chat call sites and ten int tests: `toEpochMs`/`epochNow`
  at the boundary (`e65595573`). The lane's §8 row for the one cast is in
  `PLAN.md` (as its own small table).
- **Resource failures (REPORTTRUE) vs int's fixed reading identities.** int's
  runtime logs `ResourceReadingError` identities (`resources.admission: …`),
  deliberately never the failure's text; the lane's `warnResourceUnavailable`
  (the failure's redacted message) would have undone that in the runtime. int
  wins in `runtime/main.ts`, `runtime/resources/load.ts` and `entry.ts`; the
  lane's helper stays where int had no rule, the extension host's output
  channel (`extension.ts`), with its suite.
- **The catch inventory:** int's `onError` sink entry (same bar as the lane's)
  kept; the baseline regenerated, falls only.
- **Moved files:** `reportEditorIo.ts` lives under `src/host/vscode/support/`
  on int, so the lane's fallback window type import follows it.
- **Both sides' lists:** `REPORT_EVENT_KINDS` (int's `judgeFastSkip` plus the
  lane's five sign-in kinds), the deferred-entry regex (`reportFallbackEntry`,
  `usageExportEntry` added), `scripts/cycles.json`, the CHANGELOG (the lane's
  `Fixed` entries joined int's first `Fixed` list).

The lane's own 31 test suites pass on the merged tree (§4).

### 2.4 `lanes/rlusage-src05` (the lane's source 05, two commits)

`20854be36` and `7ea2fcac8` were already ported to int by C-M113-1 (its record
says so), as int's own code: task globs through int's `matchTaskNames` (Node's
glob matcher with npm-run-all2's separator roles, not the runner's internal
module the lane imported), the subagents folder test and the tie-break sorts.
**Nothing in `src/` differs** after the merge; int lacked no source change. The
merge keeps int's deletion of the four test files the lane edited
(`gitSource`, `sessionReportSource`, `changelogSource`, `agentUsageSource`:
`vi.mock`/`vi.fn`), brings the lane's PLAN scope paragraph and its
certification section (before the C-M113-1 port, with a note saying all this),
and corrects the lane's sentence about the matcher to int's. The tie-break and
discovery behaviours have no unit suite on int (the stand-in suites were
deleted by the test overhaul); their proof is the report engine's real-code
suites and the packed product's real-life run.

### 2.5 `lanes/rlsched`

26 commits, 37 conflicted files (English and 14 tables, the generated reference,
build lists, the schedules binding/engine/entry, the CLI tables). Mechanical:
union of keys in `en.ts`, the 14 tables and `l10n/untranslated.json`; the
generated reference, `host-api.md` and the catch baseline regenerated; the
CLI/ACP/main/build/bundle-size lists keep both sides' entries.

- **The schedules binding's tail** gained `signal` (int, the caller's stop) and
  `isWorkspaceTrusted` (lane): `... pauseAfterFailures, signal,
isWorkspaceTrusted`. The VS Code bridge passes an explicit `undefined` for the
  signal (`301c466bc`); the engine keeps int's combined stop and its
  `{ signal }` on the deferred-events write.
- **Stand-in suites not carried (reworked as a claim, not a test).** Six lane
  suites drive the watchdog's GitHub steps through an in-process `fetch` that
  answers as GitHub (`watchdogAck`, `watchdogCommand`, `watchdogDecide`,
  `watchdogGithubClient`, `watchdogPoll`, `watchdogTriage`, with their
  `servedGithub` helper); the lane itself called the rig a stand-in "in the
  strict sense". They are not on int. What they proved has **no unit proof on
  int**: the poll, the acknowledgement under the repository's lock, the
  needs-info wait, the decision and resolution replies, the triage evidence
  reads, the client's request formation. int keeps the lane's code for them
  and its real-code suites: contracts, surface, the issues report, event
  intake, file watcher, git refs, report binding and secrecy, delivery
  withdrawal, background reconcile and lazy owners. Because nothing real has
  exercised those steps (the lane's own record lists the live poll as NOT RUN),
  **the CHANGELOG no longer describes them**: it says `watchdog list|status|pause|resume|policy` and
  `/report issues` (both run for real below) and that reading and posting on
  GitHub is built but not yet used against a live repository. The lane's PLAN
  status lost "with tests over recorded GitHub exchanges" and gained an
  integration paragraph; its certification record gained a note that drills
  D1 to D15 are history. `docs/acp.md`, `SECURITY.md` and `docs/PRIVACY.md`
  still describe the watchdog's behaviour as built (privacy and security text
  must describe the code); trimming `docs/acp.md` until a real run exists is an
  open decision (§8).
- **The 14 recorded exchanges** (`test/fixtures/m115w/`) and
  `watchdogCaptures.test.ts` (byte hashes against receipts, like int's
  `storeCaptures`) stay as the recorded wire evidence; nothing else reads
  them now (§8).
- **Dead code the removed suites kept alive:** `compareVersions` in
  `core/watchdog/triage.ts` (removed) and the watchdog bundle entry, an
  esbuild entry like every other lazy bundle (added to `knip.jsonc`)
  (`a9c45d558`).
- **A budget interaction, no budget moved (`301c466bc`).** The first build
  after the merge stopped: `dist/webview surface English: 25.2 KiB (budget 25
KiB)`, **0.2 KiB over**. Measured cause: the generated reference names the
  new `watchdog` command, and `browserTextKeys` took that command word for a
  reader of the English group of the same name, so the group's ~5 KB of
  Node-only prose rode the browser's shared closure (23.4 KiB with the group
  removed, measured by taking it out and rebuilding). `scripts/lib/uiTextRegions.mjs`
  now names Node-only groups (`watchdog`) and a command word equal to one is
  not a reader. Rebuilt: 23.4 of 25 KiB.
- **The catch baseline:** `agent.ts`'s `prompt` try block gained the
  `/watchdog` dispatch, which changes that GENERIC site's identity; the count
  is unchanged (acp GENERIC 17), nothing rose, the baseline was regenerated.
- **Agent schedule caps.** `AGENT_SCHEDULES_MAX_ACTIVE = 10` and
  `AGENT_SCHEDULE_MAX_DEPTH = 1` exist on int and in the lane's base; the
  lane neither adds nor removes a cap or a retry (its record: the watchdog
  retries nothing, GitHub's refusal stops the poll and says so). Left alone.

## 3. Proof on the final tree

Every exit code is the command's own. The tree is `c0e5e3f10` plus this record.

| Command                                                                                              | Exit | Result                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                             | 0    | 29 s; `package.json` and the lockfile are unchanged by every merge                                                                                                                                                                                                                                                                                      |
| `prettier --check --ignore-unknown` on the 327 files changed since `9b090e87c`                       | 0    |                                                                                                                                                                                                                                                                                                                                                         |
| `eslint --max-warnings 0` on the 208 changed JS/TS files; `stylelint` on the changed CSS             | 0, 0 |                                                                                                                                                                                                                                                                                                                                                         |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)                                  | 0    | all six projects                                                                                                                                                                                                                                                                                                                                        |
| `node scripts/check-l10n.mjs`                                                                        | 0    | 14 UI tables, 14 usage tables, 283 manifest strings, 2457 source files; 0 problems                                                                                                                                                                                                                                                                      |
| `npm run check:reference`                                                                            | 0    | 92 features, 68 commands, 110 settings, 33 slash, 359 CLI (the `watchdog` row); current                                                                                                                                                                                                                                                                 |
| `npm run check:host-api`                                                                             | 0    | 392 VS Code APIs, 57 files importing vscode, 30 Node built-ins; 0 problems (record regenerated twice: after the rlusage merge, after the rlsched merge)                                                                                                                                                                                                 |
| `npm run check:plan`                                                                                 | 0    | 241 milestones; 0 drift. No archive was needed, so `npm run plan:archive` was not run and no section was archived                                                                                                                                                                                                                                       |
| `npm run check:roadmap`                                                                              | 0    | 241 entries; current (regenerated for the a11y entry)                                                                                                                                                                                                                                                                                                   |
| `npm run check:catches`                                                                              | 0    | baseline regenerated twice, falls only (§2.3, §2.5)                                                                                                                                                                                                                                                                                                     |
| `npm run cycles`                                                                                     | 0    | no circular dependency                                                                                                                                                                                                                                                                                                                                  |
| `npm run deadcode`                                                                                   | 0    | knip clean (first run after the rlsched merge exited 1: §2.5)                                                                                                                                                                                                                                                                                           |
| `npm run duplication`                                                                                | 0    | 0 clones                                                                                                                                                                                                                                                                                                                                                |
| `npm run build`                                                                                      | 0    | every one of the 257 size rows holds; tightest `dist/uiText.js` 124.9 of 125 KiB, `dist/wire.js` 74.8 of 75, `dist/validation.js` 49.8 of 50, `dist/modelApi.js` 522.4 of 525; `dist/extension.js` 517.3 of 600; `dist/acp.js` 406.0 of 850; `dist/acpWatchdog.js` 69.5 of 75; `dist/webview surface English` 23.4 of 25. No budget was raised          |
| `node scripts/package-vsix.mjs --target win32-x64` (zopfli 0.4.3 in a venv under `temp/`)            | 0    | **`VSIX: 4322176 bytes (budget 4915200)`**: 593,024 bytes under the budget CC-INT1 set                                                                                                                                                                                                                                                                  |
| `npm run package:acp -- --target win32-x64`                                                          | 0    | notices pass; **125 of 125** packaged-bundle checks (CC-INT1: 123; the two new bundles `acpWatchdog.js` and `usageExport.js`)                                                                                                                                                                                                                           |
| `npm run security:audit`                                                                             | 0    | 6 advisories, 0 exceptions needed (as CC-INT1)                                                                                                                                                                                                                                                                                                          |
| `npm run security:sast` (semgrep 1.180.0 in a venv under `temp/`; `SSL_CERT_FILE=/etc/ssl/cert.pem`) | 1    | 688 rules, 5207 files: the **same 6 blocking findings as CC-INT1**, in `os/build.py`, `os/pi/compose.py` (2), `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`; none of those files changed in this round; nothing in the lane's new code (the lane had already rewritten its own RegExp finding) |

Two gates were red once and fixed by a merge-interaction commit, then re-run
green: the bundle split gate and `check:catches` after the rlf-m120ui/rlsched
merges, and the size gate and `deadcode` after rlsched (all in §2).

## 4. Each merged lane's own suites, final tree, repository timeouts

59 files (every suite the four lanes added or changed that still exists, plus
the l10n, harness and edit-scene suites rlf-a11y named, plus the three new ones
written here), run three files at a time with `--maxWorkers=3`, `TMPDIR` at its
real path (`/private/var/folders/…`, §5): 17 of 20 batches exit **0**; the other
three fail only on the base items below (browserEnglish 2, browserUiText 1,
cx1r2Truth 1), measured identically on the untouched base (§5).

New or reworked real-code suites from this round: `teamMoveTask` (2),
`usageReadWarning` (1), `execUsageClock` (4), `usageWarningCause` (1, its
expectation moved to the read sentence), `watchdogSurface` (3) and the helper
`fixtures.ts` cut down to what remains. `reportIssues` (4), `scheduleEventIntake`,
`scheduleReportBinding` and the rest of the lane suites pass unchanged.

## 5. `npx vitest related` over the merge's changed sources

127 changed `src/` files (everything changed since `9b090e87c`, minus
`src/shared/constants.ts`, `src/shared/l10n/en.ts` and the generated files:
their `related` closure is the whole battery, and the l10n, reference and
catch gates stand for them, as the lane brief for rlsched did). Excluded by
the MacBook rule: `keyringParts`, `keystoreOwner`, `credentialLease`,
`providerHeadersStore`, `test/unit/vault/**`, `deviceOwnerVaultUses`,
`deviceOwnerBind`, `devicePairKeyDpapi`; also `runtimeLsp` (CC-INT1 §5 row 11:
its three cases cannot pass under any macOS temp folder, 240 s each) and the
browser suite `devicesPhase2Harness`. `--maxWorkers=3`, the repository's own
timeouts, no raised timeout anywhere in this lane.

First run: exit **1**, 575 files (22 failed, 537 passed, 16 skipped), 8290
tests (**45 failed**, 8054 passed, 191 skipped), 458 s. Each failing file,
classified as CC-INT1 did:

| Class                                                 | Files (tests)                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The macOS helper app was not built in this worktree   | `resourceHandoffDeadline` (2), `nodeWorkspaceDevcontainer` (2), `nodeToolHost` (1), `nodeCertificate` (file), `resourceCreatedSweep` (4), `createdRegistryRace` (1)                                                                                       | `spawn …/native/darwin/muse-dictate-screen-x64.app/Contents/MacOS/muse-dictate ENOENT`. After `bash native/darwin/build.sh` (exit 0; git-ignored output) and the next row's `TMPDIR`, all six files pass (5 + 50 + 4 tests)                     |
| macOS temp alias (`/var/folders` is a link)           | `nodeTerminalPage` (6), `teamEnginePorts` (5), `teamWorkerCreateBundle` (1), `execTeamSweep` (1)                                                                                                                                                          | re-run with `TMPDIR=/private/var/folders/…/T` (the real path): 22 passed, `execTeamSweep` passes                                                                                                                                                |
| Browser suite                                         | `teamModelsFirstPaint` (2 hook errors)                                                                                                                                                                                                                    | `CHROME_PATH` is `/usr/bin/false` on a MacBook by rule: **NOT RUN: browser suite on the MacBook**                                                                                                                                               |
| Fails identically on the untouched base (`9b090e87c`) | `estimatorPlanSnapshotRealPlan` (8), `cx1r2Truth` (1), `commandHelp` (1), `browserEnglish` (2), `browserUiText` (1), `connectorStorageGuard` (3), `playbookSchedulesInputs` (1), `acpServeHandshake` (1), `playbookGovernor` (1), `resourceStatusCpu` (1) | each file run on an extracted copy of the base here: the same failing tests (10, 6 and 3 tests in the three base batches, the same names; `resourceStatusCpu` times out at 5 s on both; `playbookGovernor`: the APFS case-insensitive spelling) |
| Fails as CC-INT1 recorded on its base                 | `connectorStdio` e2e (2)                                                                                                                                                                                                                                  | the same reply (`refused` for `milestone M1`, `playbook`, `playbook M1`); the base copy here has no `dist/`, so it was not re-run there                                                                                                         |

Nothing in the table is from a merge. CC-INT1's rows 2 to 11 (manifest notices,
estimator plan text, command help, browser English loaders, connector stdio,
connector storage guard, playbook schedules churn, runtime LSP) are unchanged
and unfixed here for the same reasons (their owners are named there).

## 6. Real use through the built product

`dist/acp.js` from this tree's `npm run build`, a scratch `HOME` under `temp/`,
an empty workspace folder, no network call and no Muse request:

```
watchdog list                          → "The watchdog is not watching any repository yet."      exit 0
watchdog policy O/R posts never        → "Set posts for O/R."                                    exit 0
watchdog policy O/R close onReply      → "Set close for O/R."                                    exit 0
watchdog policy O/R posts sometimes    → "That value is not allowed for posts. Use ask, always, never."   exit 1
watchdog policy O/R                    → the settings, posts: never, close: onReply              exit 0
watchdog list / pause / status / resume→ "O/R · 0 issues" / paused / "No issues recorded." / resumed   exit 0
report issues --repo O/R --format text → Issues, Needs You, Limits sections                      exit 0
watchdog bogus                         → the usage sentence                                      exit 2
usage / usage --json                   → read-only text / the v3 journal read, 0 requests        exit 0
report --help                          → usage plus the available kinds, issues named            exit 0
report release                         → "A release report needs a version." then usage          exit 2
```

`report --description probe` (the problem report) also ran once: it printed
the scrubbed draft and exited 0, with `[warn] the key store could not be read
for a report (StoreUnavailableError)` and the line `cli: found (version
1.4.10-R6427.1); signed in: no`. The report read the installed Muse Code
binary's version and the credential file's structure locally (no session, no
request, no credential value); it was not repeated.

Not run through the product: `watchdog poll`, `evidence`, `apply`, `decide`
and `resolve` (they need the person's GitHub sign-in and a repository, §8);
`/watchdog` and `/report problem` through an ACP editor (a nested ACP session;
and no editor starts here); the editor's Move to…, report dialog and usage page.

## 7. Red/green drills

Each: one edit, the owning suite, the non-zero exit, restored (`cmp` against a
copy), the same suite green.

| Break                                                                          | Caught by                                                  | red | green |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- | --- | ----- |
| `moveTask`'s running-task refusal removed (`teamHost.ts`)                      | `teamMoveTask` "says each refusal…"                        | 1   | 0     |
| `await persist()` removed from `moveTask`                                      | `teamMoveTask` "moves a waiting task, chains the move…"    | 1   | 0     |
| the handoff chain's `user` trigger changed                                     | the same test                                              | 1   | 0     |
| the read warning shares the write warning's once-per-run flag (`recording.ts`) | `usageReadWarning`                                         | 1   | 0     |
| `rejectedFields` not consulted in `usageFailureForLog` (`failures.ts`)         | `execUsageClock` and `usageJournalAppendInvalid` (2 tests) | 1   | 0     |

Gates that fired for real on this tree (red, then the fix named, then green):
`check:host-api` (record stale after rlusage and rlsched: `--write`, exit 0);
`check:catches` (rlusage: falls only, `--write-baseline`; rlsched: the `prompt`
try block's identity changed, `--write-baseline`, exit 0); the bundle split
gate in `npm run build` (`teamRunners.js reads teamPoolEntrySchema from
team.js…`, exit 1; the export, exit 0); the size gate in `npm run build`
(`OVER dist/webview surface English: 25.2 KiB`, exit 1; the Node-only group
list, 23.4 KiB, exit 0); `npm run deadcode` (exit 1 on `compareVersions` and
three watchdog entry exports; the removal and the knip entry, exit 0).

## 8. Not run, and open decisions

Not run, with the reason:

- `npm run test:a11y`, `npm run test:legal-a11y`, `npm run ui:look` (the models-roles,
  models-agents, usage and questions scenes): they start a browser, which the
  MacBook rule forbids ("NOT RUN: browser suite on the MacBook"). rlf-a11y and
  rlf-m120ui measured them on Linux on their own bases; the merged tree's three
  harness-touching lanes (a11y, m120ui, rlusage's report dialog) have not had the
  gate run together. Linux or hosted CI must.
- The VS Code integration suites and the editor's real use of Move to…, the report
  dialog, the usage page and the schedules panel (Electron cannot start on macOS lanes).
- The vault and OS credential-store suites (rule), `devicesPhase2Harness` (browser),
  `deviceWorkerHostNative` and the PowerShell 7 trailer cases (Windows-only skips).
- Any Muse request or real conversation (allowance used up until 2026-10-25 17:00
  Pacific), any paid provider call, and a live `watchdog poll` against GitHub (needs the
  person's sign-in and a repository to post to).

Open decisions for the lead (none blocks the merge):

1. **The watchdog's GitHub steps have no unit proof on int.** Options: (a) a real run
   with a GitHub sign-in against a repository the owner chooses, as part of the
   release's real-life run (state the requests first); (b) restore the six stand-in
   suites (breaks "no stand-in for GitHub"). Recommendation: (a). Until then
   `docs/acp.md`'s Issue-watchdog section describes behaviour no real run has used;
   trim it to the proven commands if the release ships before (a).
2. **`test/fixtures/m115w/` and `watchdogCaptures.test.ts`** now guard recorded
   exchanges nothing else reads. Options: keep them as wire evidence for the real run in
   (a), or delete the fixtures with the suites. Recommendation: keep until (a), then
   decide.
3. **The three base items CC-INT1 named for other owners** are unchanged (§5).

## 9. Commits

`9b090e87c` → `c0e5e3f10`, then this record: the five merges and five commits
named in §1, with the lanes' own commits beneath them (88 commits, 328 files,
+20,710 / −1,566 against the base).
