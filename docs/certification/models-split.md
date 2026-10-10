# MODELSPLIT: room under the Models panel body's 75 KiB cap

Lane MODELSPLIT, worktree `/home/randy/lanes/MODELSPLIT`, branch
`fix/models-split` from `82d50d5e4` (= origin/main). The models panel body
(`src/webview/models/panel.tsx`, budget 75 KiB in
`scripts/check-bundle-size.mjs`) measured 74.9 KiB on main, leaving no room
for the Roles/Agents UI (77.0 KiB) and credential vault panel (75.8 KiB)
branches. The cap is the owner's: unchanged.

## What changed

- `src/webview/models/DeferredSections.tsx` (new): `DeferredProvidersSection`
  and `DeferredModelsSection` through the shared `deferred()` boundary in
  `src/webview/components/DeferredSurface.tsx` — the same pattern as
  `src/webview/playbook/DeferredPlaybook.tsx`, with the same placeholder
  (`UnavailableSurface`: `role="status"`, `data-deferred-loading`, retry on
  chunk failure). No new strings, no new dependency, no UI change besides
  the transient loading status while a section chunk arrives.
- `src/webview/models/sections.ts`: the registry keeps its ids, titles,
  icons and `reduceSection` folds; only `Component` now points at the
  deferred surfaces. `ProvidersSection`, `ModelsSection` and `Wizard` (all
  still imported directly by the unit tests) load in deferred chunks.
- `scripts/lib/webviewBundles.mjs`: new `MODELS_DEFERRED_BUDGETS` and
  `modelsDeferredBudgetGroups(modelsMeta)`, resolved from the page's own
  `dist/meta/modelsWebview.json` (the chat's group machinery reads the main
  graph, which never contains models-only chunks). Each closure charges the
  sections' shared InlineError/ScanStatus chunk and excludes page startup
  and body files, so nothing is double-counted against the body cap.
- `scripts/check-bundle-size.mjs`: enforces the two new groups.
- Tests: `test/unit/modelsApp.test.tsx` and
  `test/unit/modelsMoneyLifecycle.test.tsx` await the deferred sections
  (and assert the loading placeholder); `test/unit/bundleSize.test.mjs`
  gains red/green boundary cases for both new groups.

## Measurements (production build, `npm run build`, 2026-10-10)

| Artifact                                      | Before (main) | After                   | Budget                                |
| --------------------------------------------- | ------------- | ----------------------- | ------------------------------------- |
| `dist/webview` models body                    | 74.9 KiB      | 38.4 KiB                | 75 KiB (unchanged)                    |
| `dist/webview` models providers section (new) | —             | 27.5 KiB (28,146 bytes) | 31 KiB (measured +15% = 32,367 bytes) |
| `dist/webview` models models section (new)    | —             | 11.4 KiB (11,685 bytes) | 13 KiB (measured +15% = 13,437 bytes) |
| `dist/webview/models.js` + static imports     | 337.3 KiB     | 337.3 KiB               | 500 KiB (unchanged)                   |

Headroom over the body's 75 KiB cap is now ~36.6 KiB, covering both feature
branches (~2.1 + ~0.9 KiB) with room to spare. The new group caps follow the
lane brief exactly (no larger than measured +15%, no 25 KiB rounding).

## Gate-fire proofs (red drills)

1. Section back in the body: `sections.ts` temporarily imported
   `ProvidersSection` statically again. Production `npm run build`
   reported `dist/webview models body: 65.9 KiB` (up from 38.4 KiB) and
   `test/unit/modelsApp.test.tsx` failed with `Unable to find an accessible
element with the role "status"` — the deferred placeholder was gone.
   `sections.ts` restored byte-exact (sha256
   `2e19cc38a34fe6e9d2deb3a4108ab242367d621be07c37517b278ab7621bc462`
   before and after); rebuild green, app suite green.
2. New group caps: `test/unit/bundleSize.test.mjs` mocks each section chunk
   at exactly its cap (gate passes, `ok` line asserted) and at cap + 1 byte
   (gate exits 1 with the `OVER` line). Both cases pass for both groups.

## Verification runs (kubuntu rig, repo-default timeouts)

- `node scripts/check-bundle-size.mjs`: 155 `ok` lines, zero `OVER`/`MISS`.
- `npm run build`: green, including the size gate.
- `npm run typecheck`: green (all projects).
- `npx eslint --max-warnings=0` and `npx prettier --check` on all changed
  files: clean (one `unicorn/no-unreadable-for-of-expression` hit fixed by
  hoisting the group list out of the loop header).
- Vitest (`npx vitest run <files> --maxWorkers=3`): `bundleSize.test.mjs`
  (60 tests), `modelsApp.test.tsx` (2), `modelsSections.test.ts` (3),
  `modelsPanelSections.test.tsx` (19), `modelsMoneyLifecycle.test.tsx` (5),
  `modelsPanelSchemas.test.ts`, `modelsPanel.test.ts`,
  `providerPanelSeam.test.ts`, `modelsPanelEntry.test.ts` — all pass.

## For the lead (outside the Muse sandbox — do NOT launch a browser here)

Visual/browser suites covering the models panel, expected zero changed
pixels (no UI change; sections render identically once chunks arrive):

- `test/integration/` models panel cases (run inside VS Code).
- `test/e2e/` models panel flows through the fake Muse Code CLI.
- Harness screenshots: `npm run harness:shots` models matrix entries in
  `test/harness/visual-matrix.json` / `test/harness/goldens/manifest.json`;
  `npm run check:visual` after regenerating shot lists if chunk names shift
  them (chunk hashes are content-named and not asserted anywhere).
