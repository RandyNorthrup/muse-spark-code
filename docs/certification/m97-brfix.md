# M97 BR review fixes — macmini, 2026-10-05

Scope: all three P1 and twelve P2 findings in RVM97BR. No live/paid model
calls, real registry requests, dependencies or existing gate/cap changes.
The rig brief requires targeted checks here; the lead owns full quality and
installed-host verification on the integrated tree. Integration-owned README,
CHANGELOG, PLAN, ACP guide and m97 certification are left to the lead.

## Runtime report safety (findings 2, 3, 4, 13, 14)

| Finding | Fix                                                                           | Regression / red drill                                                                          |
| ------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2 P1    | Manual registry redirects, each attempted request disclosed once              | `refuses every redirect and discloses exactly the attempted requests`; set redirect to follow   |
| 3 P1    | Central `redactSecrets` before truncating all thrown scanner/writer reasons   | `redacts thrown scanner and writer reasons in reports, stderr and --out`; remove redaction      |
| 4 P2    | Envelope validates the reader's nested target shape                           | `keeps successful registry enrichment in text and JSON reports`; restore flat schema            |
| 13 P2   | Translated disclaimer in JSON envelope, stdout and exports including failures | `includes the disclaimer in JSON stdout and exports, including degraded scans`; omit disclaimer |
| 14 P2   | Convert ratio confidence to the Intl helper's percentage scale                | `renders ratio confidence as 100 and 50 percent`; omit multiplication                           |

`legalRun.test.ts` + `legalRegistry.test.ts`: before fixes and deliberate
mutation run each failed all five named regressions (exit 1); restored run:
42/42 passed (exit 0). Mutations restored byte-exact by SHA-256:

- `src/runtime/legal/runLegal.ts`: `d7d8b79565165eb21d9892cd0ae366ff0345f2f67ef0a21733efdacfb3ccbcd7`
- `src/runtime/legal/legalRegistry.ts`: `605dc9a3838970a3c352fec51b6f28a61a85df54020678eaa9670970ae41ba07`

## Host admission and tool wiring (findings 1, 5, 6, 9, 10, 15)

| Finding | Fix                                                                                               | Regression / red drill                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 P1    | A failed hold or scanner operation never retries unheld                                           | `never scans after trust is lost during hold admission` and `reports the first held scanner failure without a second invocation`; reinstate the old catch fallback |
| 5 P2    | Model-message admission awaits the legal scan and its mode restoration                            | `holds a new model turn until the scan and mode restoration settle`; remove the scan barrier                                                                       |
| 6 P2    | Manager forwards the injected scanner to its production host; activation supplies the lazy runner | `forwards the legal scanner to production host construction`; drop variant forwarding                                                                              |
| 9 P2    | Deterministic scan checks folder/trust independently of sign-in                                   | `scans signed out on museCode/modelApi without starting a backend`; reinstate auth refusal                                                                         |
| 10 P2   | Stop aborts the scanner controller before checking for a session                                  | `Stop aborts the slash scan (live session: false/true)`; remove abort                                                                                              |
| 15 P2   | Muse Code adapter rechecks the live trust offer after its scan                                    | `refuses evidence after trust is revoked during the scan`; remove post-scan offer check                                                                            |

Finding 3 also covers the slash report's failure notice: central redaction before
posting. `redacts scanner failures before showing a panel report` fails when
redaction is removed.

`conversationController.test.ts`, `legalScanTool.test.ts`,
`modelApiBackendManager.test.ts`: original regression run failed nine tests;
all fixes plus the extra redaction assertion pass **538/538**. The deliberate
host mutation run failed all ten named assertions (exit 1). All three mutated
files restored byte-exact by SHA-256:

- `src/host/conversation/conversationController.ts`: `6915b14d8388c2874c4864335adc5a8dbcdba54c56a29aeb70d8f5e6a24ce55f`
- `src/host/backend/modelApiBackendManager.ts`: `49c5cd0602a4a22044ccb6c8e251aafdcf7613e5fe31f36b4f32597556682039`
- `src/host/ide/legalScanTool.ts`: `cbbd3d9e8ab9a7ca374b993444107d35a51ecf511a762c393c4002dd69c4aa6c`

## Shared bundle, slash routing and skill updates (findings 7, 8, 9, 11, 12)

| Finding | Fix                                                                                                                                                                | Regression / red drill                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7 P2    | Emit one `legalScan.js` beside extension and ACP; inventories require it; scanner and data attribution/provenance ship; new 150 KiB cap                            | `emits and packages the scanner in both distributions with a named size cap` and `emits the legal scanner once and keeps it out of both initial bundles`; remove production emission                              |
| 8 P2    | Both loaders use `src/shared/legalScanEntry.ts`: `runLegalScan({ workspaceRoot, input, signal })` returns `{ result, registryTargets }`; host review owns the hold | `builds the real entry with production options and scans through BOTH loaders`; return a bare result                                                                                                              |
| 9 P2    | Composer routes `/legal` before auth on both backends; free scan stays available signed out                                                                        | `routes signed-out /legal on museCode/modelApi without a model message`; remove signed-out command admission                                                                                                      |
| 11 P2   | Recognize reserved command independently of argument validity; invalid options/overlong paths raise translated usage and never post a model message                | `refuses malformed syntax without posting a model message` (three cases); make the invalid branch fall through                                                                                                    |
| 12 P2   | Recognize extension id across version directories, repoint during update, remove old/dangling links during uninstall; preserve user/other-extension links          | `repoints legal links across extension versions and removes stale-version links` and `removes a dangling legal link from a prior extension version without a marked copy`; disable extension identity recognition |

`App.test.tsx` + `bundledSkillsInstall.test.ts` originally failed six added
regressions. With the real-entry loader tests and dangling-link check,
`legalScanBundle.test.ts` + those two files pass **178/178**, including npm and
PyPI enrichment targets. Deliberate mutations fail all nine targeted assertions
(exit 1), then the complete three-file restored run passes **178/178** (exit 0).
Mutated sources restored byte-exact by SHA-256:

- `src/webview/App.tsx`: `97e9c5ddbfd37bf680fd5641a870118dce2dc1f4ef25a8921b5ab4a248a03b72`
- `src/webview/state/uiState.ts`: `252b27cf43ce1d7d953b8137d9e5cc398e7dbb260a3f69944fa1ba0515b10eb6`
- `src/host/skills/bundledSkillsInstall.ts`: `25050e2e2b2d32603e45d68f1016c82585ee8d722122877bece847a627691834`
- `src/core/legal/entry.ts`: `c688ad1f973cb66edc162179393412ccc8e5c569916ca3070e7df0cdfe7b161c`
- `scripts/build.mjs`: `c7d75a61c6038dcb9695dfe21d03839006d051c19d16391867b4020bc6153a22`

`deferredBundles.test.ts`: **13/13** pass. Its actual cap drill writes a scanner
artifact one byte over 150 KiB, observes the named size gate exit 1, restores
and compares SHA-256, then observes exit 0. Its legal split drill inserts
`src/core/legal/entry.ts` into the activation metafile, observes the named split
refusal, restores byte-exact by SHA-256, then observes exit 0. Loading the
compiled activation module does not require the scanner. Omitting scanner
emission in the production build after removing stale generated artifacts
also fails the real build in suite setup (exit 1, so none of that red run's
13 tests execute); after byte-exact restoration, all 13 execute and pass.
No existing cap, threshold, timeout, ignore or rule was loosened.

## Final admission, production command and package receipts

Finding 5 also covers the reverse race: a model send can be preparing its
autosave or awaiting acknowledgement before `activeTurnId` exists. An in-flight
send counter now refuses scan admission throughout that interval. The added
`refuses a scan while a model send is preparing before its turn acknowledgement`
failed before the fix; deliberately removing the counter check failed it again.
The restored controller suite passes **506/506**. Final controller restoration
SHA-256: `117c296310b434a4e6614d4ff09d0175b26a78674b005cec362b226e3e5764e8`.

The production headless test now invokes the real compiled ACP command in the
legal fixture with network, backend spawning and keyring loading forbidden.
JSON stdout validates, registry admission stays off with zero queries, and the
disclaimer is present. Renaming the scanner entry export deliberately makes
`runs the production headless scanner with pure JSON and no network, backend or keyring`
fail (1 failed, 13 passed); byte-exact restoration of the entry to
`c688ad1f973cb66edc162179393412ccc8e5c569916ca3070e7df0cdfe7b161c`
restores **14/14**. Normal locale diagnostics remain on stderr; the test rejects
the forbidden-surface sentinel and a degraded scanner result.

`npm run package:acp` and `npm run package` succeed locally. Both archives contain
`dist/legalScan.js`, `dist/uiText.js`, and `dist/legal-data/{NOTICE.md,provenance.json}`.
The ACP tarball is **1,081,400 bytes** (31 files). The VSIX is **2,144,379 bytes**
(121 files), under its unchanged **2,252,800-byte** cap. Running the staged ACP
package's real `legal --format json` command in the fixture succeeds with an
honest incomplete-coverage exit **2**, a non-degraded rule version, disclaimer,
zero registry queries, and the same network/backend/keyring prohibitions.
No package was published or installed into a host.

Package drill: temporarily remove the generated scanner artifact;
`node scripts/package-acp.mjs` exits **1** with the named
`dist/legalScan.js is missing` refusal before touching the package stage.
Restored artifact SHA-256:
`d8426198a8ab1b42b5dac5286aeb8421cbf0f0625d2330e4f5531cf79698f6a3`.

The scanner is also included in the existing host-global inventory.
`fires the legal scanner host-global guard and restores the artifact byte-exact`
injects a forbidden `navigator` reference, observes the named gate exit **1**,
then restores the artifact by SHA-256 and observes exit **0**. Deliberately
omitting the scanner from that inventory makes this test fail (1 failed,
14 passed); restoring the script byte-exact returns **15/15** passing tests.
Restored script SHA-256:
`6ae88204ad38f30e61de9880c35344d7da33c837a8d5aa0bb8fac4338a9b677e`.

Final distinct targeted suites: **19 files, 1,602 tests passed**, all on macmini,
at most three files per invocation with `--maxWorkers=3 --testTimeout=120000`:

| Files (all under `test/unit/`)                                | Passed |
| ------------------------------------------------------------- | -----: |
| conversationController, legalScanTool, modelApiBackendManager |    539 |
| legalScanBundle, App, bundledSkillsInstall                    |    178 |
| deferredBundles                                               |     15 |
| legalRun, legalRegistry, legalArgs                            |     53 |
| legalCommand, uiState, modelApiLegalScan                      |    156 |
| modelApiHost, acpRuntime, execArgs                            |    641 |
| legalScan, legalWorkspace, legalGuards                        |     20 |

Production size, split, host-global and notices gates pass. Measured KiB/cap:
extension **564.8/600**, Model API **430.4/475**, scanner **128.8/150**,
ACP **797.1/850**, webview **877.5/900**, English fallback **108.5/125**,
checkpoint store **109.1/225**. The new scanner cap applies the existing
15%-headroom/25-KiB-rounding rule; no existing cap changes.
All five TypeScript projects pass. Changed-file ESLint and Prettier,
localization, host-API record and cycle checks pass. No live wire changes,
real registry calls, paid dispatches, credential reads or model attempts (**0**).

## Integration gate deferrals (outside B/R ownership)

- **M97-GATE-TYPES:** `npm run deadcode` exits 1 on three unused exported
  types in `src/shared/legalFix.ts`: `LegalFixEvidence`, `LegalFixFileHash`,
  `LegalFixScanMeta`. They belong to lane W and are byte-identical to integration
  base `737fc369`. They add no runtime authority or credential handling; the
  lead must remove unused exports or use them meaningfully before full quality.
- **M97-GATE-CLONES:** `npx jscpd` exits 1 on twelve existing clones: the
  shared legal/legal-fix schema and `legalFix.test.ts`, `legalReport.test.tsx`,
  `reviewUi.test.tsx`. All five source/test files are byte-identical to
  `737fc369`; no clone touches this lane's edits. Duplicated schema/test text
  changes no runtime permissions; the lead must consolidate it without changing
  assertions or the zero-duplication threshold before full quality.

These are recorded integration gate blockers, not accepted release waivers.
All fifteen RVM97BR findings are fixed; no review finding remains as a residual.

### PLAN §7 lines

M97 BR fixes: targeted regressions, red drills and local checks are recorded in
`docs/certification/m97-brfix.md`. Full quality remains blocked on unchanged
lane-W gate debt M97-GATE-TYPES and M97-GATE-CLONES; lead cleans it on the
integrated tree before merging/releasing. No gate is weakened or bypassed.

### PLAN §9 lines

- M97-GATE-TYPES: three unused legal-fix exported types at base `737fc369`;
  runtime behavior and security boundaries are unaffected. Lead removes/uses
  the exports before integrated full quality; no release waiver.
- M97-GATE-CLONES: twelve existing legal-fix/report schema/test clones at base
  `737fc369`; no new authority or credential exposure. Lead consolidates them
  without weakening assertions or thresholds before integrated full quality;
  no release waiver.
