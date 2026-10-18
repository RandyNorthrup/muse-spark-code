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

- `modelApiLegalScan.test.ts:29` — FIXED in `2791c8363`. The suite drives
  `runLegalScanCall` through production `runLegalScan`
  (`src/core/legal/entry.ts`) over `test/fixtures/legal/clean` (plus a
  `required`-policy case over `test/fixtures/legal/tree`); refusal cases
  prove non-invocation through a missing root. Gate-fire drills on entry:
  dropped paths → 1 failure, dropped policy → 1 failure, wrong root →
  3 failures; all reverted. `m97-b.md` and `unproven.md` updated.
- `moduleExports.test.mjs:141` — FIXED in `889d1536d`. Trap, Proxy and
  both suppressions deleted; VS Code-bound bundles compare as identical
  `MODULE_NOT_FOUND 'vscode'` refusals, worker entries boot as real
  jobless threads (`BAD_JOB` / protocol refusals), libraries keep export
  and call parity. PLAN §8 row withdrawn; gate comments updated.
  Drills: corrupted packaged `tab.js` / `pageWorker.js` fail exactly
  their test; planted `Module._load` still fails the gate.
- `unproven.md:2873` — FIXED in `2e7a77f7c`.
  `infra/marketplace-hook/README.md` withdraws the deleted test's claim
  and points at `docs/certification/badge017.md`.

Final gates on the final tree (repo timeout throughout, never raised):
`test/unit/modelApiLegalScan.test.ts` 11/11 pass; packaging parity
90/90 pass; `npx eslint --max-warnings=0 test/` exit 0;
`npm run typecheck` exit 0; `npm run build` exit 0; prettier clean on
every changed file.
