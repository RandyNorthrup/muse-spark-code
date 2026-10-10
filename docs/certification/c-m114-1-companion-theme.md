# C-M114-1 — Design tokens on the companion page

Date: 2026-10-10. Rig: macmini (Mac mini). Worktree lane CM1141, branch
`c/m114-1`, base `82d50d5e4`. Commits: `d1197c672` (implementation) and the
closing commit (tests, browser suite, docs). No model call, no paid/live
call, no new dependency, no install. No user-visible string added
(`node scripts/check-l10n.mjs`: 0 problems); no command, setting or catalogued
feature added (`npm run check:reference`: current).

## Scope

Mount M114 C's theme consumer (`src/webview/bridges/theme/**`, unwired on
main) on the companion (usage) page, with F's appearance and local-font
ports. Native hosts (JCEF, WebView2, SWT) stay with C-M114-2; the node web UI
and TUI stay with C-M114-3. The unauthenticated launch bootstrap keeps its
minimal loader; only the authenticated page is themed.

## What the lane builds

- Webview (`src/webview/usage/companionTheme.ts`, mounted by `usage.tsx` for
  the `http` host bridge only; editor and native hosts keep their own fonts
  and theme): an empty-role `ThemePort` over the four Muse palettes, mode
  from the operating system with live updates until a mode is stored, F's
  `FontPreferencesPort` over one localStorage record feeding
  `fontAppearanceSettings`, and F's `FontTokenPort` over a nonce-carrying
  `<style>` element. Invalid stored data falls back to the OS and the token
  stacks; a refused element or invalid report throws `EPANEL_THEME` and the
  caller renders unthemed on the generated defaults. The consumer import is
  the CSS-free `themeBridge` only, so no stylesheet rides the JavaScript
  chunk into the entry CSS.
- Server (`src/runtime/companion/page.ts` `renderCompanionPage`, adopted by
  `usageCompanionEntry`): the authenticated page with a caller-localized
  `<title>`, `/usage.css`, the static `/theme.css`, the installed
  `/fonts/fonts.css` when present, the nonce on every script, the import map
  and the two embedded tables. Every boundary is validated and throws
  `EPANEL_PAGE`; a broken install missing the sheets throws `EPANEL_ASSET`
  before listening, never a half-asset page.
- Build (`scripts/build.mjs` plugin, `scripts/lib/webviewBundles.mjs`
  `companionThemeCss`): `dist/webview/theme.css` from the four theme sources
  in `themeEntry` order, minified and byte-identical in every build
  (22.3 KiB, 25 KiB cap in `scripts/check-bundle-size.mjs`). Shipped by the
  VSIX (`.vscodeignore`) and the ACP package (`scripts/package-acp.mjs`,
  fixture extended).
- Fonts: the entry serves an installed pack (`fonts.css` plus `*.woff2`
  only) from the user's data folder when `fonts install` published it, with
  version-shape, allowlist and realpath checks; absent otherwise, and the
  page uses the system stack. The VS Code panel is byte-identical in
  behaviour: the new `:root` mappings define previously-unused variables,
  and the palette blocks are inert without `data-ms-theme` (verified by the
  unchanged panel suites and the `usage.css` budget, back at baseline).

## Acceptance (PLAN M114 §9, companion row; axe)

- Companion row: the page mounts `data-ms-theme`, resolves `--ms-text` to
  the dark Muse palette (`#e4e7ed`) in dark mode, follows the OS to light,
  applies stored UI/code families through the font element, and loads the
  installed `Muse UI` face when present. Proven in jsdom (28 tests) and the
  node-side asset guard; the Chromium proof
  (`test/unit/companionThemedBrowser.test.mjs`: the real launch handshake
  in all four modes, each waiting for the mounted Usage body, the
  installed font and axe, with captures) is written for the unsandboxed
  run below.
- Axe: the served shell is clean in jsdom with contrast off; the browser
  suite runs the full WCAG 2.0/2.1/2.2 A+AA tag set with contrast on. The
  lane also fixed a pre-existing gap the new test surfaced: the served page
  had no `<title>` (now the installed usage title).

## Verification (all at the repository's default timeouts; no `--testTimeout`)

- `test/unit/companionTheme.test.ts` — 12/12 pass.
- `test/unit/companionThemedPage.test.ts` — 11/11 pass.
- `test/unit/companionFontPack.test.ts` — 6/6 pass.
- `test/unit/companionThemedAssets.test.mjs` — 1/1 pass.
- Owning neighbours: `companionPage`, `themeBridge` (42/42),
  `themeBridgeFixture` — 45/45 pass.
- `test/unit/usagePackaging.test.mjs` — 13/13 pass (with a writable npm
  cache dir; the shared cache holds root-owned files here).
- `npm run typecheck` — all five projects clean. `npx eslint
--max-warnings=0` on every touched file — clean. `npx prettier --check`
  on every touched file — clean. `npm run check:l10n` — 0 problems.
  `npm run check:reference` — current. `npm run deadcode` (knip) — only
  the two pre-existing config hints. `npm run duplication` (jscpd) — 0
  clones after extracting the test mount helper and reusing
  `removeFolder`.
- `npm run build` (production, 2026-10-10) — exit 0 through notices:
  `dist/usageCompanion.js` 46.5 KiB (50), `dist/webview/usage.js + static
imports` 392.6 KiB (500), `dist/webview/usage.css` 14.1 KiB (25, baseline
  restored after the hoisting rework), `dist/webview/theme.css` 22.3 KiB
  (25, new gate), `dist/webview usage body` 40.7 KiB (50).
  `node scripts/check-bundle-size.mjs` and `check-bundle-split.mjs` (68 ok,
  no problems) confirm. The production `theme.css` hashes
  `3be69b5fe479ea06c0b426c213a920e90a2deb4353447053619a13707e3b4872`,
  identical to the dev build: the helper is byte-deterministic.

## Byte-exact red drills (break, watch fail, restore, `sha256sum -c` OK)

Source SHAs at drill time (production `theme.css` identical in dev):

- `dist/webview/theme.css`: `3be69b5f…7e3b4872`
- `scripts/check-bundle-size.mjs`: `fa6aa426…5ddacfc96`
- `src/runtime/companion/page.ts`: `414c498c…69f90083`
- `src/runtime/usage/usageCompanionEntry.ts`: `3ce8474a…ad446263`

1. **Theme CSS budget.** Appended 4,011 bytes to the production
   `theme.css`; the gate reports `OVER dist/webview/theme.css: 26.3 KiB
(budget 25 KiB)`; restored from backup, `sha256sum -c` OK, back to
   `ok 22.3 KiB`.
2. **Page guard.** Weakened `SPECIFIER_PATTERN` to `/^.*$/`; the forged
   import case fails (1 failed, 10 pass); restored, sha OK, 11/11 pass.
3. **Entry asset guard.** Skipped the `EPANEL_ASSET` throw for `theme.css`;
   the missing-sheets case fails with the wrong error (1 failed, 5 pass);
   restored, sha OK, 6/6 pass. The same drill run first exposed a real bug:
   a missing file threw raw `ENOENT` instead of `EPANEL_ASSET`; the entry
   now maps it (committed).
4. **Packaging.** The new `refuses missing usage asset:
dist/webview/theme.css` case passes; deleting the seed from
   `scripts/package-acp.mjs` would refuse the tarball the same way (not
   re-drilled separately: the case itself is the guard).

## Blocked in this sandbox (lead runs unsandboxed; no workaround built)

- Listening sockets are denied (`listen EPERM` on 127.0.0.1, confirmed with
  a bare `node:http` probe): `usageIntegration`'s companion case,
  `companionBrowser`, `companionServer` and `usageCompanionChunks` cannot
  run here. The `usageIntegration` fixture edit (added `theme.css`) is
  one line mirroring its `usage.css` line; re-run it outside the sandbox.
- Chrome cannot launch (`browserType.launch: Target page ... has been
closed`) and loopback `listen` is denied, so the rewritten
  `companionThemedBrowser.test.mjs` (RVCM1141 finding 3: real companion
  server, launch URL through `/session` and the bootstrap, all four modes
  waiting for the mounted Usage body, the installed font and axe) cannot
  run here — nor can the existing `themeBridgeBrowser`/
  `companionMediaBrowser` suites. The rewritten file parses and lints
  clean; re-run it outside the sandbox. Captures `temp/c-m114-1-*.png`
  do not exist yet.
- Codex review: requested from the lead (no sub-agents on this lane).

## Decisions and handoffs

- The theme CSS ships as a static file rather than through the chunk graph
  because esbuild hoists dynamically-imported CSS into the entry CSS, which
  put `dist/webview/usage.css` OVER its frozen 25 KiB budget (measured
  32.3 KiB in the first production build; back at baseline after the
  rework). Raising the cap is the owner's call; this lane did not.
- The companion imports the CSS-free `themeBridge` directly; the abort
  discipline mirrors `loadThemeBridge` inline (commented) so lane C's
  bundled entry stays untouched for the M104/native binding.
- `fontAppearanceSettings`' `save` path has no settings surface yet; no
  surface was added and no "not available" wording ships (owner order 1).
  A companion appearance settings UI is a later-lane decision.
- Native rows of acceptance 9 stay with C-M114-2; visual-regression
  goldens and the full gate stay with S/the lead.

## Round 3 — RVCM1141B readiness rebuild (2026-10-10, macbook rig, lane CM1141R3)

Review RVCM1141B's one P2: `companionThemedBrowser` waited on the header
title/subtitle, which `UsageApp` renders while `state` is undefined, so a
journal read that never resolves still passed certification on the
"Loading usage…" page. Rebuilt instead of patched, per the lane brief.

- Production (`src/webview/usage/UsageApp.tsx`): `<main>` carries
  `data-usage-ready="true"` only when `state !== undefined`, i.e. only
  after the view renders real host state. Error/unavailable shells never
  set it (separate component, no marker), and `aria-busy` settling on an
  error does not set it either.
- Browser certification (`test/unit/companionThemedBrowser.test.mjs`):
  every mode waits on `main.usage-page[data-usage-ready="true"]` idle
  (`aria-busy="false"`) and then asserts rendered values from the
  deterministic empty-journal fixture: `History is stored on ACP.`, the
  `No usage yet` empty state, and the absence of `Loading usage…`,
  alongside the existing palette/font/axe assertions.
- Regression (`test/unit/usageReadyMarker.test.tsx`, jsdom, 3 cases):
  marker absent on the pending shell although title/subtitle render (the
  old predicate's hole); marker plus settled values after `usage/state`;
  marker absent on a `usage/error` settle although `aria-busy` is false.
- Sweep of every readiness predicate in `test/unit/companion*` for the
  same class: `companionBrowser` waits on the launch document's
  `data-launch` marker plus `panelLoaded` and asserts only
  transport/security behaviour on a fake shell (no Usage content);
  `companionMediaBrowser` waits on `data-attached` set after the server
  consumed the upload, with assertions on the server-side uploads array;
  lifecycle/upload/media suites wait on server events or rendered props,
  never on page copy. None assert Usage content on a shell wait, so none
  needed the marker. Harness `usage-*.mjs` `aria-busy` waits are
  screenshot drivers, not certifications, and one flow asserts error
  paths where the marker never appears; left untouched.

Red drill: broke the guard (`data-usage-ready={undefined}`) —
`usageReadyMarker` failed exactly the settled-state case (1 failed,
2 passed); restored and `sha256sum -c` OK on both files at drill time
(`UsageApp.tsx` `c71a62a1…`, `usageReadyMarker` `8ac94508…`; later
lint-driven edits re-verified by the passing runs below).

Verification (repository timeouts, no `--testTimeout`): the new file plus
`UsageApp` plus `companionThemedPage` — 45/45 pass on this rig.
`npm run typecheck` clean (all projects); eslint and prettier clean on
all touched files; `check-l10n` 0 problems (no user-visible string).
Blocked in this sandbox: the rebuilt `companionThemedBrowser` suite
cannot run here — `listen EPERM` on 127.0.0.1 in `beforeAll`, the same
sandbox denial the lane already records. No workaround built, per the
2026-10-08 rule; the lead runs the four-mode browser certification
unsandboxed.
