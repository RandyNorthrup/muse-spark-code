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

## Next

- `check:l10n` extended to Rust/QML sources and every new surface.
- The pseudo-RTL table, mirrored-layout proof, the stylelint
  logical-properties rule.
- The font-coverage gate, the os/desktop package list, the Electron IME
  capture.
- Records, gates, commits.
