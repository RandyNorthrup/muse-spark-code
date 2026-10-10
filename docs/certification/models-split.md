# MODELSPLIT: room under the Models panel body's 75 KiB cap

Lane MODELSPLIT, worktree `/home/randy/lanes/MODELSPLIT`, branch
`fix/models-split` from `82d50d5e4` (= origin/main). The models panel body
(`src/webview/models/panel.tsx`, budget 75 KiB in
`scripts/check-bundle-size.mjs`) measured 74.9 KiB on main, leaving no room
for the Roles/Agents UI (77.0 KiB) and credential vault panel (75.8 KiB)
branches. The cap is the owner's: unchanged.

Follow-up lane MODELSPLIT2 (2026-10-10) fixes all three findings of review
RVMODELSPLIT (P2 placeholder jump, P2 budget 0 KiB pass, P3 wrong suite
names). No finding left open.

## What changed

- `src/webview/models/DeferredSections.tsx`: `DeferredProvidersSection`
  and `DeferredModelsSection` through the shared `deferred()` boundary in
  `src/webview/components/DeferredSurface.tsx` — the same pattern as
  `src/webview/playbook/DeferredPlaybook.tsx`, with retry on chunk failure
  (the panel error boundary is never the fallback). RVMODELSPLIT P2 fix:
  the loading fallback is no longer the shared overlay placeholder
  (`div.palette.history`, 15 px, later replaced by the section); it is the
  section's own element with its final accessible name (`<section
aria-label aria-busy="true">`), following the `DeferredQuestionUi`
  precedent of a layout-preserving fallback. The loading announcement
  inside it is visually hidden (`role="status"`, `data-deferred-loading`,
  `models-visually-hidden`: absolute, clipped), so the reserve occupies no
  visible box and the slot's section is never overlaid or replaced. No new
  strings (reuses `UI_TEXT.loadingOutput` and the section titles, all read
  at render per D33), no new dependency. A module-scope chunk preload was
  considered and dropped: the repo's `unicorn/no-top-level-side-effects`
  rule forbids it, and it changes no observable behaviour (the wait it
  shortens is invisible). Loading the sections before first paint from
  these files is likewise impossible without stalling the whole panel body
  behind the chunk fetch (its own overlay flash, no nav, no failure
  announcement) — the reserve above is the lane-brief-compliant option.
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
  RVMODELSPLIT P2 fix: an empty group is a `MISS` (gate exits 1), never an
  `ok` 0 KiB line — a missing section chunk, or one statically compiled
  back into the panel body (where the body's own cap has room to hide it),
  now fails the gate. Both groups go through the same branch.
- Tests: `test/unit/modelsApp.test.tsx` and
  `test/unit/modelsMoneyLifecycle.test.tsx` await the deferred sections
  (and assert the loading status, which the hidden fallback keeps);
  `test/unit/modelsDeferredLayout.test.tsx` (new) holds the providers
  chunk and asserts the slot already holds the `<section>` with its final
  name (busy, announcement hidden, no overlay), then commits the same
  section (same tag, slot and name) with the marker gone;
  `test/unit/bundleSize.test.mjs` gains red/green
  boundary cases for both new groups plus the two MISS shapes, and its
  mock metafiles now plant both section chunks (0 bytes) so unrelated
  success paths keep measuring the real gate.

## Measurements (production build, `npm run build`, 2026-10-10, after MODELSPLIT2)

| Artifact                                      | Before (main) | After                   | Budget                                |
| --------------------------------------------- | ------------- | ----------------------- | ------------------------------------- |
| `dist/webview` models body                    | 74.9 KiB      | 38.8 KiB                | 75 KiB (unchanged)                    |
| `dist/webview` models providers section (new) | —             | 27.5 KiB (28,146 bytes) | 31 KiB (measured +15% = 32,367 bytes) |
| `dist/webview` models models section (new)    | —             | 11.4 KiB (11,685 bytes) | 13 KiB (measured +15% = 13,437 bytes) |
| `dist/webview/models.js` + static imports     | 337.3 KiB     | 337.3 KiB               | 500 KiB (unchanged)                   |

Headroom over the body's 75 KiB cap is now ~36.2 KiB, covering both feature
branches (~2.1 + ~0.9 KiB) with room to spare. The new group caps follow the
lane brief exactly (no larger than measured +15%, no 25 KiB rounding). The
body grew 38.4 → 38.8 KiB under MODELSPLIT2 (the reserve fallback JSX).

## Gate-fire proofs (red drills, all restored byte-exact)

1. Reserve back to the overlay: `DeferredSections.tsx` temporarily dropped
   the custom fallbacks (shared overlay placeholder again).
   `test/unit/modelsDeferredLayout.test.tsx` failed — no `<section>` in
   the slot before load (`div.palette` present instead), so the
   before/after identity assertions cannot hold. File restored byte-exact
   (sha256 `d8d89a501b71d031f73d4599c663217e9d9f0654a3cade41befaea6e063957ec`
   before and after); suite green.
2. MISS guard removed: `scripts/check-bundle-size.mjs` temporarily lost the
   empty-group branch. The 4 new MISS tests failed (the other 60 passed —
   the break was surgical); the gate would again log `ok` 0 KiB for a
   missing chunk. File restored byte-exact (sha256
   `cfa16601a6beb2deae807d5cda3ee5c71aac9c2e93e4ca076a003f184b5f4fb7`
   before and after); suite green (64 tests).
3. Section back in the body: `sections.ts` temporarily imported
   `ProvidersSection` statically again. `test/unit/modelsApp.test.tsx`
   failed with `Unable to find an accessible element with the role
"status"` — the deferred placeholder was gone — and the new
   `refuses a models providers section statically compiled into the panel
body` case fails the size gate with the MISS line (previously only the
   app test caught this shape). `sections.ts` restored byte-exact (sha256
   `2e19cc38a34fe6e9d2deb3a4108ab242367d621be07c37517b278ab7621bc462`
   before and after); rebuild green, app suite green.
4. Group one byte over the cap: `test/unit/bundleSize.test.mjs` mocks each
   section chunk at exactly its cap (gate passes, `ok` line asserted) and
   at cap + 1 byte (gate exits 1 with the `OVER` line). Both cases pass for
   both groups.

## Verification runs (kubuntu rig, repo-default timeouts)

- `node scripts/check-bundle-size.mjs`: 155 `ok` lines, zero `OVER`/`MISS`.
- `npm run build`: green, including the size gate.
- `npm run typecheck`: green (all projects).
- `npx eslint --max-warnings=0` and `npx prettier --check` on all changed
  files: clean (one `unicorn/no-unreadable-for-of-expression` hit fixed by
  hoisting the group list out of the loop header; one
  `unicorn/no-top-level-side-effects` hit resolved by dropping the
  module-scope preload; `unicorn/prefer-scoped-selector`,
  `unicorn/consistent-conditional-object-spread`,
  `@typescript-eslint/require-await`/`await-thenable` hits in the new tests
  fixed directly).
- `node scripts/check-l10n.mjs`: 14 UI tables, 14 usage tables, 0 problems.
  No new user-facing string; the hidden fallback reuses
  `UI_TEXT.loadingOutput` read at render.
- Vitest (`npx vitest run <files> --maxWorkers=3`):
  `bundleSize.test.mjs` (64 tests), `modelsDeferredLayout.test.tsx` (1),
  `modelsApp.test.tsx` (2), `modelsSections.test.ts` (3),
  `modelsPanelSections.test.tsx` (19), `modelsMoneyLifecycle.test.tsx` (5),
  `modelsPanelSchemas.test.ts`, `modelsPanel.test.ts`,
  `providerPanelSeam.test.ts`, `modelsPanelEntry.test.ts` — all pass.

## For the lead (outside the Muse sandbox — do NOT launch a browser here)

Corrected per RVMODELSPLIT P3: the previous revision of this file named
`test/integration/` models panel cases and `test/e2e/` models panel flows
through the fake Muse Code CLI. Neither exists (verified 2026-10-10:
no `modelsPanel`, `models-panel` or `ProvidersSection` case in either
directory). The suites that actually cover the models panel:

- Money flows on the harness page (browser, lead-run):
  `node test/e2e/startupMoney.mjs consent-failed consent-held wizard-cancel`
  — three cases, all passing here per the review. Consent still waits for
  the stated cost; a cancelled wizard posts no budget change.
- Settled pixels (browser, lead-run): the harness models scenes in
  `test/harness/index.html` with goldens in
  `test/harness/goldens/manifest.json` — `models`, `models-configure`,
  `models-credential`, `models-errors`, `models-models`, `models-pick`,
  `models-providers`, `models-scanning`, `models-suggestions`,
  `models-table`, `models-table-filtered`, `models-test-cost`,
  `models-undo` — via `npm run harness:shots` / `npm run check:visual`
  (capture waits until `[data-deferred-loading]` is gone, which the hidden
  fallback keeps).
- Box-stability procedure for this lane's fix (browser, lead-run; jsdom
  has no layout, so `test/unit/modelsDeferredLayout.test.tsx` asserts the
  structural guarantee — no in-flow placeholder element — while pixels
  need a real browser): open the harness models scene with the providers
  chunk request held (this build: `dist/webview/chunks/MGMBHPXP.js`;
  content-hashed, re-resolve after any rebuild), record the content slot's
  box from mount until settle, then release. Require: no intermediate
  placeholder box (the old `div.palette.history` was 15 px tall), and the
  committed `<section>` box identical at commit and after settle.

## Deliberately out of scope (sibling sweep notes)

- `src/webview/playbook/DeferredPlaybook.tsx` keeps the shared overlay
  placeholder: a different feature's deliberate pattern, outside this
  lane's files; changing it would widen the diff and break playbook tests.
- No other empty-pass guard shape in this lane's files: both new budget
  groups go through the one fixed loop, and `modelsDeferredBudgetGroups`
  has no other consumer.
