# M98 phase-2 integration, round 3 — H/GH (macmini, 2026-10-05)

Starting tree `ef67306f`, branch `m98/p2int`. Read the rig brief,
`codex/common.md`, AGENTS, PLAN D77/M98 and the round-1/round-2/H/GH
certifications. The explicit brief overrides common's old main merge and
aggregate quality instructions. No push, rebase, stash, credential read,
network request, dependency install or live/paid/local model attempt: **0
attempts, $0**.

## Required merges

- `b2a165d1`: `--no-ff` merge of H `4fb42e0e`. No conflicts; all thirteen
  owning files pass **236 tests** on macmini.
- `1e53e27f`: `--no-ff` merge of GH `c98a0d14`, including its required
  M91 hook-contract/runtime ancestry. Its four owning files pass **86
  tests** on macmini. Forty-two conflicts are resolved by meaning: retain
  judge and M91 package/build/cycle inventories; union every translation
  key, including nested palette entries; retain M91's revised translated
  hook terminology; retain both PLAN histories and remove duplicate moved
  D70/D71/D79/M92 sections. Preserve the integration tree's existing caps,
  including English at 125 KiB. Generated host API and notices are rebuilt
  by script. The paid-host formatter conflict is repaired to use the
  localized USD helper consistently.

Both merges run the repository's lint-staged/Prettier and staged Gitleaks
checks through a worktree-local hook with only `--no-stash` added, retaining
all checks and changing no repository/user/machine hook setting. No leaks.

## Integration prerequisites

The inherited English fallback exceeds 125 KiB after M91's required
strings join. Lossless Brotli encoding applies only to the generated
production Node table, with exact decoded equality checked against EN.
Browser, development, source and translated tables keep their full form.
The original cap is unchanged.

The shared Node parser exports synchronous JSON Schema conversion through
a lazy sibling bundle, leaving both browser typing and the parser's 50 KiB
cap intact. MCP converts the canonical request schema when its tool is
constructed, replacing the static copy and retaining the existing parity
test. The converter's separate measured cap is 50 KiB; all inventories,
notices, SBOM, knip, cycles, globals and split checks include it.

Four source controls reject deliberate faults and restore saved bytes with
matching SHA-256: corrupt the decoded English table, load conversion eagerly,
accept a malformed writer, and remove the shared conversion export. Their
whole owning checks rerun green. The first export-control candidate survived
because G2's static schema made the export unused; that candidate is not
counted. Using canonical conversion makes the named missing-export build
guard fire. Recipes and hashes are in the adjacent round-3 drill JSON.

## Factory integration and Cursor policy

H ships in `judgeLint.js`, GH in `judgeHook.js`. The existing judge factory
loads either only on its explicit library action. It passes the installed
table/locale and its real ask runner into the children; no backend, grammar
acquisition or inference source is fabricated. H's missing extraction is
visibly incomplete and performs no admitted inference. GH's paid refusal
returns the observation contract's neutral answer without inference. Fake
admitted observations still deliver their warning through the shipped child.

Both children use the established synchronous lazy loader, checking a callable
same-build factory and retrying repaired missing/malformed files. The parent
factory retains stable identity and does not start a backend/server. New
predicate trust has an inline reason and a PLAN §8 row.

Cursor registration excludes **all five** blocking events: `preToolUse`,
`beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, and
`beforeSubmitPrompt`. Observation events remain available. README records
that owner decision, and a production-factory test fails when the exclusion
is removed. Direct unavailable rows are refused before source initialization
or admission. The library does not claim an installed hook/lint command.
GH's historical six activation fixture failures do not reproduce: all eight
activation tests pass on the resolved tree, with no fixture/paid-gate change.
J/FU and C/E/A/I/FP remain future work.

Five additional source controls fire and restore matching SHA-256: remove
`loadLint`, remove `loadHook`, admit malformed child exports, remove Cursor's
registration exclusion, and remove `partialRecord` from the shared parser.
Every whole owning check reruns green. The delivery matrix additionally
exercises 75 child membership controls and nine new size/global/VSIX allowlist
controls, retaining the earlier root guards. The adjacent JSON records the
source recipes, named failures and restoration hashes.

## Package-budget blocker

The exact prior 0.13.0 helper is reused the way release packaging stages it:
290,816 bytes, both arm64/x86_64 slices, strict signature verification, no
launch or microphone/permission request. All required files and translated
tables remain packaged.

The universal package exceeds the unchanged **2,252,800-byte (2200 KiB)**
cap. The first package is **2,379,314 bytes**. Repacking in scratch at ZIP
level 9 preserves every decompressed entry and name, but produces
**2,367,882 bytes**, still 115,082 over. This experiment does not change the
product packager. The final default package measurement is recorded below.
PLAN §7 logs the justified deferral. No cap, rule, threshold, timeout, ignore,
member, translation or behavior is weakened/removed to obtain a green gate.
The lead must resolve the cumulative package budget before release.

Full quality/coverage/a11y, installed CLI/source/OS receipts and future lanes
remain lead-owned. This private integration is **not release-certified**.

## Final macmini verification

All runs use at most three files, `--maxWorkers=3 --testTimeout=120000`,
with one heavy tool at a time. No skipped test or relaxed deadline.

| Owning/check file group                                    | Result                                 |
| ---------------------------------------------------------- | -------------------------------------- |
| H: thirteen files in five bounded batches                  | 236 tests pass                         |
| GH: four files (three + process)                           | 86 tests pass, repeated after wiring   |
| MCP and CLI dispatch (final GH process batch included)     | 58 tests pass                          |
| Factory + CLI dispatch after startup-byte repair           | 24 tests pass                          |
| Production delivery matrix                                 | 27 tests pass                          |
| Shared fallback/parser/converter and deferred split guards | 21 tests pass                          |
| Inherited judge activation                                 | 8 tests pass; no fixture change needed |

The first delivery grouping exceeds 120 seconds because it places 65 lint
controls in one synchronous test (197.9 seconds); its assertions pass but the
file fails its deadline. Each source now has its own test, preserving all
75 child controls, every root control, the nine new cap/global/allowlist
controls and the original timeout. The full 27-test file reruns green.
After the final logger repair, the affected factory/dispatch files, all five
source controls, typechecks and build/caps rerun green. The matrix's guards
and inventories remain identical and the final build split checks pass.

- All five typecheck projects pass.
- Scoped ESLint: all 195 changed TS/TSX/MJS files pass after correcting test
  braces/promises; final edited entries/tests/build script rerun green.
  Changed CSS passes Stylelint.
- Changed-file Prettier passes; final documentation/receipt files are formatted
  through the enabled commit hook and checked again.
- Plain knip passes (only its existing vendor/axe configuration hints).
- Duplication: 1,078 files, **0 clones**. Cycles: 511 files, **0 cycles**.
- Localization: 14 tables, 144 manifest strings, 544 source files,
  **0 problems**; exact staged VSIX bytes also pass.
- Generated host API: 300 APIs, 24 importing files, 25 Node built-ins,
  61 theme variables, **0 problems**. Regenerated again after logger wiring.
- Production build: every JavaScript/shared/CSS bundle cap, split,
  host-global and 83-package notices gate passes. No existing cap changes.
- Production ACP packaging/schema check and both SBOMs pass (82 extension
  and 20 ACP dependency versions). Private unsigned fake-only packaging
  passes; it is never published or claimed as product support.
- Actual CI inventory blocks pass: 155 VSIX entries, 36 production ACP
  entries. Six negative controls remove each new child/writer name from
  each real archive listing, receive its named missing-entry failure, retain
  the archive SHA-256, and rerun the actual block green.
- The extracted production archive prints `0.13.0`; both extracted child
  factories load, lint is callable, observations remain, and no Cursor blocker
  is registered. No source initialization or inference is performed.

## Final bytes and preservation

| Artifact                   | Bytes   |
| -------------------------- | ------- |
| `dist/extension.js`        | 612,062 |
| `dist/modelApi.js`         | 479,307 |
| `dist/acp.js`              | 837,894 |
| `dist/webview/main.js`     | 625,148 |
| `dist/uiText.js`           | 45,133  |
| `dist/checkpointStore.js`  | 91,575  |
| `dist/judge.js`            | 52,877  |
| `dist/judgeLint.js`        | 39,301  |
| `dist/judgeHook.js`        | 69,745  |
| `dist/validation.js`       | 41,406  |
| `dist/validationSchema.js` | 22,808  |

The final universal VSIX is **2,382,021 bytes**, **129,221
over** its unchanged 2,252,800-byte cap; the size gate exits **1**. Its
inventory, helper identity and staged localization gates pass. Production
ACP is **1,250,310 bytes**; private fake-only ACP is **1,318,277 bytes**.

**50/52 resolved-merge JS/CSS artifacts are byte-identical after H/GH wiring**,
including extension, Model API, ACP and every browser artifact. Only the
explicit-action judge factory and the required shared validation export
change (parser +126 bytes). A first comparison catches a ten-byte ACP logger
argument change; keeping the redacted logger inside the lazy factory restores
the parent loader and ACP bytes exactly. The factory can accept a future
host's channel adapter directly.

This preservation claim uses the resolved H/GH/M91 merge and prerequisite
repair baseline, not the earlier round-2 tree. Required M91 ancestry changes
that earlier startup code and browser chunk names: of its 47 JS/CSS paths,
9 remain identical, 19 change and 19 old chunk paths disappear. The adjacent
JSON includes both comparisons and every final SHA-256, so those inherited
changes are visible. No claim of original round-2 startup identity is made.

The package-budget failure remains the release blocker. No aggregate quality,
coverage, a11y, hosted matrix, live model or installed-source/OS certification
is claimed; those remain with the lead under the bounded brief.
