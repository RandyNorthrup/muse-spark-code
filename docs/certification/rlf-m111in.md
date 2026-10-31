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

## Next

- `check:l10n` extended to Rust/QML sources and every new surface.
- The pseudo-RTL table, mirrored-layout proof, the stylelint
  logical-properties rule.
- The font-coverage gate, the os/desktop package list, the Electron IME
  capture.
- Records, gates, commits.
