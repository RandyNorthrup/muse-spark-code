# RLF-M111TH — M111 lane TH: the shared desktop theme

Base: int/recovery at `dfcb45936`. Rig: linuxlt. Date: 2026-10-30/31.

## What this lane builds (PLAN.md M111 lane TH, D91.19 + amendment)

A consumer of M114's token source (`design/tokens/muse.tokens.json` via
`design/tokens/generated/consumers.json`), never a second one. New
`scripts/build-tokens-desktop.mjs` generates every desktop output; nothing is
edited by hand afterwards:

- `desktop/shell/theme/MuseTheme/` (`MuseTheme.qml` + `qmldir`): the Qt
  shell's theme singleton module, all four modes, portal + override
  resolution as bindings, viewport geometry as functions.
- `desktop/shell/theme/palette-<mode>.css`: per-mode resolved desktop palette
  (concrete values, no `var()` chains, no VS Code fallbacks); the native layer
  loads the file matching the resolved appearance.
- `desktop/crates/tokens/`: zero-dependency Rust crate — generated
  `palette.rs` constants plus the handwritten appearance resolver.
- `desktop/shell/theme/hyprland-theme.lua`: data table (borders, gaps,
  rounding, beziers, timings, reduced-motion) for CP's config generator.
- `desktop/shell/theme/xterm-<mode>.json`: xterm.js `ITheme` per mode (BP/WB
  consume at merge).
- `desktop/shell/theme/codemirror-<mode>.json`: resolved editor roles + the
  lezer-tag map per mode (ED consumes at merge for canvas contexts; ED's DOM
  theme keeps reading `--ms-*` variables).
- `desktop/shell/theme/pointer.json`, `icons.json`: palettes AR's cursor and
  icon builds read.
- `desktop/shell/theme/wallpapers.json`: per-mode wallpaper recipe (base,
  brand gradient, glow, rule) AR renders.
- `desktop/shell/theme/boot/`: `boot.json` values, the `plymouth.script`
  (verified against Plymouth's own script-lib sources; progress over two
  generated 1px token PNGs) and `grub-theme.txt` (verified against shipped
  theme.txt files); AR packages them with background art and fonts under
  `os/desktop/`.
- Appearance: portal `org.freedesktop.appearance` color-scheme + contrast
  (D91.18/research §8) with the `desktop.json` override; default dark
  (matches M114's unthemed root). Resolution table is the contract, mirrored
  in Rust, QML and this record.
- `npm run check:tokens` also runs the desktop pairs: every terminal, editor
  and boot pair at WCAG 2.2 AA (4.5 text / 3.0 UI) in all four modes, plus
  byte-staleness of every generated file.

## Status

- [x] Design (see below).
- [x] Generator `scripts/build-tokens-desktop.mjs` (`9f8320d3f`).
- [x] Generated outputs committed.
- [x] Rust crate + `cargo test` (4 passed, clippy + fmt clean).
- [x] Vitest suite green (20 passed).
- [x] Rig drills: qmllint clean, qmltestrunner 10/10, LuaJIT load OK,
      qmlformat-stable emission, Plymouth/GRUB API verified.
- [ ] Chromium look.
- [ ] package.json scripts, README, CHANGELOG, PLAN, ROADMAP.
- [ ] All gates + LANE DONE.

## Design decisions (the plan leaves these to TH)

1. **ANSI derivation** (the source has no ANSI set): red=danger,
   green=success, yellow=warning, blue=info, magenta=syntax-keyword,
   cyan=mix(info,success,50%); bright(hue)=mix(hue,white,30%);
   brightBlack=muted; brightWhite=mix(white,white,30%); black/white =
   darker/lighter of surface+text. Anchors are `colour.qr-field` (#fff) and
   `colour.qr-module` (#000), identical in all four modes — no authored
   colour anywhere. `extendedAnsi` stays xterm.js's standard ramp (unset).
2. **Pairs**: normal hues gated as text (4.5, all pass); brights as UI (3.0);
   black/white/brightWhite are background-relative by terminal convention
   (xterm.js's own default black #2e3436 on its default #000000 background is
   ~1.4:1) and are gated crosswise (black-on-white, white-on-black,
   brightWhite-on-black) instead of on the terminal background.
3. **Boot is fixed dark brand** (no portal before login); the greeter follows
   portal+override via SS/SH.
4. **Portal encodings read**: color-scheme uint32 0/1/2 (no-preference/dark/
   light, xdg-desktop-portal); contrast uint32 0/1 (normal/high — our
   extension per D91.18, served by PT's portal); override string
   system|light|dark|hc-light|hc-dark (written by ST's settings app).
   Portal accent is ignored by design (our accent is the brand).
5. **D-Bus subscription** lives in the shell process entry (SH/SY own it via
   QtDBus); TH provides the resolution contract + QML bindings + Rust
   resolver. The `desktop.json` schema is ST's; TH documents the value set.
6. **Viewport-relative tokens** (column inset/gutter) ship as QML functions
   and Rust `const fn`s over the shell width, with the generator asserting
   M114's formula shapes (a shape change fails the build loudly). The static
   0 the DTCG value carries is never emitted alone.
7. **Plymouth progress** needs images (the script API has no rectangles):
   the two 1px PNGs are generated token colours (hand-rolled stored-deflate
   encoder, bit-deterministic, decoded back with node:zlib in the tests).
   The script uses only calls verified in Plymouth's own sources
   (`script-lib-image.c`, `script-lib-sprite.c`): no `SetPosition`,
   `SetClip`, `Image.Rectangle`, or the wrong `SetMessageFunction`.
8. **Hyprland Lua** is a pure data table (no Hyprland API calls): the 0.55 Lua
   API is not verifiable on this rig, so CP maps values to syntax at build.
9. **Cross-lane touch (needs the lead's ack at merge):** `.stylelintrc.json`
   gains TH's four palette CSS files in the raw-colour overrides (additive,
   exact-file, M114's pattern). The pre-commit hook lints every staged CSS
   file, so the plan-mandated palette CSS cannot land without it; AGENTS.md
   anticipates generated token files carrying paint. Zero behaviour change
   for existing files. Follow-up for the lead: extend `lint:css`'s
   `src/**/*.css` glob to `desktop/**/*.css`.

## Proof

- `node scripts/build-tokens-desktop.mjs --check`: 0 problems (24 outputs
  fresh, every desktop pair at AA in all four modes).
- Vitest `test/unit/desktop/themeDesktop.test.mjs`: 20 passed, each under
  the repo timeout; includes the stale-output red case (names the file,
  leaves it untouched) and the derivation-drift red case (mutated danger
  fails `dark: xterm/red on xterm/background`).
- Rust `cargo test`: 4 passed; `cargo fmt --check` clean;
  `cargo clippy --all-targets` with no warnings.
- Real Qt 6.9.2: `qmllint` clean, `qmltestrunner` 10/10 (mode resolution,
  override, invalid-override fallback, reduced motion, statics, column
  geometry), emission verified `qmlformat`-stable.
- Real LuaJIT (nvim headless): the Hyprland table loads; version, dark
  focus `#7fb2ff`/`0xFF7FB2FF`, gaps 4/8, rounding 12, width 2, beziers,
  HC border, tiling flags and the reduced-motion table all assert.
- Real Chromium (headless, `rlf-m111th.dark.png` + `.light.png`): xterm.js
  with the generated dark/light themes (all 16 ANSI), CodeMirror with the
  generated editor themes (keyword/string/comment), the resolved palette
  swatches and the boot pixels. Light white/brightWhite are invisible on
  white by the documented bg-relative design.
- Boot formats verified against authoritative sources: the Plymouth script
  uses only calls present in Plymouth's own `script-lib-image.c` /
  `script-lib-sprite.c` (the suite locks this: no `SetPosition`,
  `SetClip`, `Image.Rectangle`, or bare `SetMessageFunction`); the GRUB
  theme matches shipped `theme.txt` files (color-only, no pixmap or font
  references until AR's land).
- Red/green drill (worktree, 2026-10-31): corrupted
  `desktop/shell/theme/palette-dark.css` → `--check` exit 1 naming the
  stale file; regenerated → exit 0. (Below in Gates.)
- Merge items for the lead: ack the `.stylelintrc.json` override touch;
  extend `lint:css` to `desktop/**/*.css`; WB/ED/BP/CP/AR/PT/ST consume
  the theme files, portal and override at merge; no Rust CI job exists
  yet (`cargo test` runs on rigs only).

## Gates

All exit codes below are real, measured on linuxlt on 2026-10-31 with the
repository's own timeouts (no `--testTimeout` anywhere):

- `format:check`: 0; `lint`: 0 (lint:ps skips on Linux by design).
- `typecheck`: 0.
- `check:l10n`: 0 (no new strings).
- `check:reference`: 0; `check:host-api`: 0; `check:plan`: 0;
  `check:roadmap`: 0 (regenerated after the PLAN/CHANGELOG edits).
- `check:catches`: 0 (baseline matches; the one new catch is NARROW and
  outside the inventoried `src/` scope).
- `duplication`: 0 clones; `cycles`: 0; `deadcode`: 0 (after promoting the
  three test-imported packages to direct devDependencies).
- `build`: 0, every budget holds.
- `check:tokens` (chained): 0 — `tokens: 0 problems`,
  `desktop tokens: 0 problems`.
- Vitest `test/unit/desktop/themeDesktop.test.mjs`: 20 passed;
  `vitest related scripts/build-tokens-desktop.mjs`: 20 passed;
  `test/unit/desktop/` + `checkTokens.test.mjs`: 32 passed.
- Cargo: `test` 4 passed, `fmt --check` clean, `clippy --all-targets`
  no warnings (rig-only; no Rust CI job exists yet).
- Qt 6.9.2: `qmllint` clean, `qmltestrunner` 10/10, emission
  `qmlformat`-stable (rig drills, recorded here).
- LuaJIT (nvim headless): theme table loads and asserts pass (rig drill).
- Chromium headless: dark + light looks rendered and eyeballed (PNGs
  beside this record); light white/brightWhite invisible on white is the
  documented bg-relative design.
- Not run: full `test:unit` (rules require touched suites + related
  only), `test:a11y` (merge/release gate, not a lane gate), vault and
  credential-store suites (untouched by this lane).
