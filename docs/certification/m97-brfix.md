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
