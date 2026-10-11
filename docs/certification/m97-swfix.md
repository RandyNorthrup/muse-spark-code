# M97 scanner/report repair — FIXM97SW

**FIXM97SW2 source repairs committed on 2026-10-05.** The owner explicitly requested verification
and commits of the preserved implementation. The SW2 receipts below supersede
the original uncommitted handoff; the original run's failures remain history.

The original lane stopped after a gate wrapper lost filename arguments and
invoked the full Vitest suite, contrary to `common.md`. Its wrapper and owned
remaining process were terminated after command/CWD ownership checks. The
original run made no commit, production push, merge, gate bypass or
machine-setting change. SW2 uses validated nonempty file lists, at most three
files and `--maxWorkers=3` per run, and serialized rig jobs.

The original handoff contained unverified cleanup after its last passing
snapshot. The finding table identifies the preserved fixes and original
drills; current-tree verification and residuals are recorded under SW2 below.

Base: `737fc369cf99853451f7f2bdc7e8e2aef63517e1`, branch `m97/swfix`.
Scope: all 20 findings in `RVM97SW.report.md`, dated 2026-10-05.
The lane brief and `common.md` are authoritative. No new dependency, paid
call, production push, gate suppression, threshold or timeout change.
The lead owns README, CHANGELOG, PLAN and the milestone integration record.

## Finding coverage

`S` means `test/unit/legalSwRegression.test.ts`; `H` means
`test/unit/legalFixSecurity.test.ts`; `U` means
`test/unit/legalReport.test.tsx`. Finding numbers below match the review.

| Finding | Repair                                                                                                                                                                                                                                     | Regression                                                                                | Drill                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| 1 P1    | A final envelope scrub visits every string, including scope and evidence-file paths.                                                                                                                                                       | S: F1 recursive result walk                                                               | S baseline restoration             |
| 2 P1    | Host scan identity, workspace and versions select authoritative findings; exact byte hashes cover every read evidence file, LICENSE and NOTICE included. Vendor paths are never eligible. Old bytes cannot acquire a new preview baseline. | H: F2 forged identity, vendor, source-before-preview, source/LICENSE/NOTICE-after-preview | Host authority/hash guards         |
| 3 P1    | One generation invalidates previews on disposal, mode changes and observed trust/workspace changes. Live getters refresh state after reads. The applier receives the generation guard to check before each write.                          | H: F3 pending preview and confirm, dispose/mode/trust/workspace                           | Host generation guard              |
| 4 P2    | Confirm claims the preview synchronously, before any await; Apply disables after confirmation.                                                                                                                                             | H: F4 concurrent confirms; U: F4 duplicate clicks                                         | Host claim and report Apply guards |
| 5 P2    | Preparation returns bounded exact diffs, restricted to selected paths. The report renders them; confirm passes the stored, cloned diffs to the applier. A writer without preparation cannot apply.                                         | H: F5 exact patch and missing preparation; existing U preview test                        | Stored patch dispatch guard        |
| 6 P2    | Selection/separate-consent changes invalidate the visible preview; a new request clears old state and correlated replies reject out-of-order results.                                                                                      | U: F6 pending/out-of-order preview                                                        | Report/state baseline restoration  |
| 7 P2    | Legal report has modal priority; handoff waits until it closes.                                                                                                                                                                            | U: F7 one modal owner                                                                     | App baseline restoration           |
| 8 P2    | Closing the report requests composer focus.                                                                                                                                                                                                | U: F8 focus return                                                                        | State baseline restoration         |
| 9 P2    | Report shows package/version, license expression, scope, distribution and generated exclusions. Existing wrapping styles cover these fields and patches.                                                                                   | U: F9 structured evidence                                                                 | Report baseline restoration        |
| 10 P2   | Only notices present in the shipped-file set satisfy packaged attribution.                                                                                                                                                                 | S: F10 excluded root notices                                                              | S baseline restoration             |
| 11 P2   | Shipped evidence keys package/version/location; installed material is associated with the exact version rather than the package name.                                                                                                      | S: F11 bundled version                                                                    | S baseline restoration             |
| 12 P2   | WITH stays attached to its expression term, AND keeps mandatory branches, OR retains clean choices, mixed copyleft alternatives stay classified, and deprecated GPL families remain recognized.                                            | S: F12 four expression cases                                                              | S baseline restoration             |
| 13 P2   | npm, Composer and gems associate installed metadata with exact versions; Composer preserves the lock as source when it supplies the license.                                                                                               | S: F13 npm/Composer/gems                                                                  | S baseline restoration             |
| 14 P2   | Legacy Poetry direct dependencies are read without a lock; the Python runtime constraint is excluded. Unresolved constraints remain unknown.                                                                                               | S: F14 Poetry                                                                             | S baseline restoration             |
| 15 P2   | Static TOML strips comments outside quoted strings, preserving hashes and Unicode inside strings.                                                                                                                                          | S: F15 comments                                                                           | S baseline restoration             |
| 16 P2   | An actual initial license title precedes incidental mentions in the license body.                                                                                                                                                          | S: F16 GPL title                                                                          | S baseline restoration             |
| 17 P2   | Every copyright/SPDX line is checked; conflicting declarations are visible even without a project license.                                                                                                                                 | S: F17 holders and SPDX cases                                                             | S baseline restoration             |
| 18 P2   | A malformed asset sidecar cannot establish provenance.                                                                                                                                                                                     | S: F18 asset sidecar                                                                      | S baseline restoration             |
| 19 P2   | `bin` does not imply generation; markers must occur in comment lines, so ordinary source strings do not exempt headers.                                                                                                                    | S: F19 ordinary source                                                                    | S baseline restoration             |
| 20 P2   | Controller fixture uses native workspace-relative paths. Routing test establishes a host scan baseline before requesting a preview.                                                                                                        | conversationController: selected-fix handoff                                              | Windows fixture guard              |

## Original verification receipts

- Mac mini, baseline scanner snapshot `e98a72d3`: 16 new tests, 15 failed,
  exit 1. F11's initial installed-only fixture was insufficient; it was
  corrected to contain both locked versions before its guard drill.
- Mac mini, focused green snapshot `1614002f`: 10 files, 165 tests passed,
  exit 0. The unchanged 5,000 ms capped-scan test passed in 1,090 ms.
- First typecheck snapshot raced formatting and was invalid; it is not
  counted as a code diagnostic or passing receipt. Fresh snapshot
  `6eb36837` passed host and webview, then found the pre-existing optional
  `LegalSetupOptions` type defect and two missing Logger `trace` fixtures
  in `legalScanTool.test.ts`. The owned controller type was corrected;
  the tool fixtures belong to FIXM97BR.
- Mac mini, current guard/native/UI snapshot `2a835875`: 5 files, 63 tests
  passed, exit 0, including the BOM byte-hash and unchanged scanner-capability
  guard.
- Mac mini, deliberate red snapshot `07f3ba70`: 3 complete files, 50 tests,
  35 failed and 15 passed, exit 1. All 17 scanner regression cases failed;
  host authority, three changed-evidence cases, pre-preview source changes,
  vendor refusal, disposed preview/confirm, concurrent confirm and exact-patch
  dispatch failed as intended. All five new UI regressions failed. Three old
  UI contract assertions also failed because the original App omitted new ids.
  This is a batch guard drill, not a claim that every independent mutation was
  isolated. The saved 17-file byte manifest was restored and each SHA-256
  independently compared, exit 0 (`BYTE_EXACT_RESTORED 17 files`).
- Windows snapshots `04f18b94` and `d2615e5f` are superseded for F20:
  the new routing fixture initially supplied a scanner without its required
  Plan-hold factory, so no authoritative scan existed. That fixture defect was
  corrected, with an explicit scan-report assertion before requesting fixes.
  The first path-mutation failure therefore is not counted as path-guard proof.
  The latter full run also established two existing native symlink fixtures
  cannot run under this VM account (`EPERM`); their gate remains open rather
  than skipped or weakened.
- Windows valid F20 red snapshot `177b7d09`: 497 tests, exactly the routing
  test failed; its scan-report precondition passed. Original POSIX-only path
  fixture was restored byte-exact, exit 0.
- Windows restored snapshot `8cd23742`: controller, legalFix, legalFixSecurity
  and legalReport complete files, 557 tests passed, exit 0. A later lifecycle
  caller correction is covered by the final Mac receipt below; it has not been
  repeated on Windows.
- Mac red snapshot `e2446a48`: three complete files, 526 tests, 19 failed and
  507 passed, exit 1. All 17 scanner cases failed, the BOM-hash test failed
  because the baseline scanner omitted evidence hashes, and the fresh-scan
  after-session-drop test failed when dropSession permanently disposed its
  preview store. The byte-hash mutation was not isolated from the missing
  metadata, so this does not claim isolated crypto-guard proof. All 19 saved
  files were restored byte-exact, with per-file SHA-256 comparisons, exit 0.
- Mac restored snapshot `9ac2de10`: all 24 owning files, 761 tests passed,
  exit 0. The unchanged capped-scan test completed in 3,005 ms.
- Gate snapshot `c88fec94`: host/webview/e2e/integration types, localization
  (14 tables, 124 manifest strings, 456 source files, zero problems), and
  production build/split/globals/notices passed. Unit types failed on the two
  existing missing Logger.trace mocks in legalScanTool.test.ts. Deadcode
  found three unused shared legalFix type aliases. Duplication found 16 clones.
  Host API inventory was stale (builtin counts crypto 32→33, fs 24→25,
  path 66→68). Lint had two owned errors plus fixture parser errors caused
  by the accidentally broad invocation.
- That gate wrapper incorrectly serialized extra file arguments as additional
  tuple elements. Its runner consumed only the first two elements, so both
  lint and Vitest lost their explicit filename arguments. The full test run
  began before the stopper reached the rig; its output is not certification.
  The gate runner exited 143 after termination; the remaining owned test
  process was terminated by exact private-worktree CWD. No a11y or screenshot
  command in that wrapper was reached. Do not reuse this wrapper: serialize
  `{ command, args: [...] }` objects and validate nonempty explicit file lists
  before spawning ESLint or Vitest.
- Late cleanup inverted the gems tail guard, moved the host generation check
  before snapshot construction, removed the unused aliases, derived snapshot
  metadata from the strict result schema, shared the sidecar guard and reused
  test preview/boot fixtures. It also corrected the preview harness to select
  the header that has a real patch. These edits need fresh types, scoped lint,
  duplication, all owning tests, build and browser receipts before any commit.

Measured build sizes on `c88fec94` (not the final uncommitted tree): extension
567.3/600 KiB; Model API 430.6/475 KiB; checkpoint store 109.1/225 KiB;
shared English 108.4/125 KiB; webview 878.9/900 KiB. All existing caps passed.

## Original residuals and integration handoff

All 20 review findings have implementation changes and named regression
coverage. Final verification is incomplete. Named residuals:

- **SW-R1 — lane hard stop / current-tree proof:** no commit or final green
  claim is allowed. Safe state: worktree preserved, drill mutations restored,
  owned jobs stopped, gates not weakened. Follow-up: lead reviews the saved
  diff and resumes with a correctly validated rig wrapper.
- **SW-R2 — types:** legalScanTool.test.ts has two missing Logger.trace mocks,
  owned by FIXM97BR. Runtime types passed on the recorded snapshot. Follow-up:
  backend lane fixes its mocks and full unit typecheck runs again.
- **SW-R3 — duplication/dead code/lint:** last observed gates were red.
  Late owned corrections are unverified; remaining clones must be collected
  and repaired without ignores or threshold changes. Follow-up: fresh scoped
  lint, knip, jscpd and all owning tests.
- **SW-R4 — host API inventory:** generated record does not match source
  builtin counts. It is not an admission relaxation; source behavior is
  unaffected. Follow-up: lead regenerates and reviews the inventory in its
  serialized documentation lane.
- **SW-R5 — native/browser/installed proof:** Windows link fixtures hit EPERM;
  no new real-browser, pseudo-locale, zoom, four-theme or installed-host proof
  was obtained. Safe state: no certification claimed. Follow-up: eligible
  native rig account and existing strict browser/installed gates.
- **SW-R6 — integration:** required release-candidate ref is missing and the
  unrelated main merge attempt was aborted. Follow-up: lead supplies the
  intended ref and serializes integration under reserved-doc ownership.

Production selected editing
remains unavailable until the backend lane supplies the exact-patch
preparer/applier through normal permission-mode approval. This lane fails
closed without it and does not claim an installed writer receipt.

Evidence revalidation is conservative: all readable scan evidence is guarded.
A file beyond the existing fix-read cap, a missing native byte hash,
an evidence set beyond the existing preview bound, or a scrubbed path that
cannot be mapped back safely refuses fixes. The deterministic report stays
available. No existing bound was raised.

The native snapshot hashes the exact admitted bytes before UTF-8 decoding;
in-memory fixture snapshots hash their UTF-8 text. This preserves a BOM's
byte identity without changing reader decoding behavior.

`integrate/m72-on-24ff` is absent from this clone. `origin/main` is not an
ancestor of the M97 base and spans 619 files. The requested merge attempt
refused because owned files were dirty; no merge state was created. The
lane's strict file ownership and reserved shared docs prevent treating that
unrelated tree as a silently substituted release candidate. Lead must supply
the intended candidate/ref and serialize integration.

## Original handoff binding

The private logs and exact drill manifests are in
`temp/m97-swfix-drill/` in this worktree; they are ignored, not product files.
At that original handoff, HEAD remained
`737fc369cf99853451f7f2bdc7e8e2aef63517e1` and no paths were staged.
Final cleanup audit reported `OWNED_REMAINDERS 0`; the 29-file source
manifest independently matched the worktree (`HANDOFF_SOURCE_SHA256_MATCH
29 files`). `git diff --check` passed. There are 30 changed/untracked paths,
including this record.

## PLAN §9 lines

- M97 FIXM97SW: selected fixes are authorized from the host's identified scan,
  workspace, rule/data versions and exact evidence byte hashes, including
  LICENSE/NOTICE. Browser findings have no authority. Vendor/dependency paths
  remain unfixable. Disposal/mode changes and live trust/workspace mismatches
  invalidate generation; confirm is single-use and exact patches are reviewed
  before authorization. The backend applier must check the supplied guard
  immediately before every write and retain its normal approval boundary.
- M97 FIXM97SW: larger/unknown/changed evidence fails closed under unchanged
  read and preview bounds. Missing preparation refuses writes. Full integrated
  quality, Windows native races and installed-host certification remain lead
  gates; lane receipts do not replace them.

## README / CHANGELOG handoff

Describe the deterministic report as evidence with explicit limitations,
not a legal certificate. The report now displays package coordinates,
license expressions, scope, distribution assumptions and exclusions. Mention
host-owned evidence binding, single-use previews, exact reviewed diffs,
out-of-order reply refusal and focus return. Do not claim production selected
editing until an installed exact-patch applier has been proved.

## SW2 verification — 2026-10-05

All 20 review findings have fixes and passing owning regressions. This is S/W
repair evidence, not whole-M97, installed-host or release certification. The
owner's FIXM97SW2 instruction superseded the previous lane's hard stop and
authorized verification and commits. No reserved README/CHANGELOG/PLAN/M97
integration document was edited; their update text remains above for lane I.

Readiness review: the preserved implementation matched the requested 20
findings and existing D76 design. Existing scanner, host preview store, report,
state reducer, harness and test fixtures were reused. No dependency, product
abstraction, gate suppression, coverage threshold or timeout was added or
changed. The canonical PLAN remains unchanged under its reserved ownership;
no parallel ledger or plan-format migration was introduced.

SW2 corrected the unverified cleanup: damaged copyright/en-dash patterns,
the sidecar validator's missing type predicate, remaining duplicated schemas
and fixtures, and unsafe typing in new per-write test mocks. Windows fixtures
use real directory junctions instead of privileged file/directory symlinks;
POSIX retains its file and directory symlinks. Neither platform skips a guard.
Two further variants of findings 11 and 18 were proved failing and fixed:
nested installed material cannot mark its parent package shipped, and every
SPDX declaration in an asset sidecar must parse. Prepared patches also have
negative fixtures for outside-selection paths, empty diffs and oversized diffs.

### Current finding mapping

`S`, `H`, `U` are the suites named above; `C` is the complete
`test/unit/conversationController.test.ts`; `N` is the complete
`test/unit/legalWorkspace.test.ts`. D1–D4 are the fresh drills below.

| Finding | Status | Main source                                                                        | Regression                    | Fresh drill                |
| ------- | ------ | ---------------------------------------------------------------------------------- | ----------------------------- | -------------------------- |
| 1       | Fixed  | `src/core/legal/scan.ts:446`                                                       | S F1                          | D1                         |
| 2       | Fixed  | `src/host/legalFix.ts:190`, `src/core/legal/workspace.ts:157`                      | H F2, N BOM                   | D1, D2, D4                 |
| 3       | Fixed  | `src/host/legalFix.ts:127`, `src/host/conversation/conversationController.ts:6153` | H F3, C fresh scan            | D1, D2                     |
| 4       | Fixed  | `src/host/legalFix.ts:284`, `src/webview/components/LegalReport.tsx:424`           | H/U F4                        | D1                         |
| 5       | Fixed  | `src/host/legalFix.ts:225`, `src/shared/legalFix.ts:105`                           | H F5, U exact preview         | D1, D4                     |
| 6       | Fixed  | `src/webview/state/uiState.ts:2674`, `src/webview/components/LegalReport.tsx:243`  | U F6                          | D1                         |
| 7       | Fixed  | `src/webview/App.tsx:2068`                                                         | U F7                          | D1                         |
| 8       | Fixed  | `src/webview/state/uiState.ts:2908`                                                | U F8                          | D1                         |
| 9       | Fixed  | `src/webview/components/LegalReport.tsx:118`                                       | U F9                          | D1                         |
| 10      | Fixed  | `src/core/legal/distribution.ts:291`                                               | S F10                         | D1                         |
| 11      | Fixed  | `src/core/legal/distribution.ts:54`, `src/core/legal/scan.ts:339`                  | S F11, nested material        | D1, D2                     |
| 12      | Fixed  | `src/core/legal/compat.ts:156`, `src/core/legal/spdx.ts:272`                       | S F12                         | D1                         |
| 13      | Fixed  | `src/core/legal/ecosystems/npm.ts:266`, `composer.ts:179`, `gems.ts:283`           | S F13 (three readers)         | D1                         |
| 14      | Fixed  | `src/core/legal/ecosystems/python.ts:181`                                          | S F14                         | D1                         |
| 15      | Fixed  | `src/core/legal/ecosystems/toml.ts:11`                                             | S F15                         | D1                         |
| 16      | Fixed  | `src/core/legal/projectLicense.ts:69`                                              | S F16                         | D1                         |
| 17      | Fixed  | `src/core/legal/headers.ts:446`                                                    | S F17, Unicode dates          | D1; Unicode before-fix red |
| 18      | Fixed  | `src/core/legal/headers.ts:156`                                                    | S F18 (two sidecars)          | D1, D2                     |
| 19      | Fixed  | `src/core/legal/headers.ts:95`                                                     | S F19                         | D1                         |
| 20      | Fixed  | `test/unit/conversationController.test.ts:667`                                     | C native selected-fix routing | D3                         |

### Tests and deliberate failures

All Vitest runs used explicit nonempty filenames, at most three files and
`--maxWorkers=3`; no full suite or test-name filter was used. Jobs were serialized.

- **Mac mini: 24 named owning files, 771 tests passed.** Final batches:
  C/N/S 529 (`fe658974`); H/legalFix/U 67 (`579fb28f`); contract/guards 20
  (`ab80a2c3`); scan/coverage/evidence 42 (`bff44b32`);
  distribution/compat/SPDX 49 (`aff4904f`); npm/composer/gems 15
  (`30704d11`); Python/Cargo/project 23 (`dcd5d1b5`); Go/JVM/NuGet 12
  (`017bc072`); headers 14 in the scanner batch (`c9caed23`). The unchanged
  5,000 ms capped-scan case passed in 1,225 ms on the final scan batch.
- **Windows 11: six owning files, 596 tests passed.** C/N/S 529
  (`f4c33139`), H/legalFix/U 67 (`7ee47c39`). Junction fixtures ran without
  EPERM and were not skipped.
- **D1, Mac mini `808bd137`:** temporarily restore scanner/report guards to
  the M97 base and disable host authority/hash/generation/claim/patch-dispatch
  checks. Three complete suites, 57 tests: **41 failed, 16 passed**, exit 1.
  All 19 non-Unicode scanner cases, 14 host cases and all five new UI cases
  failed as intended; three old request-contract assertions also failed.
  The Unicode case remained green because the M97 base had correct symbols.
  All **16 files restored byte-exact**. Restored S/H/U: 57 passed
  (`d88dfac6`). This is a batch drill, not isolated proof of each mutation.
- **D2, Mac mini `397abe38`:** omit BOM bytes from the native hash, permanently
  dispose previews when dropping a reusable session, admit nested dependency
  material, and validate only the first sidecar SPDX declaration. Three complete
  suites, 529 tests: **four intended failures, 525 passed**, exit 1. The BOM
  failure was isolated from result-metadata removal. All **four files restored
  byte-exact**; restored C/N/S: 529 passed (`fe658974`).
- **D3, Windows 11 `cd2c1c47`:** restore the POSIX-only controller fixture and
  disable both native realpath containment checks. Two complete suites, 509
  tests: **three intended failures, 506 passed**, exit 1. Both selected-fix
  routing tests failed after their scan preconditions passed; the parent-junction
  test actually read escaping `MIT License` bytes. All **two files restored
  byte-exact**; restored C/N/S: 529 passed (`f4c33139`).
- **D4, Mac mini `4f1aa0b5`:** disable scan-id matching, missing-preparation
  refusal, prepared-path membership and prepared-diff validation. Complete H,
  21 tests: **five intended failures, 16 passed**, exit 1. All **one file
  restored byte-exact**; restored H/legalFix/U: 67 passed (`579fb28f`).
- Unicode regression before repair: `111c4cc9`, one intended failure and 42
  passes; restored patterns: `5e4dc148`, 43 passed. Extra F11/F18 variants
  before repair: `eb2fd10d`, two intended failures and 18 passes; corrected
  scanner/header/native batch: `c9caed23`, 45 passed.

Private command logs, runner file-list validation and per-file base64 backups/
SHA-256 restoration manifests are under `temp/m97-swfix-drill/sw2-*`. These
are ignored evidence, not shipped scripts. Restorations independently read each
restored file and compare SHA-256 with its saved bytes. No drill remains active.

### Current integration residuals

- **SW2-R1 — unit typecheck:** only two existing B-owned Logger mocks in
  `test/unit/legalScanTool.test.ts:51` and `:143` lack `trace`. Do not weaken
  types or silently edit the other lane. B must add its mock methods and the
  lead must rerun the full unit typecheck. Runtime S/W owning tests pass;
  that does not make this type gate green.
- **SW2-R2 — required merge:** `integrate/m72-on-24ff` is absent from all
  local refs. Current `origin/main` (`a95f24cf`) does not contain the M97
  base. No replacement ref was supplied. Do not substitute an unrelated
  release tree or rewrite reserved documents. Lead must provide the intended
  candidate and serialize integration.
- **SW2-R3 — packaging and writer:** the current default build passes its
  existing 18 JavaScript caps but produces no `dist/legalScan.js`, while
  `src/extension.ts` and `src/host/ide/legalScanBundle.ts` expect it. R/I must
  finish scanner packaging, its budget/split checks and installed proof.
  Controller still supplies no exact-patch applier; selected production writes
  refuse. B must supply the reviewed exact-patch preparer/applier through normal
  approval and per-write checks. No installed writing receipt is claimed.
- **SW2-R4 — remaining milestone proof:** full aggregate quality, coverage,
  installed-host/backend/ACP checks and complete zoom/geometry/keyboard proof
  remain lead gates. Structural localization green does not certify translated
  scanner narratives; the existing Lane 0/I language handoff remains open.

The earlier lint, dead-code, duplication, stale host inventory and Windows
symlink-privilege blockers were repaired within this lane. Reserved docs must
receive the PLAN §9 and README/CHANGELOG handoff above together with these
current residuals. No owner policy default was changed.

### Final source gates and build

Mac mini snapshot `2faa6e3d`: host, webview, e2e and integration typechecks
exit 0. Unit types exit 2 only on the two B-owned mocks in SW2-R1. Deadcode
passes, jscpd reports zero clones, localization reports 14 tables / 124 manifest
strings / 456 source files / zero problems, and host API reports zero problems.
Production build, all 18 existing caps, split, host globals and bundled notices
exit 0. The outer collector exits 1 because the unit type gate is red; this is
not an aggregate-green receipt.

| Artifact                  |   Bytes | Existing cap (bytes) |
| ------------------------- | ------: | -------------------: |
| `dist/extension.js`       | 581,238 |              614,400 |
| `dist/modelApi.js`        | 441,305 |              486,400 |
| `dist/checkpointStore.js` | 111,731 |              230,400 |
| `dist/uiText.js`          | 110,992 |              128,000 |
| `dist/webview/main.js`    | 901,492 |              921,600 |

The collector independently confirmed `dist/legalScan.js` is absent; SW2-R3
remains open rather than inventing a scanner artifact or cap receipt.

Real Chrome accessibility on the same Mac snapshot: `node scripts/a11y.mjs
legal legal-narrow legal-preview`, then the same command with `--lang=pseudo`.
Each tested three scenarios in four themes: **24 pages total, zero violated or
undecided rules, zero exemptions, zero pages without a result**, both exit 0.
Axe could not measure contrast of 120 obscured/offscreen elements per language;
these passes do not replace the remaining geometry, zoom and installed proof.

### Commit-hook audit

Scanner commit `fa998d468` was created before the missing ignored Husky wrappers
were detected: `.husky/pre-commit` existed and Git pointed to `.husky/_`, but
the `_` directory did not exist. **That commit did not run its hook.** No
`--no-verify` or disabling flag was used. The lane repaired only its own ignored
runtime files, using the installed Husky helper and standard wrapper; no shared
Git configuration, machine setting or user setting was changed.

The exact scanner commit's 16 files subsequently passed the hook-equivalent
ESLint `--max-warnings=0 --fix` and Prettier checks. Gitleaks scanned exactly
`fa998d468^..fa998d468` (24,282 bytes), exit 0, no leaks. This is an explicit
backfill audit, not a retroactive claim that the original hook ran. History is
not rewritten. Subsequent commits use the restored real pre-commit hook.

The private final-source manifest covers all 30 repaired/generated paths,
excluding this changing certification record. It is retained as
`temp/m97-swfix-drill/sw2-final-source-sha256.json` for post-hook comparison.

### Commit binding and final handoff

- `fa998d46837e09fa688d10203346c569f2da7982` — scanner/evidence/reader fixes
  and scanner/native regressions; first-hook gap and backfill disclosed above.
- `75336b6faee21b7b0b154b51d91d09f7a919df7c` — host scan/evidence binding,
  lifecycle/single-use/exact-patch authorization, controller regressions and
  generated host API inventory. Real hook passed ESLint, Prettier and Gitleaks.
- `328252727a47052b1d76b38b98d939e37611216e` — report evidence, correlated
  previews, single modal/focus/Apply behavior and harness cases. Real hook passed
  ESLint, Prettier and Gitleaks. HTML formatting was independently checked.

After all three source commits, every one of the 30 final-source SHA-256 values
still matched the verified candidate. No drill backup remains active; all owned
rig/local jobs returned and `git diff --check` passed. The final source gates
remain bound to these unchanged bytes. The following certificate commit changes
documentation only. No production push was made.

Required merge was attempted explicitly with
`git merge --no-edit integrate/m72-on-24ff`: exit 1, "not something we can
merge". No merge state was created. SW2-R2 remains a supplied-ref/lead-integration
blocker rather than a silently substituted merge.

The requested 75-minute timebox was exceeded while serialized verification and
the missing-hook repair/audit completed. No check was relaxed to shorten it.
Next: lead reviews these commits, resolves SW2-R1/R2/R3, applies the reserved-doc
handoff and runs the remaining whole-milestone gates in SW2-R4. First-commit
hook history remains explicitly disclosed; the backfill does not rewrite it.
