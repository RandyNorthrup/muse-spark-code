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

## Lane PR223FIX2 (2026-10-18, this branch `chore/no-standins-fix2`)

One line per thread from the brief:

- `moduleExports.test.mjs:161` (host bundles) — FIXED in `286758307`.
  The bare-Node observation now asserts the refusal IS the missing-`vscode`
  error (code `MODULE_NOT_FOUND`/`ERR_MODULE_NOT_FOUND` plus a headline
  naming `vscode`, measured on all 13 host bundles in `dist/`); any other
  refusal fails the gate instead of passing as an identical observation.
  Measured remainder, answered not fixed: code reached after the `vscode`
  import cannot execute without the host by construction, so post-import
  export parity for these bundles lives in the real Extension Development
  Host (`test/integration`, run over the built product), never in bare Node —
  and never behind a `vscode` stand-in, which the owner's rule forbids.
- `eslint.config.mjs:330` (alias bypass) — FIXED in `b4fe0e9af`. The two
  `Module`-literal selectors are replaced by a local
  `loader/no-loader-interception` rule that tracks the binding imported from
  `node:module` (default, named, namespace and `require` spellings, dotted
  and computed) and keeps flagging the bare `Module` spelling. Drill (all
  planted, all removed after): `Loader._load`, `Loader['_resolveFilename']`,
  `Renamed._load`, `mod.Module._load`, `Module._load` and
  `Needed._resolveFilename` each fail lint; `docs/certification/no-fakes-gate.md`
  records the rule and the drill.
- `modelApiLegalScan.test.ts:83` (unchecked `as`) — FIXED in `801cc1c4b`.
  All three `JSON.parse` results now go through
  `legalScanResultSchema.safeParse` and the tests assert on the validated
  data; no `as` remains, so no PLAN §8 entry is owed. Probe: the sparse
  finding shape the old cast accepted (`category`/`file`/`severity` only)
  fails the schema, so the parse is a real check. 11/11 pass.
- `moduleExports.test.mjs:192` (worker crashes) — FIXED in `286758307`.
  `bootWorkerEntry` requires each worker's own jobless refusal
  (`imageResizeWorker` `{ok:false}`, `pageWorker` `BAD_JOB`,
  `searchWorker` `done`/`ok:false` with a non-empty reason) and rejects a
  crash, a wrong message or a silent exit, so an identical startup crash no
  longer compares as an identical observation. Drills on a staged copy
  (reverted after): crashing `pageWorker.js` fails with `jobless boot
failed ... thread error: drill crash`; a wrong `searchWorker.js` message
  fails with `unexpected jobless answer`; a non-`vscode` `extension.js`
  refusal fails with `refused with undefined: drill boom`. Full gate after
  revert: 90/90 pass.
