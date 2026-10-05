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
