# RLF-M111ST1: M111 lane ST1, Settings system pages

Lane ST1 builds the Settings app's eleven system pages (D91.16) as a
React app over lane 0's sysd contract: Appearance, Displays, Sound,
Network, Bluetooth, Cellular, Power and sleep, Printers, Storage, Date
and time, Language and region. Every system change asks the person
first; nothing applies without confirmation.

Worktree `/home/randy/lanes/RLF-M111ST1`, branch `rec/rlf-m111st1`,
base `5ec754534`.

## What is done

- The sysd JSON-RPC contract (`src/shared/desktop/sysd.ts`) and the
  settings value shapes (`src/shared/desktop/settings.ts`): 38
  versioned methods, zod/mini strict on both directions, `SysdError`
  with a code for every wire failure. A sysd message is never shown
  to the person. Tested in `test/unit/desktop/sysd.test.ts`
  (22 tests).
- Strings: the `settingsSystem` group, 152 keys in `en.ts` plus the
  confirmation and pairing follow-ups, in English and all 14 tables
  (`node scripts/check-l10n.mjs`: 0 problems). They ride their own
  desktop English chunk (`dist/uiTextSettings.js`, the `settings`
  region in `scripts/lib/uiTextRegions.mjs`, measured 2.2 KiB
  against a 25 KiB budget) so neither `dist/uiText.js` nor
  `dist/uiTextSurfaces.js` grows: with the settings keys the
  surfaces chunk stood at 26.2 KiB against its 25 KiB cap, and an
  existing budget is never raised (D6). The Rust and QML tables
  were regenerated (`npm run desktop:l10n`).
- The eleven pages under `src/webview/settings/system/` with shared
  primitives (page frame, rows, the bound loader, the confirm
  dialog, localized number parsing): `AppearancePage`,
  `DisplaysPage`, `SoundPage`, `NetworkPage`, `BluetoothPage`,
  `CellularPage`, `PowerPage`, `PrintersPage`, `StoragePage`,
  `DateTimePage`, `LocalePage`.
- The settings shell (`src/webview/settings/shell/SettingsApp.tsx`,
  `SystemPages.tsx`, `BoundPage.tsx`): nav list, page mount,
  keybinding surfaces `settings.nav` / `settings.dialog`. Without
  lane SY's transport the shell mounts with no client and shows the
  honest unavailable screen, never dead pages.
- Every mutation goes through `usePendingChange` plus
  `ConfirmChangeDialog` (Cancel / Apply change); Bluetooth pairing
  is a two-step passkey check (D55). Escape closes the dialog
  through the `settings.dialog` surface.
- The entry (`src/webview/settings/main.tsx`),
  `desktop/app/settings.html`, and the production build
  (`dist/desktop/settings.js`, `dist/desktop/settings.css`).
  Budgets (D6, measured +15% to the next 25 KiB): `settings.js`
  875 KiB (measured 754.9 KiB), `settings.css` 25 KiB (measured
  7.3 KiB).
- Component tests on the real pages only
  (`test/unit/settings/systemPages.test.tsx`,
  `networkPages.test.tsx`, `powerPrinters.test.tsx`,
  `dateLocale.test.tsx`, `shell.test.tsx`): 64 green.
- Token-only CSS (logical properties, no motion). The keybinding
  and bundle-size checks know the new surfaces and bundles.

## Against lane-0 contracts

Lane SY's transport is not built yet, so the app builds against
lane 0's sysd contract and says so: `main.tsx` mounts with
`client={undefined}` by design, and the shell shows the
unavailable screen until SY's transport hands it a client. No page
holds a stand-in that a test trusts: the scene fixture used for
the local look lives in `temp/` and no test reads it.

## Looks

One small local look per UI change, through headless Chromium
with a short `TMPDIR`, in light and dark. The look loads the real
production bundle (`dist/desktop/settings.js` +
`dist/desktop/settings.css`) for the unavailable screen and a
dev-only scene for the pages. Zero page errors from the real
bundle; the scene reported only its own missing favicon (404) and
its bare page's missing title under axe (`document-title`):
both scene artifacts, not product findings.

- `rlf-m111st1-appearance-light.png`: Appearance page, light.
- `rlf-m111st1-appearance-dark.png`: Appearance page, dark.
- `rlf-m111st1-unavailable-dark.png`: the real bundle's honest
  unavailable screen, dark.

The look found one real bug: the page frame kept the old page's
loaded state when the loader changed, rendering the old page's
rows under the new page's title. The fix binds the snapshot to
its loader (`snapshot.load !== load` renders the loading state);
the regression test fails without the fix and passes with it.

## Drills

1. _Confirm gate._ Break: the Apply change button calls
   `onCancel` instead of `onConfirm` (`dialog.tsx`). Red:
   `npx vitest run test/unit/settings/networkPages.test.tsx`
   exits 1 with 5 failed / 5 passed. Restore (tree clean);
   green: exit 0, 10 passed.
2. _Page-frame loader binding._ Break: revert the
   `snapshot.load !== load` guard (`frame.tsx`). Red:
   `npx vitest run test/unit/settings/shell.test.tsx` exits 1
   with "never renders one loader's data for another loader"
   failing. Restore (tree clean); green: exit 0, 10 passed.
3. _Localization._ Break: delete
   `settingsSystem.navDisplays` from `l10n/ui.de.json`. Red:
   `node scripts/check-l10n.mjs` exits 1 with 4 problems
   (missing key, order, two stale generated tables). Restore
   (tree clean); green: exit 0, 0 problems.
4. _Bundle budget._ Break: lower the `settings.js` budget to
   700 KiB. Red: `node scripts/check-bundle-size.mjs` exits 1
   with `OVER dist/desktop/settings.js: 754.9 KiB (budget 700
KiB)`. Restore (tree clean); green: settings 754.9 KiB /
   875 KiB, settings.css 7.3 KiB / 25 KiB, both `ok`.

## What is next

- Lane SY's transport hands the shell a real client: `main.tsx`
  mounts with it and the unavailable screen goes away.
- Lane ST2's shell owns the settings app's chrome; TH noted the
  settings bundle carries the full English table like the
  workbench renderer.
- `npm run check:font-coverage` could not run here: `hb-shape`
  is missing and the install was denied. Hosted CI covers it.

## Gates

(Filled in on the final pass; every exit code pasted.)

- prettier: —
- eslint: —
- typecheck: —
- check-l10n: —
- check-reference: —
- check-host-api: —
- check-plan: —
- check-roadmap: —
- check-catches: —
- duplication: —
- cycles: —
- deadcode: —
- build: —
- SAST: —
- vitest (settings + sysd + related): —
