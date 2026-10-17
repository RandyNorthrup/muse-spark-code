# CAPS017 (webview) — three webview closures and the split check

Branch `rel017/caps-web` from `release/0.17.0` `7a4fc2ab3`, Windows host
plus the Kubuntu rig, 2026-10-08. No cap changed; hooks on for every commit;
nothing pushed. Measured with `check-tokens`, `build --production`,
`check-bundle-size` and `check-bundle-split` (Windows bytes).

| Group / check            | Before    | After      | Cap     |
| ------------------------ | --------- | ---------- | ------- |
| surface English          | 27,592 B  | 24,540 B   | 25 KiB  |
| Palette closure          | 26,366 B  | 22,658 B   | 25 KiB  |
| estimator panel closure  | 25,627 B  | 25,315 B   | 25 KiB  |
| bundle split             | 1 problem | 0 problems | —       |
| deferred JS (original)   | 32.0 KiB  | 31.9 KiB   | 50 KiB  |
| main.js + static imports | 748.3 KiB | 748.2 KiB  | 900 KiB |
| `dist/estimator.js`      | 67.8 KiB  | 67.6 KiB   | 75 KiB  |

## What moved

- **Surface English.** The `vault` group (6.9 KB raw) was a deferred key
  only because the Help model holds `vault` as a feature id and CLI route;
  no shipped chat, Models or Usage graph reads it, and `vaultEnglish.ts`
  already installs it before any vault render. The shared surface region no
  longer carries it (`uiTextRegions.mjs`). Its lane stays deferred, so the
  installed-language vault validation is unchanged.
- **Palette and the split problem.** The merge had App import
  `src/shared/slashCommands.ts` as its own unregistered deferred entry, and
  `palette.ts`'s re-export also pulled it, with Help's `SLASH_REFERENCE`,
  into the Palette closure. The registry now re-exports `slashCommandsOf`
  and App reads it from the registry module it already loads.
  `SLASH_REFERENCE` and the syntax/description join moved to
  `src/shared/reference/slashReference.ts`, imported only by the reference
  generator; `npm run check:reference` reports the generated reference
  current (29 slash).
- **Estimator panel.** The machine-class and provider projection schemas
  in `src/shared/estimate.ts` use the pure-builder form, so the browser's
  estimate chunk drops them (9,650 → 9,338 B).

## Red drills

| Gate or test                                                     | Break                                              | Result                     |
| ---------------------------------------------------------------- | -------------------------------------------------- | -------------------------- |
| browserUiText "loads surface English on demand" (vault boundary) | surface region keeps `vault` again                 | fails: `EN.vault` no throw |
| paletteRegistry "leaves Help syntax … to the reference join"     | browser `slashCommandsOf` sets `syntax`            | fails: has `syntax`        |
| AppPaletteLazy (registry held, loads on use, failure and retry)  | static `import '../shared/paletteRegistry'` in App | hangs, worker killed       |
| webviewBundle "existing closure caps" (estimator panel)          | baseline `7a4fc2ab3`                               | fails: 25,627 > 25,600     |
| check-bundle-split                                               | baseline `7a4fc2ab3`                               | exit 1, 1 problem          |

Each break was reverted; the tests pass again.

## Still failing, not this lane

`webviewBundle.test.mjs` keeps two failures that also fail at `7a4fc2ab3`:
`src/shared/usd.ts` is in chat startup (money), and the FIXDIET1 startup
ratchet (766,163 B on Linux, baseline 766,223 B, ratchet 751,411 B).
`referenceBundle.test.mjs` fails at the baseline too (compact Node
reference). Node bundle caps are the lead's lane.
