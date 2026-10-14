# Test overhaul 2026-10-12 (lane TESTCUT)

Owner's words (2026-10-12, binding): the suite is full of useless tests that
catch nothing, waste time, and let broken code ship as "completed". The
overhaul streamlines it to something meaningful: no test stands on fake code,
no screenshot runs in CI, a UI change gets one small local look, and the
packed product's real-life run is the product's test.

## Before and after

Measured with the same flags both times (`npx vitest run --maxWorkers=3`,
repository default timeouts, no coverage; a full run exceeds one foreground
call, so sequential foreground chunks and wall is the sum of chunk walls).
Before: rig `kubuntu` (10 cores), five chunks of ~264 files. After: this
lane's Linux laptop (8 cores shared with three other lanes), four chunks of
~131 files. Different machines, so the wall comparison is approximate; the
file and test counts are exact.

| Measure                                       | Before                                         | After                                                                                                 |
| --------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Unit test files                               | 1,321                                          | 524 (1,321 − 797 deleted: 786 PASS 2a + 1 PASS 1 fix + 2 PASS 3a + 8 PASS 4; reconciled file by file) |
| Unit tests                                    | 27,650 (27,437 passed, 33 failed, 180 skipped) | 8,988 (8,911 passed, 26 failed, 51 skipped, after-fix basis)                                          |
| Unit wall minutes                             | ~26 (179+194+508+360+312 s chunks)             | ~5.5 (92+55+113+69 s chunks)                                                                          |
| Pull-request workflow minutes (from job list) | ~25 (audit §D estimate)                        | ~15–17 full tier (queue off), ~6–8 fast tier (queue on): see PASS 5                                   |

After-failures (26): 18 `inspectNative` (exit 125, sandbox refuses the
native helper — the before run names the same 18 on the untouched base);
5 `treesLinuxLaunchNative` (cgroup layout: `expected 'group' to be
'cgroup'` — same 5 as before, environment probing, no lane change near
it); 2 packaging (`runtimeChatGptPackage`, `usagePackaging`: npm refuses
its cache directory in the sandbox — both pass 2/2 and 12/12 with
`NPM_CONFIG_CACHE="$TMPDIR/npm-cache"`, measured); 1 `spawnInventory`
(listed for the lead below, not environmental). The `acpPackageFixtures`
failure found mid-measure (it named the deleted execStdio e2e) is fixed
in-lane and green 3/3.

Before-failures (all on the untouched base, so measured, not labelled):
24 in sandbox-refused native suites (`inspectNative` 18,
`treesLinuxLaunchNative` 5 — the audit names both; `vault/peer` 1 is GO
and deleted); 3 in npm-cache-refused packaging suites
(`vsixCompression`, `usagePackaging`, `runtimeChatGptPackage` — the audit
proves the pattern passes with `NPM_CONFIG_CACHE`); 6 in GO files
(`usageIntegration`, `usageRollup` ×3, `reportHistory`,
`resourceHistoryReview`) that this lane deletes, so they are moot after.

Audit reference (lane TESTAUDIT, different rig): 1,319 files, 27,619 tests,
16 min 52 s wall. Our file count matches (1,321 unit test files here).

## The rules (a test STAYS only if all four hold)

1. It imports and runs REAL code only: no `vi.mock`, `vi.doMock`,
   `vi.hoisted` feeding a mock, `vi.stubGlobal`, `vi.stubEnv` faking a
   platform, fake timers, `vi.spyOn` with a replacement, hand-written
   stand-ins for our modules/providers/CLI/GitHub/MCP/editor/stores, or
   hand-answering local servers; and no import, direct or through a helper,
   of a file that has any of those.
2. Allowed: the real module, data passed in, real temp folders/files, real
   child processes of our own code, observer callbacks. A bare `vi.fn()`
   seam callback whose calls are asserted (return value only satisfies the
   seam) is an observer, not a stand-in.
3. It checks behaviour a person or caller depends on (PASS 4). Inventory,
   baseline, snapshot and gate-table pins that cannot fail when the product
   breaks for a person go.
4. No end-to-end/process test against a stand-in. `*.live.e2e.test.ts`
   (real provider calls) are listed for the integrator, not deleted here.

## PASS 1 — classify by parsing

Classifier: `scripts/test-overhaul/classify.mjs`, run as
`node scripts/test-overhaul/classify.mjs --write`. It parses every file
under `test/` with TypeScript's own parser (`typescript@6.0.3`), collects
per-file evidence (mock/timer/stub/spy/stand-in/server constructs, every
static and dynamic import specifier), marks helper files fake by name
(`fake|mock|stub`, `unit/mocks/`, `e2e/fake-muse/`) or by their own
banned construct, then follows each test file's relative imports
transitively: a test reaching a fake through any helper is GO. Output:
`docs/testing/test-overhaul-2026-10-12.json` (file, verdict, first
construct or import that decided it) plus counts.

Counts: 1,658 files under `test/` — 754 STAY, 872 GO, 32 LIST.
Test files: unit 1,321 (535 STAY / 786 GO), e2e 16 (11 GO / 5 LIST: the
4 `*.live.e2e.test.ts` files plus `live.e2e.test.ts`, the real-CLI drill),
integration 8 (all LIST for the integrator); 10 more LIST are helper/mock
files kept with a named LIST suite (below). Top GO deciders: `vi.mock`
146, `./helpers/fakes` 115, `vi.useFakeTimers` 58, `./helpers/fakeToolIo`
30, reporting-snapshot fake 28, `vscode` import 26, `vi.stubGlobal` 20,
browser/scene rendering 11, visual-audit reads 2.

Three fixes landed after the first hand check, all re-verified by re-run
(diffed row by row against the previous record: only the intended rows move):
`test/e2e/live.e2e.test.ts` is LIST (real CLI drill; its only fake import
is the log sink), and tests that launch Chromium or render scripted
harness scenes are GO (process tests; the short gate is pure logic only).
`test/unit/modelApiSaveRejection.test.ts` is GO: it bundles child code as an
esbuild `contents` string that runs against `fakeModelApi`/`memoryToolIo`/
`memoryContextIo`, which static imports cannot see, so the classifier now
also flags fake-helper paths inside string literals (`bundledFake`); the
re-run moved exactly that one row STAY→GO (two already-GO rows only changed
their deciding note). The file is deleted with the other GO tests.

Fourth fix: helpers kept only by LIST suites are LIST, not GO. Ten
non-test files (`helpers/fakeContextIo`, `fakeGit`, `fakeGitHub`,
`fakeModelApi`, `fakePaidFeatures`, `fakeToolIo`, `fakes`, `mcpFixtures`,
`modelApiManager`, `mocks/vscode`) are GO by own construct but no STAY
test reaches any of them; every importing test is a LIST suite
(`test/e2e/*.live.e2e.test.ts`, `test/e2e/live.e2e.test.ts`,
`test/integration/*.test.ts` — the JSON names the suite per file). The
classifier's second phase walks the reverse import graph and re-verdicts
such helpers LIST ("kept with LIST suite (…)"); the re-run moved exactly
those ten rows GO→LIST and nothing else. They stay until the integrator
replaces the LIST suites with real-provider runs, so the tree typechecks
meanwhile. Four of them (`fakeGitHub`, `fakeContextIo`, `fakeToolIo`,
`fakePaidFeatures`) were deleted before this rule existed and are
restored in PASS 2; the lesson is recorded: the first orphan grep matched
only `helpers/<name>` path strings and missed same-directory relative
imports (`./fakeGitHub`), while the resolver-based check (every survivor
import resolved against the deleted set) finds all eight dangling edges,
including two genuinely orphaned fixtures (`playbookPolicyFixture.ts`,
`reportRenderFixtures.ts`, deleted) and two harness scenes whose deleted
imports PASS 3 decides (`test/harness/estimator/scene.tsx`,
`test/harness/goldens/integrated.tsx`).
Borderlines re-read: `whatsNewFixture` (STAY — pins the What's New
fixture, not pixels), `chatColumn` (STAY — asserts real stylesheet
geometry), `teamResources` (STAY — "playwright" is a command string, not
a browser), `m114PanelEvidence`/`m114Audit` (GO — read the deleted audit).

Known limits (all noted, none silent): bare `process.env` assignment and
`Date.now` patching are not flagged (not in rule 1's list); dynamic
imports with non-literal specifiers are not followed; `vi.spyOn`
call-through without a replacement stays (rule 1 bans it only with a
replacement). Port/seam object literals built from `vi.fn()` (e.g. a
hand-built store passed to the real module) are GO under the strict
reading of rule 1 — this is the owner's "no exceptions", recorded here
so the lead can see its price.

Hand check (40 STAY + 40 GO sampled by even stride across the sorted
verdict lists, evidence re-read in the files by hand): all 40 GO files
contain the recorded construct (own-file `vi.mock`/`vi.hoisted`/
`vi.stubGlobal`/`vi.stubEnv`/fake timers/spy-with-replacement, a
`Fake*` import or construction, a `vscode` import, or a transitive fake
import such as reporting/snapshot or vault/core). Of the STAY sample, 39
are clean under both the parser and a text scan; the one hit,
`test/unit/feedback.test.ts`, passes observer `vi.fn()` seam callbacks
whose calls are asserted — STAY is correct under rule 2, and the
classifier was fixed (observer-var tracking) so it says STAY. Two
borderline files checked line by line: `judgeUse.test.ts` (GO —
`mockImplementation` on a hand-built host rig) and `promptMenus.test.ts`
(GO — hand-built store object) are genuine stand-ins; `feedback.test.ts`
(STAY) and `sessionBudget.test.ts` (STAY — bare `vi.fn` guard seam) are
genuine observers. Script fixed where the check found the gap; no
allow-list added.

## PASS 2 — deletions

All 872 GO files deleted (`git rm`): 787 unit test files, 67 unit
helper/mock/fixture files, 14 e2e files, 2 `test/action` fakes, 1
`test/fixtures` fake, 1 harness verifier — every one for a rule-1 or
rule-4 construct the JSON names. No deleted test file has any other
verdict (checked: every deleted `*.test.*` path is GO in the record).
89 STAY support files nothing imports any more deleted with them (78
swept after the GO deletions, 11 found by the resolver check below,
including 2 fixtures that dangled on deleted fakes). 10 helpers stay as
LIST with their named suite (fourth fix above). Kept LIST suites:
5 live-provider e2e, 8 integration files, `test/hosts/*`.
Two harness scenes (`test/harness/estimator/scene.tsx`,
`test/harness/goldens/integrated.tsx`) import deleted fixture helpers;
nothing typechecks or runs them today, and PASS 3 decides them.
Verification: every surviving file's imports resolved against the
deleted set (8 dangling edges: 4 LIST-chain helpers restored, 2 orphan
fixtures deleted, 2 scenes deferred to PASS 3); `npm run typecheck`
green on all five projects afterwards. Exact test-count delta in
PASS 6 (before 27,650 unit tests on the untouched base).

## PASS 3 — screenshot system removal

PASS 3a deletes the pixel-comparison pipeline entire: `check-visual`,
the `visualImages` pixel code, the `visualManifest` sharding tooling,
the capture-inputs list, the goldens capture/fixtures/manifest/a11y
code, the visual matrix, the M114 audit JSON it reads, the two visual
tests (`visualMatrix`, `visualSource`) and the orphaned audit-capture
helper — 19 files — and trims the capture pins out of
`whatsNewFixture`. What stays: the harness scenes, `readme-shots`, and
one small local command for a person to look at a changed screen,
`npm run ui:look -- <scene> [--theme light|dark]`, rendering into
`temp/ui-look/` with no baseline, no comparison and no CI. PASS 3b
drops the `visual-shards` and `visual` jobs and every `needs:` edge
from `build.yml`, mirrors the workflow in `manifest.test.ts`, and
repairs two PASS 2 danglers the deleted reporting verifier left
(`scripts/a11y.mjs` spawned it; a mirror test read its source): the
report-page axe cover lapses with it, listed for the lead below.

## PASS 4 — rule 3 decisions (one line each)

Decision rule: a file goes only if everything it asserts is also enforced
by a pipeline gate on real inputs (`npm run build`'s size/split gates,
a `check:*` gate, CI fail-closed wiring), so no person-visible breakage
slips through its deletion. Snapshots: no `toMatchSnapshot` family user
survives (the audit's 7 snapshot-kind files were GO and deleted in PASS 2).

Deleted (8 test files; the roadmap wiring pin moves, everything else has
a gate doing the same job on real inputs):

- `webviewBundle.test.mjs` — ran the size/split gates over mock dist
  trees; the build runs the same gates over the real tree.
- `webviewBundles.test.mjs` — unit-tested the checker's grouping on
  hand-built metafiles; the build runs it on the production metafiles.
- `reportingBundles.test.mjs` — M113 boundary bytes and membership the
  size gate (budgets) and split gate both enforce; the 51,157-byte
  baseline fails with no person hurt.
- `playbookBundles.test.mjs` — playbook-out-of-startup plus the 25 KiB
  closure, both build-enforced; bytes backstop any placement slip.
- `resourceHistoryBundle.test.mjs` — ResourcesSection placement (the
  build runs `checkResourceWebview`) plus 25 KiB/900 KiB build caps.
- `vsixBudget.test.mjs` — the vsix cap the packages job
  (`node scripts/check-vsix-size.mjs ./*.vsix`) and `package-vsix.mjs`
  already enforce.
- `teamActivationGraph.test.ts` — the exact team/runners regex the
  split gate carries for activation, Model API and ACP bundles.
- `genRoadmap.test.mjs` — generator rules re-verified by
  `check:roadmap` on the real PLAN on every gate run; its "wired into
  quality:gates" pin moves to manifest.test.ts's CIFLOW suite (the
  leaves comparison drops both sides together, so it could not hold
  the pin alone).

Stayed (what a person loses if deleted):

- `manifest.test.ts` release-workflow half (RELFAST/RELFAST2/M80 LA) —
  the only fail-closed wiring check on release reuse, cancellation
  blocks and the owner-only live-Action gate; workflows execute their
  own text, so nothing else catches a miswire.
- `uiTextRegions.test.mjs` — the generated Node fallback's runtime
  (lazy install, per-language state, vault round-trip); `check:l10n`
  is static parity and never executes it.
- `legalDeps×8` — per-ecosystem license gap handling ("never a silent
  zero"); same shape, eight different scanners, legal risk.
- `tabConstants`/`teamConstants`/`teamCapValidation`/money suites —
  decided spending-cap values with no gate behind them; a silent change
  bills a person.
- `teamStartup` — tests 2–3 (constants tree-shaking, parsing without
  team.js, every deferred payload validates) cover behavior no gate
  runs; test 1's membership/bytes duplicate the build, noted.
- `teamRuntimePackage`, `developerOptionsPage`, `modelApiEntryExports`
  (pins the B1 missing-export regression), `planReader`,
  `legalFixProduction`, `lazyBundleFiles`, `releaseIntegrity`,
  `packagedBundles`, `releasePublish`, `estimatorLocalization`
  (unfinished commands must not reach the palette), `noticesInput`,
  `scheduleProvenance`, `sideCallSchemas`, `supportReport`,
  `reportProblemDialog`, `teamRefFence`, `spawnInventory` (new spawn
  sites fail first), `themeInventory` (traversal refusal),
  `confirmedDispatchInventory` (only the helper refuses billed
  requests), `featureCatalogDetails` (MONEY017E help regression),
  `cx1r2Truth`/`cx1r4Truth` (shipped claims match the product) —
  behavior or claim-truth a caller or reader depends on.

## PASS 5 — gate and workflows

`test:unit` is `vitest run` with no `--coverage`; the thresholds and the
merge job are gone (the number measured fake-driven tests). `quality:gates`
is format, lint, typecheck, badges, tokens, l10n, reference, host-api, plan,
roadmap, deadcode, cycles, duplication, `test:unit`, `build`,
`security:audit`; `quality` adds `test:a11y`, `test:legal-a11y`,
`security:secrets`, `security:sast` as before. The checks matrix `build`
part runs the same list (the CIFLOW leaves test holds it).

Hosted CI: the fast PR tier is Ubuntu static gates plus one unsharded unit
run; the full tier keeps the unit os×shard matrix (4 Ubuntu, 8 Windows, 8
macOS — the 20-minute hosted limits still bind there) with no coverage
shards, no process-test shards, no visual shards, no coverage merge job.
System-specific survivors are selected the way they always were: per-file
`runIf`/`skipIf` on `process.platform` (e.g. `it.skipIf(!isWindows)`,
`it.runIf(process.platform === 'linux')`), so a Windows-only file runs its
cases on Windows and skips elsewhere; the matrix is unchanged and the record
states the cost plainly: win/mac full-tier jobs run the whole suite and
rely on those guards, there is no maintained path list to drift.

Accessibility (`test:a11y`, `test:legal-a11y`) is out of the pull-request
path: the job runs only when the caller event is not `pull_request`
(merge groups, manual runs, releases), and the required aggregate accepts
`skipped` there and demands `success` elsewhere — proven by the reworked
bash-cases mirror (24 subshell cases, including full-PR-skipped-passes and
full-PR-checks-failed-fails). What it renders, for the lead's rule-1 call:
`scripts/a11y.mjs` opens every harness scenario in headless Chrome
(Playwright) in four captured VS Code themes, served from the built webview
bundle behind the scripted host, and runs axe-core WCAG 2.0–2.2 A/AA with a
§8 exemption list; `test:legal-a11y` adds keyboard/zoom checks plus
per-language runs. No mocks in the tool — but the pages are scripted
harness scenes, not the product in an editor. The report-page axe cover
lapsed with the reporting verifier (PASS 3b); `m113-w-a11y.json` is its
last receipt.

Release: a comment-only placeholder reserves the `check:claims` step
(branch feat/claims-gate) ahead of publishing — no stub, nothing that
pretends to pass.

`package` was first put in the gate, then taken back out in review
(RVTESTCUT): `npm run package` stops in `package-vsix.mjs` at
`Required Linux created-path helper excluded from VSIX: arm64`
wherever the CI-built natives are not staged — and only the packages
job stages them, so the checks job (and a dev machine) could never
pass it. Packing stays gated in the packages job, where both arches
are staged first; `npm run build` is the checks gate's last step.

Pull-request minutes, computed from the job list (E = estimated from
cited hosted records, not measured here): full tier (queue off) ≈ 15 —
checks macOS slowest ~11 (CIFIX017R3), unit Windows shard ~6–10E (was
16 with the old suite; a third of the tests remain, hosted variance
±60%), integration capped at its 15-minute timeout, accessibility
skipped. Fast tier (queue on) ≈ 6–8 — Ubuntu checks, one unsharded unit
run (~5.5 rig-measured in chunks), build. Before: the audit's ~25 for
the same tier with coverage shards, visual shards and the old suite.

## The lead's added hook defect (2026-10-12 evening)

`test/unit/nativeGitPipeline.test.ts` (the busy-wait `pre-push` hook) was
already deleted in PASS 2a as GO (`vi.useFakeTimers`); its hook died with
it — nothing to fix there. Survey of every surviving test and helper that
writes a script or hook (`#!/bin/sh` carriers in `zipExtract`,
`runtimeStore`, `pluginDispatch`, `agentImport`, `teamWorkerEnv`,
`teamLanding`, `teamRepository`, `github/repositories`, plus the
`pre-commit` fixture and every `hooks/` writer): all are one-shot
(echo/exit/guard/refuse), none loops, none waits. The only waiter,
`until` in `test/unit/helpers/acpWaits.ts`, polls with a 5 ms sleep under
a 2 s deadline and throws — the correct pattern. No fix needed anywhere.

## Lists for the lead

### Golden request suite and SoL-Pi invariants (kept, not deleted)

All pass rule 1 today (classifier STAY; hand-verified zero banned
constructs and zero fake/helper imports): the real encoders run over
constructed bodies and the bytes are compared with checked-in recorded
bytes. Owner-ruled invariants; the integrator owns their future.

- `anthropicCodec.test.ts` (+ `anthropicCodecGoldens/`: first-turn,
  thinking tool loop, compaction, goal-progress, growing-history, image,
  packed-output) — `encodeAnthropicRequest` vs recorded bytes; decode
  paths run recorded SSE captures (with capture dates in-file).
- `ollamaCodec.test.ts`, `chatgptResponsesCodec.test.ts`,
  `modelapiChatCodec.test.ts`, `responsesCodec.test.ts`,
  `codecShared.test.ts` — same shape per provider codec.
- `modelApiPrefixGoldens/recall-tool.json` + its reader suite — the
  immutable-prefix invariant (cache billing).
- SoL-Pi names: `then_run` sites (`bridgeChecks`, `instructions`,
  `verifyRows` — all STAY), `ObservationPack`
  (`src/core/backends/modelapi/observationPack.ts`, exercised by STAY
  suites), `modelsPanelReducer.test.ts` (STAY), `autoCompact.test.ts`
  (STAY), the judge family (`judge.test`, `judgeBench`,
  `judgeSameModelApi`, `judgeContract`, `judgeMath` and 8 more STAY;
  `judgeActivation`, `judgeConsent`, `judgeFences` went GO with their
  fakes), `eval/evalReport.test.ts` (STAY).
- Proposed stay-real rule if one ever fails rule 1: keep the recorded
  bytes/dates as data fixtures and run the real module — never a
  hand-answering stand-in.

### Money arithmetic and budget decisions (all pass rule 1; none listed as failing)

21 STAY money files, all pure functions over data or real journals —
spot-checked `usd`, `accountUsd`, `tabSpend`, `sessionBudget`
(`guard.mockImplementation` is a bare-`vi.fn()` seam callback asserted
on, the PASS 1 observer pattern), `paidMoneyStructure`,
`teamCapValidation`, `accountUsage`, `usage`. Nothing to list: no money
file fails rule 1. The 22 GO money files were fake-driven and deleted
with the rest.

### test/integration per file (listed, not deleted)

Real editor throughout (Extension Development Host); model backend last.

- `codeIntel` — real editor + real TypeScript service over the fixture
  workspace. No model backend. Compliant; keep.
- `extension` — real editor BUT `fakeModelApi` backend. Fails rule 1;
  the integrator replaces the backend with a real-provider run.
- `legal` — installed package's real lazy scanner, but adapters use
  fake transports. Fails rule 1; list.
- `pageWorker` — shipped `dist/pageWorker.js` in a real worker thread,
  converts a page. No model backend. Compliant; keep.
- `questions` — real renderer but a test-only injected host, no model
  call. Strictly a stand-in host; list.
- `tab` — real host, but the provider runs against a local fake Model
  API. Fails rule 1; the integrator replaces it.
- `verifyEditor` — real TypeScript/JSON language services (diagnostics,
  formatter). No model backend. Compliant; keep.
- `webFetch` — real editor proxy support; a loopback proxy stands in
  for the user's (tunnel target is the PINNED address). Borderline
  stand-in for outside world, not a provider; list for the call.

### Listed, not fixed (survivor red after the deletions)

- `spawnInventory.test.mjs` → `requires every source process import
and launch`: `proveTestOnly` reported `exercised: false` for
  `nodeGitProcesses` (the checkout git port's default) and
  `openWorkerFile` (the worker fence's file opener) — the only tests
  that called them by name were GO deletions (the nativeGit suites).
  Both symbols are still live-wired production defaults
  (`options.processes ?? nodeGitProcesses`; `openFile:
openWorkerFile`), so they are not dead code and were not removed.
  Fixed in review (RVTESTCUT): `nativeProcessDefaults.test.ts` runs
  both for real (git through `run` and `start`; a real temp file
  through `WORKER_NATIVE_IO.openFile`), so the profile is proved
  again and the suite is green.
- `readme-shots` `deterministic-report` shot: needs the deleted
  reporting verifier's `--prepare` output (`temp/m113-v/scenes.json`,
  built from deleted `reportRenderFixtures`). The spawn fails closed
  (`Report screenshot preparation failed`); the README picture is now
  un-regenerable until its fixture pipeline is rebuilt. Lead call.
- Report-page axe cover lapsed with the verifier (PASS 3b);
  `m113-w-a11y.json` is the last receipt. Lead call (fold the
  reporting scenes into `scripts/a11y.mjs` or accept the gap).

### Listed, not fixed (deadcode exposes test-only-reached src islands)

`npm run deadcode` (knip) is red on this lane: 112 unused files, all in
`src/`, plus 210 unused exports of the same origin. Mechanism, proven
per file: on the base tree each island was imported only by tests this
lane deleted (e.g. vault/store ← vaultStore.test.ts, schedules/time/loop
← scheduleTime.test.ts, devices/deviceReceiver ←
deviceAccountReceiver.test.ts); no production file imports them, and no
surviving test does either. They cluster in unlanded feature areas —
vault/* (M109 broker service lands later), host/team + core/team,
webview models accounts sections (M108), media recorder (M105), theme
bridges (M114), schedules time/events, MCP oauth, estimator
calibration — other lanes' foundations. Deleting them would destroy
other milestones' work; ignoring them in knip would weaken the gate.
The full inventory is `docs/testing/test-overhaul-unused-src.txt`.
Lead call per subgraph: land/wire it, or delete it.

Fixed in-lane alongside: 11 orphaned test-support files nothing
imports (6 unit helpers, the e2e helper fixture, 5 driverless harness
check/entry pages whose GO drivers are gone), 15 stale knip entries
pointing at deleted files, the stale cycles.json exclusion, and the
`test/hosts/schedule-os-win11.mjs` dangling fixture — which exposed a
PASS 2b error: `fakeScheduleWake.mjs` was still used by that LIST
hosts script (by path string, which the import sweep cannot see), so it
is restored with a knip entry rather than left dangling.

## Review corrections (RVTESTCUT, 2026-10-14)

- The classifier missed every chained `vi.spyOn(x).mockX(...)`:
  `calleeChain` stops at the call receiver, so the head was the bare
  `mockX` and the dot-anchored pattern never matched. Fourteen
  surviving suites with a spyOn replacement were STAY in the record
  above (the 40-file hand sample happened to contain none). The
  classifier is fixed (a `vi.mocked` receiver stays the rule-2 seam;
  a `vi.spyOn` receiver never does) and the 14 suites are rewritten
  through the real module or, where the replacement was the only
  mechanism, excised case by case. The JSON record is the historical
  base-tree run and is not regenerated; its spy-chain deciders
  undercount by this class.
- `cyclesRoots` was red on the lane head: the restored
  `fakeScheduleWake.mjs` had its knip entry but no cycles root. Added.
- `package` left `quality:gates` and the checks matrix (PASS 5 above):
  only the packages job stages the Linux natives it requires.
