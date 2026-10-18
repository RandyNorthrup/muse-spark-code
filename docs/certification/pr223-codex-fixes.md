# PR223FIX — Codex threads on PR #223 (lane record, 2026-10-17)

Branch `chore/no-standins-fix`, continuing PR #223 at `5fc396a23`.
Each Codex thread fixed at its cause: drive the real code, or delete the
test and withdraw the claim it supported.

## Planned fixes (one line per thread)

- `test/unit/modelApiLegalScan.test.ts:29` — drop the hand-written
  `LegalScanRunner`/`countingSnapshot(PROJECT)`; drive
  `runLegalScanCall` through the production `runLegalScan`
  (`src/core/legal/entry.ts`, the shipped `legalScan.js` entry) against
  the committed on-disk `test/fixtures/legal/clean` workspace, with
  refusal cases proving non-invocation through an unsatisfiable root.
- `test/packaging/moduleExports.test.mjs:141` — remove the
  `Module._load` trap, the `vscode` Proxy and both `eslint-disable`
  suppressions; files bare Node rejects compare as identical
  import failures instead of faked successes; withdraw the PLAN §8 row.
- `docs/real-life/unproven.md:2873` — fix
  `infra/marketplace-hook/README.md:53-54`: withdraw the deleted
  test's claim, point operators at `docs/certification/badge017.md`.

## Results

Pending.
