# Two bundles back within budget on the features tree — bundlefit0190

Lane BUNDLEFIT, rig macmini, worktree `/Users/randy/lanes/BUNDLEFIT`.
Branch `fix/0190-bundle-fit`, on the features tree
(`1d967f741` + FULLTEST3 carries, HEAD `177ecfa95` at lane start).
Date: 2026-10-18/19.

## Before (production build, repo budgets)

Built with a local-only trim of the 0.19.0 notes (the What's New bound
stops the build on the real tree — join state the main join owns; the
trim was restored byte-identical, sha256
`68823e19382c5c53584d0f5f4856b2c3ff5394b0dae71e8e737dd4bf5edd8a15`,
and is never committed):

| bundle                  | before    | budget  | after     | budget  |
| ----------------------- | --------- | ------- | --------- | ------- |
| dist/modelApi.js        | 572.3 KiB | 525 KiB | 514.9 KiB | 525 KiB |
| dist/productionAudio.js | 141.2 KiB | 75 KiB  | 66.8 KiB  | 75 KiB  |
| dist/extension.js       | 559.7 KiB | 600 KiB | 477.5 KiB | 600 KiB |
| dist/productionMedia.js | 78.3 KiB  | 100 KiB | 78.3 KiB  | 100 KiB |
| dist/runtimeEngine.js   | 739.6 KiB | 875 KiB | 668.8 KiB | 875 KiB |

No budget moved; no feature cut. Full `check-bundle-size` after: 175
ok lines, zero OVER/MISS.

## Root cause

The deferred-cohort filter in `scripts/lib/deferredBundles.mjs`
already named `productionMediaEntry`, but `DEFERRED_OUTFILES` had no
row for it — so the first-use dynamic imports in `src/extension.ts`
(×2), `src/host/backend/modelApiEntry.ts`,
`src/host/backend/productionAudioEntry.ts` and `src/runtime/backends.ts`
(×2) inlined the whole production-media closure (session uploads, the
replay, estimator seeds, codec, upload ledger + storage, the conversion
lease) into activation, modelApi.js, productionAudio.js and
runtimeEngine.js. The media closure's own modules only ever entered
those bundles through that entry (every other importer is `import
type`); nothing else rode along that should not have.

The same missing row owned the split gate's 54 problems (the media
files ×2 bundles, four backend files dragged in behind them, and the
MODEL_API_MODEL_TEXT keys in extension/productionAudio/runtimeEngine)
and the lazy-registry mismatch (`requestedBy: []` built vs the
generated row). The generated registry file at HEAD already described
the intended loaders, so no generated diff was needed.

## Cut 1 (the only cut; commit `d60b6ffbe`)

One `DEFERRED_OUTFILES` row (PLAN.md D6/D85.13 deferred-entry
pattern):

```js
[path.resolve('src/host/backend/productionMediaEntry.ts'), 'dist/productionMedia.js'],
```

Effect, measured after rebuild: modelApi −57.4, productionAudio −74.4,
extension −82.2, runtimeEngine −70.8 KiB; productionMedia unchanged.
Split gate 54 problems → exit 0; `gen-lazy-registry --check` exit 0
with no file change (build agrees with the committed row again). No
new eager import, no cycle (`npm run cycles` exit 0, 2277 files). Both
over-budget bundles are within budget, so no further cut was owed.

## Behaviour identical

Suites driving the moved closure, repo timeout, `--maxWorkers=3`:

- modelsActivationBudget + lazyBundleFiles + acpMediaPort: 30/30
  (activation growth −66787, allowance 3072)
- mediaCalibration + privateRootLease + transcribeBatchHttp: 37 passed,
  1 skipped (the skip is the file's own `skipIf(darwin)` guard)
- uploadLedgerTwoProcess + uploadLedgerStaleIntent + voiceBatchSeams:
  13/13
- workspaceMediaSource + mediaBudget: 18/18

Real use through the packed output (throwaway probe, since removed):
required the real `dist/productionAudio.js` and
`dist/productionMedia.js`, drove `privateRootFor` → `openLeased`
through the now-externalized `import("./productionMedia.js")` to a
real leased root (`{path, identity, owner, lease}`), required the real
`dist/modelApi.js` (`createModelApiHost` present, media import lazy),
and confirmed activation references `./productionMedia.js` lazily.
PROBE PASS.

## Gates on the final tree

- `npm run build` (trimmed tree): exit 0 — tokens, esbuild,
  check-bundle-size, check-bundle-split, lazy-registry --check,
  host-globals, notices all green.
- Full `npm run build` on the real tree stops at the What's New bound
  (0.19.0 notes ~148 KB vs 76800; 9 Highlights vs 5) — join state the
  main join trims, as in fulltest0190c.md.
- prettier on the changed file: exit 0. eslint on the changed file:
  exit 0, zero warnings (the commit's pre-commit hook also passed).
- `npm run typecheck` (all five projects): exit 0.
- `npm run cycles`: exit 0. `npm run deadcode` (knip): exit 0.
- `npm run check:host-api`: exit 0 (0 problems).
- `node scripts/check-l10n.mjs`: 0 problems.
- `npm run check:reference`: current.
- `npm run security:audit`: exit 0 (2 advisories, 1 exception file).
- Duplication gate: exit 1 with the same 3 clones on the untouched
  base `177ecfa95` (measured in a scratch worktree, since removed):
  fixPreviews/legalScanEntry and self-clones in treesLifecycleNative
  and uploadLedgerTwoProcess from the carried commits — pre-existing
  join state, untouched by this lane (one `.mjs` line, outside jscpd's
  pattern).
- `npm run check:plan`: exit 1, PLAN.md 3588891 bytes vs 3565158 —
  over at the join already (fulltest0190c.md), archive procedure is
  main-join scope; this lane adds no PLAN.md content.
- SAST: NOT RUN — semgrep's binary crashes in this sandbox
  (`ca-certs: empty trust anchors`, exit 2) before scanning; no
  workaround built per the sandbox rule. The lead runs it outside.

## Commits

- `d60b6ffbe` the cut (1 line, `scripts/lib/deferredBundles.mjs`).
- This file, `docs/certification/bundlefit0190.md`, the before/after record.
