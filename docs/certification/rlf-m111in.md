# RLF-M111IN — M111 lane IN Languages (shared)

Base: int/recovery 0a5ebd7189. Builds the row's items against lane 0's
contracts (`src/shared/desktopContracts.ts`).

## Done

- 2026-10-30: the generator (`desktop/crates/l10n/tools/`, `npm run
desktop:l10n`), the Rust crate (`muse-desktop-l10n` 0.1.0, ICU4X 2.4.0,
  `ui_text!`, `format_date`/`format_number`, Cargo.lock pinned) and the
  generated QML singleton (`qml/UiText.qml`, qmllint clean). `cargo test`
  5/5, `cargo fmt --check` clean, clippy clean; `qmltestrunner` 7/7 on
  Qt 6.9.2 offscreen; `test/unit/desktop/l10nTables.test.mjs` 4/4.
  Generated sizes: tables.rs 9.7 MB, UiText.qml 8.0 MB (the full fifteen
  tables, D91.20). ICU4X 2.4 leaves units/currencies/compact explicitly
  unimplemented (icu_decimal docs, icu4x#275), so units stay a table
  pattern around `format_number`; needs rust 1.88+ (Debian trixie's 1.85
  is too old — the image build needs a newer toolchain, IM's call).
- 2026-10-30: `check:l10n` covers Rust (`ui_text!`), QML
  (`UiText.text`), the generated tables' freshness, and `desktop/**/*.ts`
  load order (WB/ED's 11 real files scanned from their branches: 0
  problems). `test/unit/desktop/l10nGate.test.mjs` 6/6; existing
  `usageL10nGate` fixtures still green. Drills (each red exit 1, then
  restored green): unknown Rust key, unknown QML key, stale tables.rs,
  desktop TS module-load read.
- 2026-10-30: the pseudo-RTL table (`?lang=pseudo-rtl` /
  `--lang=pseudo-rtl`, RLO-wrapped strings, page flips to `dir=rtl`,
  node harness included) with `pseudoRtl` 2/2; the stylelint
  logical-properties rule (`csstools/use-logical`, path-scoped to new
  desktop surfaces, block-axis excepted, `:dir(ltr)` for LTR-only
  content; WB/ED's real CSS verified 0 warnings). Local looks:
  `rlf-m111in-rtl.light/dark.png` (mirrored, message text stays LTR per
  lane 0); classic `--lang=pseudo` re-verified. Logical-rule drill: 3
  errors, exit 2, restored green.
- 2026-10-30: `os/desktop/packages.conf` (fcitx5 + Pinyin, Chewing, Mozc,
  Hangul; Noto core/CJK/emoji; all nine names verified in trixie) and the
  font-coverage gate (`npm run check:font-coverage`, HarfBuzz 10.2.0,
  union coverage over 13 faces with TTC indexes, marks isolated).
  Live: 13 fonts, 2646 codepoints, 0 problems. Red drill: planted
  U+1F774 (proven missing in all fonts) → exit 1 with exact
  attribution. `fontCoverage` 7/7 (recorded hb-shape outputs, exit-2
  paths, symlink parity). Not in `quality:gates`: needs Linux with the
  image fonts + hb-shape; desktop CI runs it.
- 2026-10-30: the Electron IME capture (`test/desktop/l10n/ime-flags.mjs`
  - `ime-flags.json` receipt): pinned Electron 45.0.0 (Chromium
    156.0.8078.48) carries `--enable-wayland-ime
--wayland-text-input-version=3` in a real Xvfb run; without the flags
    the probe reports false (assertion non-vacuous); missing binary fails
    said. Text-input-v3 behaviour under Hyprland+fcitx5 belongs to image
    CI. Noted: Electron 45.2.0 released 2026-10-30, pin bump is WB's call.
- 2026-10-30: node web UI + TUI verified under the same checks (15 TUI
  and 18 node-UI TS files in the load-order scan, green; their keys in
  the generated tables and pseudo-RTL; both harness pages'
  scripts syntax-clean).
- 2026-10-30: final battery, true exit codes (no pipes): typecheck,
  check:l10n, check:reference, check:host-api, check:plan,
  check:roadmap, check:catches, duplication, cycles, deadcode,
  lint:css, prettier, eslint all 0; vitest 12 + 22 + related 16/10/27
  all green (browser suites need TMPDIR=$PWD/temp here); cargo test
  5/5, clippy 0 warnings, fmt clean, cargo-audit 0 vulns (50 crates);
  qml-check, font gate (13 fonts, 2646 codepoints, 0 problems) and
  ime-flags all 0. Two pre-existing failures, neither this lane's
  (zero src/l10n input changes; no lane code in the bundles):
  `npm run build` exit 1 (teamRunners +3.4, teamHost +10.2,
  teamScheduler +1.5, uiText +0.3 KiB over budget — never raised) and
  `security:audit` exit 1 (10 advisories, none touching the new
  dependency). One lane bug found and fixed by the battery: knip's
  unlisted `qtpaths6` binary, now in ignoreBinaries.

## Next

- Nothing: the row is built, proven and recorded. The lead integrates;
  image CI (IM/QA) runs check:font-coverage, qml-check and ime-flags,
  and proves text-input-v3 under Hyprland with fcitx5.
