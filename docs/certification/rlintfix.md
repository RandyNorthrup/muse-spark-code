# RLINTFIX — int/recovery green: PLAN size, bundle budgets and the unit suite

Windows PC rig, worktree `C:\Users\Randy\Coding\mx-app-rlintfix`, branch
`rec/rlintfix`, base `397aca3ddb` (int/recovery: main `f3941b8548` plus
the 15 merged lanes). No paid or live model calls. No push, merge of
other lanes, rebase or history rewrite. The vault and credential-store
suites were never run on this PC.

## Why

The 14-lane merge left int/recovery red in nine places: PLAN.md over
its bound, three bundles over their budgets, and seven unit-suite
failures (a runner EBUSY regression, a machine-dependent handshake, a
fake-driven team suite, ten symlink-privilege failures, a TMP-in-repo
copy fault, TEMP-guard failures, and README claims for dormant
features). This lane makes every gate, the build and the unit suite
pass without weakening anything: no bound or budget raised, no gate
weakened, no fake-driven test kept.

## What changed

- Item 1: 43 closed record blocks (49,200 bytes) moved from PLAN.md to
  `docs/plan-archive/gates.md` with `node scripts/plan-archive.mjs`;
  PLAN.md 3,668,951 → 3,564,482 bytes, under its unchanged bound.
- Item 2: `src/core/toolEdit.ts` shared through
  `dist/modelApiBoundaries.js` (its two model-text reads became
  caller-passed words); `DeveloperOptionsError` moved to its own leaf
  module. `dist/modelApi.js` 540,355 → 536,777 bytes (budget 537,600),
  `dist/resourceAdmission.js` 25,639 → 21,771 bytes,
  `dist/vaultActions.js` 25,606 → 21,335 bytes (budgets 25 KiB).
- Item 3: the runner's output file opens delete-shared
  (`native/runner/runner-helper.ps1`), so readers unlinking right
  after `ended` no longer hit EBUSY while the native supervisor
  lingers; the release-before-record stays.
- Item 4: `test/unit/acpServeHandshake.test.ts` isolates the served
  agent's credential lookup with an empty `XDG_CONFIG_HOME` and adds a
  scrubbed-PATH no-CLI case.
- Item 5: `test/unit/teamHostService.test.ts` (73 fake-driven cases)
  deleted; `test/unit/teamEnginePorts.test.ts` (15 cases, the real
  `createEngineTeamPorts` against real git repositories) and
  `test/unit/teamPaid.test.ts` (6 cases, the real tariff tables) added,
  sharing `test/unit/helpers/realTeamGit.ts`.
- Item 6: the ten symlink-EPERM tests plant the link kind Windows
  allows without the privilege (directory junctions, one dangling
  junction, hard links) while the product takes the same branch; the
  product audit found only the skills installer creating junctions and
  the judge self-test (non-Windows) creating links.
- Item 7: `evalFreezeLayout` stages its tree per tracked file instead
  of one recursive copy, so any TMP (inside the repo or not) works.
- Item 8: `test/unit/helpers/temporaryFolders.ts` gains
  `usingPrivateDir` (the established locked-folder pattern); the
  connector suites use it, and `connectorStdio.e2e` locks its stage
  down. The packed product was probed on this PC (below): it keeps
  working because it homes its data outside `%TEMP%`.
- Item 9: README marks headless teams (`exec --team`) and Team
  configuration as not yet available, consistently with the
  dormant-feature truth tests.

## Behaviour → test map

- `test/unit/runnerHelperNative.test.ts` (2): delete-after-ended.
- `test/unit/acpServeHandshake.test.ts` (2): refused session on
  isolated credentials; CLI-missing sentence on scrubbed PATH.
- `test/unit/teamEnginePorts.test.ts` (15),
  `test/unit/teamPaid.test.ts` (6): real worker/merge/tariff proof.
- The ten link tests (noOutputContinuationCap, noRoundCap,
  toolRoundsUsableReplyGuard and toolRoundsWrapUpGuard through the
  guardProcess helper, importIo, real-use, reportSourceReasons ×2,
  sequenceStore, reports.e2e): same product branch via
  privilege-free links.
- `test/unit/eval/evalFreezeLayout.test.ts` (4): identical digests for
  TMP inside and outside the repo.
- `test/unit/connectorStorageGuard.test.ts` (8),
  `test/unit/connectorServe.test.ts` (14 with the serve file),
  `test/e2e/connectorStdio.e2e.test.ts` (7): guard behaviour on the
  default (dirty) `%TEMP%`.
- `test/unit/cx1r2Truth.test.ts`, `test/unit/cx1r4Truth.test.ts` (41):
  dormant-feature truth after the README fix.

## Red/green drills

### Drill 3 — runner EBUSY vs the 1-in-5 race

RED: on the base, `runnerHelperNative` fails 2/2: readers unlinking
the run's output right after `ended` hit EBUSY deterministically
(the native supervisor lingers ~4 s holding a second output handle
`ReleaseOutput` cannot name; measured handle 6F0 on `output` after
the release, supervisor exit and output-free coinciding to the
millisecond). Removing the `ReleaseOutput()` call passes the suite
but re-opens the measured 1-in-5 race it fixes.

GREEN: with the output opened delete-shared (supervisor and `output`
action), the suite passes 2/2 and the 20-isolated-runs drill
(`temp/drill-runner20.mjs`, since removed with the lane's temp
files) deleted after `ended` 20/20 clean — a 1-in-5 race would pass
all twenty with probability 0.8^20 ≈ 1.2%. Both guarantees hold:
no race (release-before-record kept), no EBUSY (delete-shared
output).

### Drill 4 — handshake staging and readiness

RED 1: without credential isolation the served agent sees this
machine's real credential file (Windows `homedir()` ignores HOME)
and takes the signed-in path: `session/list` answers `Internal
error` instead of the authentication refusal
(`temp/drill4-red.txt`: 1 failed, 1 passed).

RED 2: with the full PATH the no-CLI case answers the signed-in
refusal instead of the CLI-missing sentence
(`temp/drill4-red2.txt`: 1 failed, 1 passed).

GREEN: an empty `XDG_CONFIG_HOME` moves the credential lookup into
the isolated stage (refusal, nothing started), and the scrubbed-PATH
case expects the CLI-missing sentence: 2/2 with and without the CLI
on PATH. The staging helper is byte-identical to the base.

### Drill 5 — team ports, real git and the real tariff

RED 1: breaking the worker-run outcome in `teamEnginePorts` fails
the engine-worker case (`temp/drill5-red.txt`: 1 failed, 14
skipped) — the suite proves the real port, not a script.

RED 2: swapping the tariff tier in `teamPaid` fails both pricing
cases (`temp/drill5-red2.txt`: 2 failed, 4 passed).

GREEN: 15 + 6 pass against real repositories and the real tables.
The 73 fake-driven `teamHostService` cases are deleted, not ported.
Known gap, stated not solved: service wiring that needs a live
model is left to the live end-to-end run, and the D78 journal
adapter is still missing.

### Drill 6 — ten link tests without symlink privilege

RED: `temp/eperm1.txt` (9 failed across 8 files, all `EPERM ...
symlink`) and `temp/e2e-red.txt` (reports.e2e, `EPERM ...
symlink`): this Windows account has no symlink privilege, like most
Windows machines without Developer Mode.

GREEN: junctions (which report `isSymbolicLink` and resolve through
`realpath` like symlinks), one dangling junction, and hard links
(which trip the reader's own `nlink` refusal with the same
`refused` reason) — 100 unit + 27 e2e pass with the real behaviour
still tested. Product audit: at run time on Windows the product
never needs symlink privilege — only the skills installer creates
junctions (no privilege needed) and the judge self-test creates
links (non-Windows only); `native/` creates none.

### Drill 7 — freeze layout with TMP inside the repo

RED: `temp/freeze-red.txt`: `Cannot copy ... to a subdirectory of
self` — the recursive `cpSync` of the whole repo refuses when TMP
sits inside the checkout (suite fails to run, 4 skipped).

GREEN: per-file staging (content plus mode, links kept as links)
passes 4/4 with TMP inside the repo and 4/4 with the default TMP;
the digest-equality assertion proves the copy faithful either way.

### Drill 8 — the TEMP guard, the suites and the packed product

RED (suites): with the default `%TEMP%` (foreign Modify grants),
`connectorStorageGuard` fails 3/8 (`temp/conn-red.txt`,
`ECONNECTOR_STORAGE`), `connectorServe` fails 5 (`temp/conn2.txt`),
and `connectorStdio.e2e` fails 6/7 (`temp/conne2e-red.txt`): the
anchor inherits the foreign grants and the guard rightly refuses.

GREEN (suites): `usingPrivateDir` locks each store to this user,
SYSTEM and Administrators, and the e2e locks its stage down — 8/8,
14/14 and 7/7 on the default `%TEMP%`.

RED (media root, found by the real-TEMP full run): with the default
`%TEMP%`, `mediaConvert` fails 1/1 — `openPrivateRoot` under the raw
shared folder refuses with `EPRIVATE_ROOT` before conversion runs,
so the cause is not the expected `ENOENT`
(`temp/f-full-realtenv.txt`). Production never stages conversion in
a shared temporary folder (`productionAudioEntry.ts`: "a fresh
owner-only folder inside the host's verified private root (its own
storage, never a shared temporary folder)"), so the test staged it
wrong.

GREEN (media root): `mediaConvert.test.ts` uses `usingPrivateDir` —
passes under the real `%TEMP%` (`temp/f-mediagreen.txt`, exit 0),
and the final full run below is green with it.

PACKED (this PC, `muse-spark-code-acp` win32-x64 pack of this
lane, `temp/probe-item8.mjs`, `temp/probe8.txt`):

- Isolated data: `mcp status` exit 0 (`Connector: on`, no grants);
  `mcp kill` then `status` exit 0/0 (`Connector: switched off`).
- Dirty-TEMP data: `mcp kill` exit 0 (securing sets an explicit
  DACL, which succeeds), then `mcp status` exit 1 refusing with
  the said sentence: `The connector folder is not private to your
account (<store>), so nothing was done. Make it private to your
account (or delete it and grant again) and try again.`
- ACP handshake on the dirty-TEMP machine: protocol intact,
  `authRequired` answered; sessions are unaffected because the
  agent homes its data at `%LOCALAPPDATA%` (or the install folder),
  outside `%TEMP%`.

Verdict: the packed product keeps working on this PC. Only a store
deliberately placed under `%TEMP%` refuses later verifies, naming
the store and the remedy. Private-folder rule: durable state never
lives in `%TEMP%`; per-call temporary folders go through the
locked-folder pattern.

## Findings left open

- Item 5's live-model wiring and the D78 journal adapter (above).
- A full-battery run left `%SystemDrive%/ProgramData/.../Caches`
  font-cache databases in the worktree (a stripped-env child letting
  the Windows font subsystem resolve its cache path against the
  checkout). Deleted; recreated once during a later full run and
  deleted again. The exact suite is UNMEASURED (connectorStdio,
  reports and schedules e2e re-runs do not recreate it). Untracked
  debris only; no gate reads it.
- `npm run package:acp` (universal) fails on Windows for the
  missing darwin helper, as expected; the win32-x64 target packs.
- This lane's shells run with `TEMP`/`TMP` redirected by the harness
  to a 114-character tree path, not the default `%TEMP%`. A full run
  under it failed only `lintStagedBatching` (absolute paths over
  MAX_PATH, `Filename too long`); under the real default `%TEMP%`
  that suite passes. All proof runs below use the real default.
- SAST fails on this PC independent of the tree: `semgrep-core rule
validation failed` before any file is analyzed, identically for a
  trivial one-line file, on scanner 1.177.0 and the pinned 1.180.0
  (the fetched registry `auto` rules vs the local core). Hosted CI's
  semgrep job is the real gate.

## Gates (final tree, real default `%TEMP%`)

- typecheck (all 5 projects): 0 (`temp/f-typecheck.txt`)
- eslint (src+scripts, test, touched files): 0
- prettier: 0 (after fixing the new record's style)
- deadcode: 0 (after removing the re-export item 5 orphaned)
- cycles: 0, duplication: 0 (0 clones)
- check:l10n, check:reference, check:host-api, check:plan
  (227 milestones, 0 drift), check:roadmap (227 entries), check:catches: 0
- build: 0 — modelApi.js 524.2/525 KiB, resourceAdmission.js
  21.3/25 KiB, vaultActions.js 20.8/25 KiB (`temp/f-build.txt`)
- security:audit: 0; security:sast: FAILS (tree-independent, above)
- vitest related (9 changed sources): 0 — 81 files, 1575 passed,
  33 skipped (`temp/f-related.txt`)
- touched suites: 0 — 20 files, 220 passed (`temp/f-touched.txt`)
- full suite, `test/unit/vault/**` excluded, real default `%TEMP%`:
  0 — 890 files passed, 13 skipped; 23,786 tests passed, 179
  skipped, 0 failed (`temp/f-full-final2.txt`, exit 0). The prior
  final run showed one load-marginal timeout (connectorStdio.e2e
  first case, 15 s deadline, no assertion failed); the file is green
  alone and under synthetic load, and green in this run.
