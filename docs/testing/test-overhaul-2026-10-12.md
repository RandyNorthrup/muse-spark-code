# Test overhaul 2026-10-12 (lane TESTCUT)

Owner's words (2026-10-12, binding): the suite is full of useless tests that
catch nothing, waste time, and let broken code ship as "completed". The
overhaul streamlines it to something meaningful: no test stands on fake code,
no screenshot runs in CI, a UI change gets one small local look, and the
packed product's real-life run is the product's test.

## Before and after

Measured on rig `kubuntu` (10 cores), same flags both times
(`npx vitest run --maxWorkers=3`, repository default timeouts, no coverage;
a full run exceeds one foreground call, so five sequential foreground chunks
of ~264 files; wall is the sum of chunk walls):

| Measure                                       | Before                                         | After        |
| --------------------------------------------- | ---------------------------------------------- | ------------ |
| Unit test files                               | 1,321                                          | TBD (PASS 2) |
| Unit tests                                    | 27,650 (27,437 passed, 33 failed, 180 skipped) | TBD          |
| Unit wall minutes                             | ~26 (179+194+508+360+312 s chunks)             | TBD          |
| Pull-request workflow minutes (from job list) | TBD (PASS 5)                                   | TBD (PASS 5) |

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

## PASS 3 — screenshot system removal (TBD)

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

## PASS 5 — gate and workflows (TBD)

## Lists for the lead (TBD)

### Golden request suite and SoL-Pi invariants

### Money arithmetic and budget decisions

### test/integration per file
