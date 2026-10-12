# Test overhaul 2026-10-12 (lane TESTCUT)

Owner's words (2026-10-12, binding): the suite is full of useless tests that
catch nothing, waste time, and let broken code ship as "completed". The
overhaul streamlines it to something meaningful: no test stands on fake code,
no screenshot runs in CI, a UI change gets one small local look, and the
packed product's real-life run is the product's test.

## Before and after

Measured on rig `kubuntu` (10 cores), same command both times
(`npx vitest run --maxWorkers=3`, repository default timeouts, no coverage):

| Measure                                       | Before                                         | After        |
| --------------------------------------------- | ---------------------------------------------- | ------------ |
| Unit test files                               | 1,321                                          | TBD (PASS 2) |
| Unit tests                                    | TBD (run in progress, `temp/before-unit.json`) | TBD          |
| Unit wall minutes                             | TBD                                            | TBD          |
| Pull-request workflow minutes (from job list) | TBD (PASS 5)                                   | TBD (PASS 5) |

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

Counts: 1,658 files under `test/` — 755 STAY, 881 GO, 22 LIST.
Test files: unit 1,321 (535 STAY / 786 GO), e2e 16 (11 GO / 5 LIST: the
4 `*.live.e2e.test.ts` files plus `live.e2e.test.ts`, the real-CLI drill),
integration 8 (all LIST for the integrator). Top GO deciders: `vi.mock`
146, `./helpers/fakes` 115, `vi.useFakeTimers` 58, `./helpers/fakeToolIo`
30, reporting-snapshot fake 28, `vscode` import 26, `vi.stubGlobal` 20,
browser/scene rendering 11, visual-audit reads 2.

Two fixes landed after the first hand check, both re-verified by re-run:
`test/e2e/live.e2e.test.ts` is LIST (real CLI drill; its only fake import
is the log sink), and tests that launch Chromium or render scripted
harness scenes are GO (process tests; the short gate is pure logic only).
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

## PASS 2 — deletions (TBD)

## PASS 3 — screenshot system removal (TBD)

## PASS 4 — rule 3 decisions (one line each; TBD)

## PASS 5 — gate and workflows (TBD)

## Lists for the lead (TBD)

### Golden request suite and SoL-Pi invariants

### Money arithmetic and budget decisions

### test/integration per file
